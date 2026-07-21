/**
 * Treasury HTTP surface — departments, shared wallets, unified moves,
 * deposit/withdraw, cash-flow, forecast, assets, recovery, multi-sig moves.
 */
import {
  USDC_ASSET_ID,
  accountId,
  formatMicroToUsdc,
  parseUsdcToMicro,
  type WalletRef,
  type WalletScope,
} from "@policyvault/common";
import { transferAvailable, type LedgerAccountKind } from "@policyvault/ledger";
import type express from "express";
import { z } from "zod";
import { id } from "./engine.js";
import { notify } from "./platform/notifier.js";
import { recordObs } from "./platform/observability.js";
import {
  store,
  type OrgRow,
  type TreasuryMoveRow,
} from "./store.js";
import {
  availableKind,
  buildCashflow,
  buildTreasuryForecast,
  heldKind,
} from "./treasury.js";
import { emitEvent } from "./webhooks.js";

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
      res.json({ assets: store.listAssets(org.id) });
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

  /** Mock / recorded deposit into org treasury (credits org_available from external). */
  app.post(
    "/v1/guardian/treasury/deposit",
    guardianRoute((org, req, res) => {
      const body = z
        .object({ amountUsdc: z.string(), memo: z.string().max(120).optional() })
        .parse(req.body);
      const amount = parseUsdcToMicro(body.amountUsdc);
      if (amount <= 0n) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Amount must be positive" } });
      }
      const externalId = `org:${org.id}:external`;
      const orgAvail = accountId("org", org.id);
      // Deposit: decrease external liability / source, increase org available.
      // Sign convention: +available funded by -external (balanced).
      store.applyEntries(org.id, [
        {
          id: id("j"),
          orgId: org.id,
          memo: body.memo ?? "treasury_deposit",
          createdAt: new Date().toISOString(),
          lines: [
            { accountId: externalId, deltaMicro: -amount },
            { accountId: orgAvail, deltaMicro: amount },
          ],
        },
      ]);
      recordObs({ name: "treasury.deposit", orgId: org.id, attrs: { amountUsdc: body.amountUsdc } });
      res.json({
        ok: true,
        amountUsdc: body.amountUsdc,
        orgAvailableUsdc: formatMicroToUsdc(
          store.getAccountMap(org.id).get(orgAvail)?.balanceMicro ?? 0n,
        ),
      });
    }, { ownerOnly: true }),
  );

  /** Withdraw from org treasury to external (recorded outflow). */
  app.post(
    "/v1/guardian/treasury/withdraw",
    guardianRoute((org, req, res) => {
      const body = z
        .object({
          amountUsdc: z.string(),
          destination: z.string().optional(),
          memo: z.string().max(120).optional(),
        })
        .parse(req.body);
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
      store.applyEntries(org.id, [
        {
          id: id("j"),
          orgId: org.id,
          memo: body.memo ?? `treasury_withdraw:${body.destination ?? "external"}`,
          createdAt: new Date().toISOString(),
          lines: [
            { accountId: orgAvail, deltaMicro: -amount },
            { accountId: `org:${org.id}:external`, deltaMicro: amount },
          ],
        },
      ]);
      res.json({ ok: true, amountUsdc: body.amountUsdc });
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

  app.post(
    "/v1/guardian/treasury/recovery/rotate-vault",
    guardianRoute((org, req, res) => {
      const body = z.object({ note: z.string().max(200).optional() }).parse(req.body ?? {});
      const rotated = store.rotateVaultKey(org.id);
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
        note: "Update any on-chain funding destinations to the new address. Old key is discarded from the store.",
      });
    }, { ownerOnly: true }),
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
