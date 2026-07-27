/**
 * Treasury HTTP surface — departments, shared wallets, unified moves,
 * deposit/withdraw, cash-flow, forecast, assets, recovery, multi-sig moves.
 */
import {
  USDC_ASSET_ID,
  accountId,
  formatAssetAmount,
  formatMicroToUsdc,
  parseAssetAmount,
  parseUsdcToMicro,
  type WalletRef,
  type WalletScope,
} from "@policyvault/common";
import { transferAvailable, type LedgerAccountKind } from "@policyvault/ledger";
import type express from "express";
import { z } from "zod";
import { id } from "../engine.js";
import { notify } from "../platform/notifier.js";
import { recordObs } from "../platform/observability.js";
import {
  store,
  type OrgRow,
  type TreasuryMoveRow,
} from "../store.js";
import {
  availableKind,
  buildCashflow,
  buildTreasuryForecast,
  heldKind,
} from "../treasury.js";
import { emitEvent } from "../webhooks.js";
import {
  decorateOnchainTransfers,
  syncOrgOnchainDeposits,
  runOnchainDepositSweep,
} from "../chain/sync-deposits.js";
import { activeChain } from "../chain/network.js";
import { readVaultOnchain } from "../chain/deposits.js";
import { transferUsdcFromVault, VaultTransferError } from "../chain/transfer.js";

type GuardianRoute = (
  handler: (org: OrgRow, req: express.Request, res: express.Response) => unknown,
  opts?: { ownerOnly?: boolean },
) => express.RequestHandler;

const walletRefSchema = z.object({
  scope: z.enum(["org", "department", "agent", "shared"]),
  id: z.string().min(1),
});

function resolveWalletOwner(org: OrgRow, ref: WalletRef): string | null {
  if (ref.scope === "org") {
    return ref.id === org.id || ref.id === "org" ? org.id : null;
  }
  if (ref.scope === "agent") {
    const a = store.getAgent(ref.id);
    return a && a.orgId === org.id ? a.id : null;
  }
  if (ref.scope === "department") {
    const d = store.getDepartment(ref.id);
    return d && d.orgId === org.id && d.status === "active" ? d.id : null;
  }
  const w = store.getSharedWallet(ref.id);
  return w && w.orgId === org.id && w.status === "active" ? w.id : null;
}

function walletLabel(_org: OrgRow, ref: WalletRef): string {
  if (ref.scope === "org") return `Org treasury`;
  if (ref.scope === "agent") return store.getAgent(ref.id)?.name ?? ref.id;
  if (ref.scope === "department") return store.getDepartment(ref.id)?.name ?? ref.id;
  return store.getSharedWallet(ref.id)?.name ?? ref.id;
}

function ensureAvailableAccount(orgId: string, scope: WalletScope, ownerId: string): void {
  const accId = accountId(scope, ownerId, "available");
  const map = store.getAccountMap(orgId);
  if (map.has(accId)) return;
  store.createAccount({
    id: accId,
    orgId,
    kind: availableKind(scope) as LedgerAccountKind,
    agentId: scope === "agent" ? ownerId : undefined,
    balanceMicro: 0n,
  });
  const held = accountId(scope, ownerId, "held");
  if (!map.has(held)) {
    store.createAccount({
      id: held,
      orgId,
      kind: heldKind(scope) as LedgerAccountKind,
      agentId: scope === "agent" ? ownerId : undefined,
      balanceMicro: 0n,
    });
  }
}

function treasuryHitlMicro(org: OrgRow): bigint {
  const raw = org.settings?.treasuryHitlUsdc;
  if (typeof raw === "string" || typeof raw === "number") {
    try {
      return parseUsdcToMicro(String(raw));
    } catch {
      /* fall through */
    }
  }
  return 50_000_000n; // $50 default — large treasury moves need quorum
}

function moveView(m: TreasuryMoveRow) {
  return {
    id: m.id,
    from: { scope: m.fromScope, id: m.fromId },
    to: { scope: m.toScope, id: m.toId },
    amountUsdc: formatMicroToUsdc(m.amountMicro),
    assetId: m.assetId,
    memo: m.memo,
    status: m.status,
    votes: m.votes,
    createdAt: m.createdAt,
    resolvedAt: m.resolvedAt,
    resolvedBy: m.resolvedBy,
  };
}

function executeMove(org: OrgRow, move: TreasuryMoveRow): void {
  const fromOwner = resolveWalletOwner(org, { scope: move.fromScope, id: move.fromId });
  const toOwner = resolveWalletOwner(org, { scope: move.toScope, id: move.toId });
  if (!fromOwner || !toOwner) throw new Error("WALLET_NOT_FOUND");
  ensureAvailableAccount(org.id, move.fromScope, fromOwner);
  ensureAvailableAccount(org.id, move.toScope, toOwner);
  store.applyEntries(org.id, [
    transferAvailable({
      orgId: org.id,
      journalId: id("j"),
      fromAvailableId: accountId(move.fromScope, fromOwner),
      toAvailableId: accountId(move.toScope, toOwner),
      amountMicro: move.amountMicro,
      memo: move.memo ?? `treasury_move:${move.fromScope}->${move.toScope}`,
    }),
  ]);
}

export function registerTreasuryRoutes(
  app: express.Express,
  deps: { guardianRoute: GuardianRoute; guardianIdentity: (req: express.Request) => string },
): void {
  const { guardianRoute, guardianIdentity } = deps;

  /** Full wallet registry for multi-wallet management. */
  app.get(
    "/v1/guardian/wallets",
    guardianRoute((org, _req, res) => {
      // Vercel embed has no setInterval — opportunistic deposit credit on console traffic.
      void runOnchainDepositSweep().catch((e) =>
        console.error("onchain deposit sweep failed:", e),
      );
      const accounts = store.getAccountMap(org.id);
      const bal = (scope: WalletScope, ownerId: string) => {
        const a = accounts.get(accountId(scope, ownerId))?.balanceMicro ?? 0n;
        const h = accounts.get(accountId(scope, ownerId, "held"))?.balanceMicro ?? 0n;
        return { availableUsdc: formatMicroToUsdc(a), heldUsdc: formatMicroToUsdc(h) };
      };
      res.json({
        asset: store.getAsset(USDC_ASSET_ID) ?? {
          id: USDC_ASSET_ID,
          symbol: "USDC",
          decimals: 6,
          chain: "base-sepolia",
          contract: null,
        },
        org: {
          scope: "org" as const,
          id: org.id,
          name: org.name,
          ...bal("org", org.id),
          vaultAddress: store.getVaultAddress(org.id),
        },
        departments: store.listDepartments(org.id).map((d) => ({
          scope: "department" as const,
          id: d.id,
          name: d.name,
          status: d.status,
          ...bal("department", d.id),
        })),
        /** Picture A: budgets === departments (cost-center envelopes). */
        budgets: store.listDepartments(org.id).map((d) => ({
          scope: "department" as const,
          id: d.id,
          name: d.name,
          status: d.status,
          ...bal("department", d.id),
        })),
        agents: store.listAgents(org.id).map((a) => ({
          scope: "agent" as const,
          id: a.id,
          name: a.name,
          status: a.status,
          ...bal("agent", a.id),
        })),
        shared: store.listSharedWallets(org.id).map((w) => ({
          scope: "shared" as const,
          id: w.id,
          name: w.name,
          status: w.status,
          memberAgentIds: w.memberAgentIds,
          ...bal("shared", w.id),
        })),
      });
    }),
  );

  app.get(
    "/v1/guardian/assets",
    guardianRoute((org, _req, res) => {
      const holdings = store.listOrgAssetHoldings(org.id).map(({ asset, balanceMicro }) => ({
        ...asset,
        balance: formatAssetAmount(balanceMicro, asset.decimals),
        balanceMicro: balanceMicro.toString(),
        spendRail: asset.id === "asset_usdc",
        onchainSync: asset.id === "asset_usdc",
      }));
      res.json({ assets: holdings });
    }),
  );

  app.post(
    "/v1/guardian/departments",
    guardianRoute((org, req, res) => {
      const body = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
      const dept = store.createDepartment(org.id, body.name);
      res.status(201).json({
        department: {
          ...dept,
          availableUsdc: "0",
          heldUsdc: "0",
        },
        /** Picture A alias — departments are budgets (money envelopes). */
        budget: {
          ...dept,
          availableUsdc: "0",
          heldUsdc: "0",
        },
      });
    }, { ownerOnly: true }),
  );

  /** Alias: create a budget (same ledger as department). See docs/decisions/2026-07-21-budgets-vs-team-membership.md */
  app.post(
    "/v1/guardian/budgets",
    guardianRoute((org, req, res) => {
      const body = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
      const dept = store.createDepartment(org.id, body.name);
      // Picture A pair: every budget gets a matching ops label for roster/freeze/fund.
      let opsLabel = store.findAgentGroupByBudget(org.id, dept.id);
      if (!opsLabel) {
        const sameName = store
          .listAgentGroups(org.id)
          .find((g) => g.status === "active" && g.name.toLowerCase() === dept.name.toLowerCase());
        if (sameName) {
          store.setAgentGroupBudget(sameName.id, dept.id);
          opsLabel = store.getAgentGroup(sameName.id);
        } else {
          opsLabel = store.createAgentGroup(org.id, dept.name, dept.id);
        }
      }
      res.status(201).json({
        budget: {
          id: dept.id,
          orgId: dept.orgId,
          name: dept.name,
          status: dept.status,
          createdAt: dept.createdAt,
          availableUsdc: "0",
          heldUsdc: "0",
          scope: "department" as const,
        },
        opsLabel: opsLabel
          ? { id: opsLabel.id, name: opsLabel.name, budgetId: opsLabel.budgetId ?? dept.id }
          : undefined,
      });
    }, { ownerOnly: true }),
  );

  app.get(
    "/v1/guardian/budgets",
    guardianRoute((org, _req, res) => {
      const accounts = store.getAccountMap(org.id);
      res.json({
        budgets: store.listDepartments(org.id).map((d) => ({
          id: d.id,
          orgId: d.orgId,
          name: d.name,
          status: d.status,
          createdAt: d.createdAt,
          scope: "department" as const,
          availableUsdc: formatMicroToUsdc(
            accounts.get(accountId("department", d.id))?.balanceMicro ?? 0n,
          ),
          heldUsdc: formatMicroToUsdc(
            accounts.get(accountId("department", d.id, "held"))?.balanceMicro ?? 0n,
          ),
        })),
      });
    }),
  );

  app.get(
    "/v1/guardian/departments",
    guardianRoute((org, _req, res) => {
      const accounts = store.getAccountMap(org.id);
      res.json({
        departments: store.listDepartments(org.id).map((d) => ({
          ...d,
          availableUsdc: formatMicroToUsdc(
            accounts.get(accountId("department", d.id))?.balanceMicro ?? 0n,
          ),
          heldUsdc: formatMicroToUsdc(
            accounts.get(accountId("department", d.id, "held"))?.balanceMicro ?? 0n,
          ),
        })),
      });
    }),
  );

  app.post(
    "/v1/guardian/shared-wallets",
    guardianRoute((_org, _req, res) => {
      // Soft-deprecated: Picture A uses budgets (envelopes) instead of shared pools.
      // Existing pools remain readable/movable for drain; new creates are refused.
      res.setHeader("Deprecation", "true");
      res.setHeader("Link", '</v1/guardian/budgets>; rel="successor-version"');
      return res.status(410).json({
        error: {
          code: "DEPRECATED",
          message:
            "Shared pools are legacy. Create a budget with POST /v1/guardian/budgets, then move funds to agents.",
          successor: "/v1/guardian/budgets",
        },
      });
    }, { ownerOnly: true }),
  );

  app.get(
    "/v1/guardian/shared-wallets",
    guardianRoute((org, _req, res) => {
      const accounts = store.getAccountMap(org.id);
      res.json({
        wallets: store.listSharedWallets(org.id).map((w) => ({
          ...w,
          availableUsdc: formatMicroToUsdc(
            accounts.get(accountId("shared", w.id))?.balanceMicro ?? 0n,
          ),
          heldUsdc: formatMicroToUsdc(
            accounts.get(accountId("shared", w.id, "held"))?.balanceMicro ?? 0n,
          ),
        })),
      });
    }),
  );

  app.post(
    "/v1/guardian/shared-wallets/:id/members",
    guardianRoute((org, req, res) => {
      const wallet = store.getSharedWallet(req.params.id);
      if (!wallet || wallet.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "shared wallet" } });
      }
      const body = z.object({ memberAgentIds: z.array(z.string()) }).parse(req.body);
      for (const agentId of body.memberAgentIds) {
        const a = store.getAgent(agentId);
        if (!a || a.orgId !== org.id) {
          return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
        }
      }
      store.setSharedWalletMembers(wallet.id, body.memberAgentIds);
      res.json({ wallet: store.getSharedWallet(wallet.id) });
    }, { ownerOnly: true }),
  );

  /**
   * Unified multi-wallet move. Amounts above org treasury HITL threshold park
   * for multi-guardian approval (treasury multisig).
   */
  app.post(
    "/v1/guardian/wallets/move",
    guardianRoute((org, req, res) => {
      const body = z
        .object({
          from: walletRefSchema,
          to: walletRefSchema,
          amountUsdc: z.string(),
          memo: z.string().max(200).optional(),
          /** Skip HITL even above threshold (owner emergency). */
          forceImmediate: z.boolean().default(false),
          assetId: z.string().default(USDC_ASSET_ID),
        })
        .parse(req.body);

      if (body.from.scope === body.to.scope && body.from.id === body.to.id) {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "Source and destination are the same wallet" },
        });
      }
      const fromOwner = resolveWalletOwner(org, body.from as WalletRef);
      const toOwner = resolveWalletOwner(org, body.to as WalletRef);
      if (!fromOwner || !toOwner) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "wallet" } });
      }
      if (!store.getAsset(body.assetId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Unknown asset" } });
      }

      const amount = parseUsdcToMicro(body.amountUsdc);
      if (amount <= 0n) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Amount must be positive" } });
      }

      const available =
        store.getAccountMap(org.id).get(accountId(body.from.scope, fromOwner))?.balanceMicro ?? 0n;
      if (amount > available) {
        return res.status(400).json({
          error: {
            code: "INSUFFICIENT_STIPEND",
            message: `${walletLabel(org, body.from as WalletRef)} has ${formatMicroToUsdc(available)} available`,
          },
        });
      }

      const hitl = treasuryHitlMicro(org);
      const needsApproval = !body.forceImmediate && amount > hitl;
      const moveId = id("tmv");
      const move = store.createTreasuryMove({
        id: moveId,
        orgId: org.id,
        fromScope: body.from.scope,
        fromId: fromOwner,
        toScope: body.to.scope,
        toId: toOwner,
        amountMicro: amount,
        assetId: body.assetId,
        memo: body.memo,
        status: needsApproval ? "pending" : "executed",
        votes: needsApproval ? [guardianIdentity(req)] : [],
        createdAt: new Date().toISOString(),
        resolvedAt: needsApproval ? undefined : new Date().toISOString(),
        resolvedBy: needsApproval ? undefined : guardianIdentity(req),
      });

      if (needsApproval) {
        emitEvent(org.id, "treasury.move.pending", moveView(move));
        void notify({
          kind: "info",
          orgId: org.id,
          title: "Treasury move needs approval",
          body: `${formatMicroToUsdc(amount)} USDC ${walletLabel(org, body.from as WalletRef)} → ${walletLabel(org, body.to as WalletRef)}`,
          meta: { moveId },
        });
        return res.status(202).json({
          outcome: "review",
          move: moveView(move),
          hint: "Poll GET /v1/guardian/treasury/moves or resolve via POST .../resolve",
        });
      }

      try {
        executeMove(org, move);
      } catch (e) {
        store.updateTreasuryMove(moveId, {
          status: "cancelled",
          resolvedAt: new Date().toISOString(),
          resolvedBy: "system",
        });
        return res.status(400).json({
          error: { code: "INSUFFICIENT_STIPEND", message: String(e) },
        });
      }
      emitEvent(org.id, "treasury.move.executed", moveView(move));
      recordObs({
        name: "treasury.move",
        orgId: org.id,
        attrs: { amountUsdc: body.amountUsdc, from: body.from, to: body.to },
      });
      res.json({ outcome: "allow", move: moveView(store.getTreasuryMove(moveId)!) });
    }, { ownerOnly: true }),
  );

  app.get(
    "/v1/guardian/treasury/moves",
    guardianRoute((org, req, res) => {
      const status = req.query.status ? String(req.query.status) : undefined;
      res.json({ moves: store.listTreasuryMoves(org.id, status).map(moveView) });
    }),
  );

  /** Multi-sig resolve for parked treasury moves. */
  app.post(
    "/v1/guardian/treasury/moves/:id/resolve",
    guardianRoute((org, req, res) => {
      const body = z
        .object({ approve: z.boolean(), resolvedBy: z.string().optional() })
        .parse(req.body);
      const move = store.getTreasuryMove(req.params.id);
      if (!move || move.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "treasury move" } });
      }
      if (move.status !== "pending") {
        return res.json({ ok: true, move: moveView(move), replayed: true });
      }

      const voter = body.resolvedBy ?? guardianIdentity(req);
      if (!body.approve) {
        store.updateTreasuryMove(move.id, {
          status: "denied",
          votes: [...new Set([...move.votes, voter])],
          resolvedAt: new Date().toISOString(),
          resolvedBy: voter,
        });
        return res.json({ ok: true, move: moveView(store.getTreasuryMove(move.id)!) });
      }

      const votes = [...new Set([...move.votes, voter])];
      const quorum = Math.max(1, store.getPolicyTemplate(org.id).approvalQuorum ?? 1);
      if (votes.length < quorum) {
        store.updateTreasuryMove(move.id, { votes });
        return res.json({
          ok: true,
          move: moveView(store.getTreasuryMove(move.id)!),
          awaitingVotes: quorum - votes.length,
        });
      }

      try {
        executeMove(org, { ...move, votes });
      } catch (e) {
        return res.status(400).json({
          error: { code: "INSUFFICIENT_STIPEND", message: String(e) },
        });
      }
      store.updateTreasuryMove(move.id, {
        status: "executed",
        votes,
        resolvedAt: new Date().toISOString(),
        resolvedBy: voter,
      });
      const done = store.getTreasuryMove(move.id)!;
      emitEvent(org.id, "treasury.move.executed", moveView(done));
      res.json({ ok: true, move: moveView(done) });
    }),
  );

  /**
   * Recorded deposit into org treasury / vault holdings.
   *
   * Live orgs cannot mint here: ledger balance must originate from USDC that
   * actually arrived at the vault address (credited by the on-chain deposit
   * sweep). Sandbox orgs may still book simulated money, tracked in
   * `unbacked_micro` so on-chain reconciliation stays truthful.
   */
  app.post(
    "/v1/guardian/treasury/deposit",
    guardianRoute((org, req, res) => {
      const body = z
        .object({
          amountUsdc: z.string(),
          assetId: z.string().optional(),
          memo: z.string().max(120).optional(),
        })
        .parse(req.body);
      const assetId = body.assetId?.trim() || "asset_usdc";
      const asset = store.getAsset(assetId);
      if (!asset) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Unknown asset" } });
      }
      let amount: bigint;
      try {
        amount =
          assetId === "asset_usdc"
            ? parseUsdcToMicro(body.amountUsdc)
            : parseAssetAmount(body.amountUsdc, asset.decimals);
      } catch {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: `Invalid ${asset.symbol} amount` },
        });
      }
      if (amount <= 0n) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Amount must be positive" } });
      }

      // USDC remains on the double-entry spend rail; other assets use vault holdings.
      if (assetId === "asset_usdc") {
        if (store.getOrgLedgerMode(org.id) === "live") {
          return res.status(400).json({
            error: {
              code: "UNBACKED_DEPOSIT_REFUSED",
              message:
                "This organization holds real money. Send USDC to the vault address instead — it is credited automatically once the transfer confirms.",
              vaultAddress: store.getVaultAddress(org.id),
              network: activeChain().id,
            },
          });
        }
        const externalId = `org:${org.id}:external`;
        const orgAvail = accountId("org", org.id);
        store.applyEntries(org.id, [
          {
            id: id("j"),
            orgId: org.id,
            memo: body.memo ?? "sandbox_deposit",
            createdAt: new Date().toISOString(),
            lines: [
              { accountId: externalId, deltaMicro: -amount },
              { accountId: orgAvail, deltaMicro: amount },
            ],
          },
        ]);
        // Simulated money in, so the vault will not gain this amount.
        store.addUnbackedMicro(org.id, amount);
        recordObs({
          name: "treasury.deposit",
          orgId: org.id,
          attrs: { amountUsdc: body.amountUsdc, assetId, simulated: true },
        });
        return res.json({
          ok: true,
          simulated: true,
          amountUsdc: body.amountUsdc,
          assetId,
          symbol: asset.symbol,
          orgAvailableUsdc: formatMicroToUsdc(
            store.getAccountMap(org.id).get(orgAvail)?.balanceMicro ?? 0n,
          ),
        });
      }

      const bal = store.creditOrgAsset(org.id, assetId, amount);
      store.addVaultAssetEvent({
        orgId: org.id,
        assetId,
        kind: "in",
        amountMicro: amount,
        memo: body.memo ?? "vault_receive",
      });
      recordObs({ name: "treasury.deposit", orgId: org.id, attrs: { amountUsdc: body.amountUsdc, assetId } });
      res.json({
        ok: true,
        amountUsdc: body.amountUsdc,
        assetId,
        symbol: asset.symbol,
        balance: formatAssetAmount(bal, asset.decimals),
      });
    }, { ownerOnly: true }),
  );

  /**
   * Withdraw from org treasury / holdings.
   *
   * Live orgs broadcast a real USDC transfer from the vault and only book the
   * outflow once the transfer succeeds — the ledger never claims money left
   * unless it did. Sandbox orgs book a simulated outflow and say so.
   */
  app.post(
    "/v1/guardian/treasury/withdraw",
    guardianRoute(async (org, req, res) => {
      const body = z
        .object({
          amountUsdc: z.string(),
          destination: z.string().optional(),
          memo: z.string().max(120).optional(),
          assetId: z.string().optional(),
        })
        .parse(req.body);
      const assetId = body.assetId?.trim() || "asset_usdc";
      const asset = store.getAsset(assetId);
      if (!asset) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Unknown asset" } });
      }

      if (assetId === "asset_usdc") {
        const amount = parseUsdcToMicro(body.amountUsdc);
        const orgAvail = accountId("org", org.id);
        const available = store.getAccountMap(org.id).get(orgAvail)?.balanceMicro ?? 0n;
        if (amount <= 0n || amount > available) {
          return res.status(400).json({
            error: {
              code: "INSUFFICIENT_STIPEND",
              message: `Org has ${formatMicroToUsdc(available)} available`,
            },
          });
        }

        const live = store.getOrgLedgerMode(org.id) === "live";
        let transfer: Awaited<ReturnType<typeof transferUsdcFromVault>> | undefined;
        if (live) {
          const destination = body.destination?.trim();
          if (!destination || !/^0x[a-fA-F0-9]{40}$/.test(destination)) {
            return res.status(400).json({
              error: {
                code: "VALIDATION_ERROR",
                message: "A 0x destination address is required to withdraw real USDC.",
              },
            });
          }
          try {
            // Broadcast first. Booking the outflow before the chain accepts it
            // is how a ledger ends up claiming a payment that never happened.
            transfer = await transferUsdcFromVault({
              orgId: org.id,
              to: destination,
              amountMicro: amount,
            });
          } catch (e) {
            const code = e instanceof VaultTransferError ? e.code : "TRANSFER_FAILED";
            recordObs({
              name: "treasury.withdraw.failed",
              orgId: org.id,
              attrs: { code, amountUsdc: body.amountUsdc },
            });
            return res.status(400).json({
              error: { code, message: e instanceof Error ? e.message : String(e) },
            });
          }
        }

        store.applyEntries(org.id, [
          {
            id: id("j"),
            orgId: org.id,
            memo:
              body.memo ??
              `${live ? "treasury_withdraw" : "sandbox_withdraw"}:${body.destination ?? "external"}`,
            createdAt: new Date().toISOString(),
            lines: [
              { accountId: orgAvail, deltaMicro: -amount },
              { accountId: `org:${org.id}:external`, deltaMicro: amount },
            ],
          },
        ]);
        // A simulated outflow reduces the unbacked total: the books shed money
        // the vault never held.
        if (!live) store.addUnbackedMicro(org.id, -amount);
        recordObs({
          name: "treasury.withdraw",
          orgId: org.id,
          attrs: { amountUsdc: body.amountUsdc, simulated: !live },
        });
        return res.json({
          ok: true,
          simulated: !live,
          amountUsdc: body.amountUsdc,
          assetId,
          symbol: asset.symbol,
          txHash: transfer?.txHash,
          explorerUrl: transfer?.explorerUrl,
        });
      }

      let amount: bigint;
      try {
        amount = parseAssetAmount(body.amountUsdc, asset.decimals);
      } catch {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: `Invalid ${asset.symbol} amount` },
        });
      }
      const available = store.getOrgAssetBalance(org.id, assetId);
      if (amount <= 0n || amount > available) {
        return res.status(400).json({
          error: {
            code: "INSUFFICIENT_STIPEND",
            message: `Vault has ${formatAssetAmount(available, asset.decimals)} ${asset.symbol}`,
          },
        });
      }
      const bal = store.creditOrgAsset(org.id, assetId, -amount);
      store.addVaultAssetEvent({
        orgId: org.id,
        assetId,
        kind: "out",
        amountMicro: amount,
        memo: body.memo ?? "vault_send",
        counterparty: body.destination,
      });
      res.json({
        ok: true,
        amountUsdc: body.amountUsdc,
        assetId,
        symbol: asset.symbol,
        balance: formatAssetAmount(bal, asset.decimals),
      });
    }, { ownerOnly: true }),
  );

  app.get(
    "/v1/guardian/treasury/cashflow",
    guardianRoute((org, req, res) => {
      const days = Math.min(Math.max(Number(req.query.days ?? 30), 1), 90);
      const journals = store.listJournals(org.id, 2000).map((j) => ({
        id: j.id,
        memo: j.memo,
        createdAt: j.createdAt,
        lines: j.lines.map((l) => ({
          accountId: l.accountId,
          deltaMicro: l.deltaMicro,
        })),
      }));
      const series = buildCashflow(journals, days);
      const inflow = series.reduce((a, d) => a + parseUsdcToMicro(d.inflowUsdc), 0n);
      const outflow = series.reduce((a, d) => a + parseUsdcToMicro(d.outflowUsdc), 0n);
      res.json({
        days,
        series,
        totals: {
          inflowUsdc: formatMicroToUsdc(inflow),
          outflowUsdc: formatMicroToUsdc(outflow),
          netUsdc: formatMicroToUsdc(inflow - outflow),
        },
      });
    }),
  );

  app.get(
    "/v1/guardian/treasury/forecast",
    guardianRoute((org, _req, res) => {
      const balances = [...store.getAccountMap(org.id).values()];
      const sumKind = (kind: string) =>
        balances.filter((b) => b.kind === kind).reduce((a, b) => a + b.balanceMicro, 0n);
      const lookbackMs = 7 * 86_400_000;
      const cutoff = Date.now() - lookbackMs;
      // Approximate spend from pay_events across agents.
      let spent = 0n;
      for (const agent of store.listAgents(org.id)) {
        spent += store.spentLast24h(agent.id); // reuse daily; scale below
      }
      // Prefer 7d from journals marked finalize/payment
      const journals = store.listJournals(org.id, 500);
      let outflow7d = 0n;
      for (const j of journals) {
        if (Date.parse(j.createdAt) < cutoff) continue;
        if (!/finalize|payment|withdraw|x402/i.test(j.memo)) continue;
        for (const line of j.lines) {
          if (line.accountId.includes(":external") && BigInt(line.deltaMicro) > 0n) {
            outflow7d += BigInt(line.deltaMicro);
          }
        }
      }
      const avgDaily = outflow7d > 0n ? outflow7d / 7n : spent;
      const openInvoices = store
        .listInvoices(org.id)
        .filter((i) => i.status === "sent" || i.status === "overdue")
        .reduce((a, i) => a + i.amountMicro, 0n);

      res.json({
        forecast: buildTreasuryForecast({
          orgAvailableMicro: sumKind("org_available"),
          deptAvailableMicro: sumKind("dept_available"),
          sharedAvailableMicro: sumKind("shared_available"),
          agentAvailableMicro: sumKind("agent_available"),
          avgDailySpendMicro: avgDaily,
          openInvoicesMicro: openInvoices,
        }),
      });
    }),
  );

  app.get(
    "/v1/guardian/treasury/recovery",
    guardianRoute((org, _req, res) => {
      res.json({
        vaultAddress: store.getVaultAddress(org.id),
        events: store.listRecoveryEvents(org.id),
      });
    }),
  );

  /**
   * Live chain view of the org vault. Automatically credits any new USDC
   * Transfer-ins into the ledger (same as POST …/onchain/sync) so guardians
   * do not need a manual Sync click after a faucet send.
   */
  app.get(
    "/v1/guardian/treasury/onchain",
    guardianRoute(async (org, _req, res) => {
      const result = await syncOrgOnchainDeposits(org.id);
      if (!result.ok) {
        return res.status(502).json({
          error: {
            code: "CHAIN_UNAVAILABLE",
            message: result.error ?? "Could not read vault on-chain",
            network: result.snap.network,
          },
          onchain: result.snap,
          newlyCredited: [],
          creditedCount: 0,
          ledgerAvailableUsdc: result.ledgerAvailableUsdc,
        });
      }
      const { credited, transfers } = decorateOnchainTransfers(result.snap, org.id);
      res.json({
        onchain: { ...result.snap, transfers },
        newlyCredited: result.newly,
        creditedCount: result.newly.length,
        credited,
        ledgerAvailableUsdc: result.ledgerAvailableUsdc,
        autoSynced: true,
        note:
          result.newly.length > 0
            ? `Auto-credited ${result.newly.length} on-chain deposit(s) into the org vault ledger.`
            : undefined,
      });
    }),
  );

  /**
   * Unified vault activity: on-chain credits + demo deposits/withdraws from the ledger.
   * This is what Treasury → Fund shows as history.
   */
  app.get(
    "/v1/guardian/treasury/vault-activity",
    guardianRoute((org, req, res) => {
      const chain = activeChain();
      const filterAsset = typeof req.query.assetId === "string" ? req.query.assetId : undefined;

      const onchain = store.listOnchainDeposits(org.id, 80).map((d) => ({
        id: d.id,
        kind: "onchain_in" as const,
        source: "chain" as const,
        assetId: "asset_usdc",
        symbol: "USDC",
        amount: formatMicroToUsdc(BigInt(d.amountMicro)),
        amountUsdc: formatMicroToUsdc(BigInt(d.amountMicro)),
        direction: "in" as const,
        at: d.creditedAt,
        network: d.chain,
        from: d.from,
        to: d.to,
        txHash: d.txHash,
        blockNumber: d.blockNumber,
        explorerUrl: chain.explorerTx(d.txHash),
        label: "Received on-chain",
      }));

      const journals = store.listJournals(org.id, 200);
      const ledgerItems: {
        id: string;
        kind: "demo_in" | "withdraw";
        source: "ledger";
        assetId: string;
        symbol: string;
        amount: string;
        amountUsdc: string;
        direction: "in" | "out";
        at: string;
        label: string;
        memo: string;
      }[] = [];

      for (const j of journals) {
        const memo = j.memo.toLowerCase();
        if (memo.startsWith("onchain_deposit:")) continue;
        const orgAvail = `org:${org.id}:available`;
        const line = j.lines.find((l) => l.accountId === orgAvail);
        if (!line) continue;
        const delta = BigInt(line.deltaMicro);
        if (delta === 0n) continue;
        const amt = formatMicroToUsdc(delta > 0n ? delta : -delta);

        if (memo.includes("treasury_deposit") || memo.includes("seed") || memo === "deposit") {
          ledgerItems.push({
            id: j.id,
            kind: "demo_in",
            source: "ledger",
            assetId: "asset_usdc",
            symbol: "USDC",
            amount: amt,
            amountUsdc: amt,
            direction: delta > 0n ? "in" : "out",
            at: j.createdAt,
            label: "Demo ledger credit",
            memo: j.memo,
          });
        } else if (memo.includes("treasury_withdraw") || memo.includes("withdraw")) {
          ledgerItems.push({
            id: j.id,
            kind: "withdraw",
            source: "ledger",
            assetId: "asset_usdc",
            symbol: "USDC",
            amount: amt,
            amountUsdc: amt,
            direction: delta < 0n ? "out" : "in",
            at: j.createdAt,
            label: "Ledger send / withdraw",
            memo: j.memo,
          });
        }
      }

      const holdingItems = store.listVaultAssetEvents(org.id, 80).map((e) => {
        const asset = store.getAsset(e.assetId);
        const amount = formatAssetAmount(BigInt(e.amountMicro), asset?.decimals ?? 6);
        return {
          id: e.id,
          kind: e.kind === "in" ? ("holding_in" as const) : ("holding_out" as const),
          source: "holdings" as const,
          assetId: e.assetId,
          symbol: asset?.symbol ?? e.assetId,
          amount,
          amountUsdc: amount,
          direction: e.kind,
          at: e.at,
          label: e.kind === "in" ? `Received ${asset?.symbol ?? "asset"}` : `Sent ${asset?.symbol ?? "asset"}`,
          memo: e.memo,
          from: e.counterparty,
        };
      });

      let items = [...onchain, ...ledgerItems, ...holdingItems].sort(
        (a, b) => Date.parse(b.at) - Date.parse(a.at),
      );
      if (filterAsset) items = items.filter((i) => i.assetId === filterAsset);

      res.json({
        items,
        vaultAddress: store.getVaultAddress(org.id),
        network: chain.id,
        networkName: chain.name,
      });
    }),
  );

  /** Force a chain re-scan (GET /onchain already auto-credits; this is for explicit retries). */
  app.post(
    "/v1/guardian/treasury/onchain/sync",
    guardianRoute(async (org, _req, res) => {
      const result = await syncOrgOnchainDeposits(org.id);
      if (!result.ok) {
        return res.status(502).json({
          error: {
            code: "CHAIN_UNAVAILABLE",
            message: result.error ?? "Could not read vault on-chain",
            network: result.snap.network,
          },
        });
      }
      const { credited, transfers } = decorateOnchainTransfers(result.snap, org.id);
      res.json({
        ok: true,
        newlyCredited: result.newly,
        creditedCount: result.newly.length,
        onchain: { ...result.snap, transfers },
        credited,
        ledgerAvailableUsdc: result.ledgerAvailableUsdc,
        note:
          result.newly.length > 0
            ? `Credited ${result.newly.length} on-chain deposit(s) into the org vault ledger.`
            : result.snap.transfers.length === 0
              ? `No USDC Transfer-in found on ${result.snap.networkName} in the scanned window. Confirm Base Sepolia USDC to this vault on the explorer.`
              : "All detected transfers were already credited.",
      });
    }),
  );

  app.post(
    "/v1/guardian/treasury/recovery/rotate-vault",
    guardianRoute(async (org, req, res) => {
      const body = z
        .object({
          note: z.string().max(200).optional(),
          /**
           * Acknowledge that funds remaining at the old address will need a
           * manual sweep using the archived key. Required when the vault is
           * not empty; ignored when it is.
           */
          acknowledgeFundsAtRisk: z.boolean().optional(),
        })
        .parse(req.body ?? {});

      // Rotation used to overwrite the key in place with no balance check, so a
      // single click could strand every USDC and ETH at the old address. Refuse
      // while the vault holds anything, unless the caller explicitly accepts
      // that they must sweep it themselves from the archived key.
      const snap = await readVaultOnchain(store.getVaultAddress(org.id));
      if (snap.ok) {
        const usdc = BigInt(snap.onchainBalanceMicro);
        const native = BigInt(snap.nativeBalanceWei);
        if ((usdc > 0n || native > 0n) && !body.acknowledgeFundsAtRisk) {
          return res.status(409).json({
            error: {
              code: "VAULT_NOT_EMPTY",
              message:
                `Vault still holds ${snap.onchainBalanceUsdc} USDC and ${snap.nativeBalanceEth} ETH. ` +
                "Move those funds out first, or retry with acknowledgeFundsAtRisk=true — the old " +
                "key is archived, so a manual sweep stays possible either way.",
            },
            onchain: {
              address: snap.vaultAddress,
              usdc: snap.onchainBalanceUsdc,
              native: snap.nativeBalanceEth,
              explorerUrl: snap.explorerAddress,
            },
          });
        }
      } else {
        // A read failure must not be read as "empty".
        if (!body.acknowledgeFundsAtRisk) {
          return res.status(409).json({
            error: {
              code: "VAULT_BALANCE_UNKNOWN",
              message:
                `Could not read the vault on-chain (${snap.error ?? "RPC unavailable"}), so it is ` +
                "not safe to assume it is empty. Retry, or pass acknowledgeFundsAtRisk=true.",
            },
          });
        }
      }

      const rotated = store.rotateVaultKey(org.id, body.note ? `guardian:${body.note}` : "guardian_rotation");
      if (body.note) {
        store.addRecoveryEvent({
          orgId: org.id,
          kind: "vault_key_rotated_note",
          note: body.note,
          meta: rotated,
        });
      }
      emitEvent(org.id, "treasury.recovery", {
        kind: "vault_key_rotated",
        ...rotated,
      });
      void notify({
        kind: "info",
        orgId: org.id,
        title: "Custody key rotated",
        body: `New vault address ${rotated.address}. Previous ${rotated.previousAddress ?? "n/a"} recorded in recovery log.`,
      });
      res.json({
        ok: true,
        address: rotated.address,
        previousAddress: rotated.previousAddress,
        archivedKeyId: rotated.archivedKeyId,
        note:
          "Update any on-chain funding destinations to the new address. The previous key is " +
          "archived server-side, so funds left at the old address can still be swept.",
      });
    }, { ownerOnly: true }),
  );

  /** Retired vault addresses — proof that a rotation did not strand funds. */
  app.get(
    "/v1/guardian/treasury/recovery/archived-vaults",
    guardianRoute((org, _req, res) => {
      res.json({ archived: store.listArchivedVaultKeys(org.id) });
    }),
  );

  /** Agent API-key recovery (same as rotate — recorded in recovery log). */
  app.post(
    "/v1/guardian/treasury/recovery/rotate-agent-key",
    guardianRoute((org, req, res) => {
      const body = z.object({ agentId: z.string() }).parse(req.body);
      const agent = store.getAgent(body.agentId);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
      }
      const apiKey = store.rotateAgentKey(agent.id);
      store.addRecoveryEvent({
        orgId: org.id,
        kind: "agent_key_rotated",
        targetId: agent.id,
        note: `API key rotated for ${agent.name}`,
      });
      emitEvent(org.id, "treasury.recovery", { kind: "agent_key_rotated", agentId: agent.id });
      res.json({
        agentId: agent.id,
        apiKey,
        note: "Old key is dead. Store the new key now — it is not shown again.",
      });
    }, { ownerOnly: true }),
  );
}
