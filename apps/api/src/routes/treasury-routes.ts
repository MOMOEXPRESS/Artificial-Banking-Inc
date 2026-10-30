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
import { getCustodyProvider } from "@policyvault/custody";
import type express from "express";
import { z } from "zod";
import { id } from "../engine.js";
import { notify } from "../platform/notifier.js";
import { recordObs } from "../platform/observability.js";
import { scopedStore, store, type OrgRow, type TreasuryMoveRow } from "../store.js";
import { availableKind, buildCashflow, buildTreasuryForecast, heldKind } from "../treasury.js";
import { emitEvent } from "../webhooks.js";
import {
  decorateOnchainTransfers,
  syncOrgOnchainDeposits,
  runOnchainDepositSweep,
} from "../chain/sync-deposits.js";
import { activeChain } from "../chain/network.js";
import { readVaultOnchain } from "../chain/deposits.js";
import { reconcileOrgOnchain } from "../treasury-backing.js";
import { assetBacking, readAssetsOnchain } from "../chain/asset-adapters.js";
import { transferUsdcFromVault, VaultTransferError } from "../chain/transfer.js";
import { withVaultLock } from "../chain/vault-queue.js";
import { assetSendSupport, buildWalletProfile } from "../chain/wallet-profile.js";
import { guardTreasuryWithdraw, type TreasuryGuardDenial } from "../treasury-guard.js";
import { treasuryApprovalThresholdMicro, treasuryThresholdOutcome } from "../treasury-threshold.js";
import { canonicalJson, sha256Hex } from "../decision-receipts.js";
import { escalationOwner, unknownDeadlines } from "../jobs/settlement-recovery.js";

/** HTTP body for a refused guardian withdrawal — same shape as an agent policy deny. */
function withdrawDenialBody(d: TreasuryGuardDenial) {
  return {
    intentId: d.intentId,
    outcome: "deny" as const,
    ruleIds: d.ruleIds,
    reasons: d.reasons,
    ...(d.limits && { limits: d.limits }),
    receipt: d.receipt,
    error: { code: d.code, message: d.reasons[0] },
  };
}

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
    const a = scopedStore(org.id).getAgent(ref.id);
    return a && a.orgId === org.id ? a.id : null;
  }
  if (ref.scope === "department") {
    const d = scopedStore(org.id).getDepartment(ref.id);
    return d && d.orgId === org.id && d.status === "active" ? d.id : null;
  }
  const w = scopedStore(org.id).getSharedWallet(ref.id);
  return w && w.orgId === org.id && w.status === "active" ? w.id : null;
}

function walletLabel(org: OrgRow, ref: WalletRef): string {
  const scoped = scopedStore(org.id);
  if (ref.scope === "org") return `Org treasury`;
  if (ref.scope === "agent") return scoped.getAgent(ref.id)?.name ?? ref.id;
  if (ref.scope === "department") return scoped.getDepartment(ref.id)?.name ?? ref.id;
  return scoped.getSharedWallet(ref.id)?.name ?? ref.id;
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

/** The org's treasury approval threshold — see treasury-threshold.ts. */
function treasuryHitlMicro(org: OrgRow): bigint {
  return treasuryApprovalThresholdMicro(
    (store.getOrg(org.id) ?? org).settings as Record<string, unknown> | undefined,
  );
}

/** Guardian approvals needed before a parked treasury request executes. */
function treasuryQuorum(orgId: string): number {
  return Math.max(1, store.getPolicyTemplate(orgId).approvalQuorum ?? 1);
}

type WithdrawResult = { status: number; body: Record<string, unknown> };

/**
 * Send USDC out of the org treasury: guard (freeze, blocklist, allowlist,
 * caps), broadcast the USDC transfer, then book the outflow. Shared by an
 * immediate withdrawal and by a parked one that guardians just approved, so
 * both go through exactly the same checks.
 */
type UsdcWithdrawInput = {
  org: OrgRow;
  actor: string;
  amount: bigint;
  amountUsdc: string;
  destination?: string;
  memo?: string;
  /** Caller's idempotency key, stored on the settlement row with its expiry. */
  idempotencyKey?: string;
  idempotencyExpiresAt?: string;
};

/**
 * One withdrawal per org at a time. The balance check, the broadcast and the
 * booking span several awaits; two concurrent requests could both pass the
 * check and both broadcast while only one could be booked. Serialising keeps
 * check-then-send atomic per org.
 */
async function performUsdcWithdraw(input: UsdcWithdrawInput): Promise<WithdrawResult> {
  return withVaultLock(`withdraw:${input.org.id}`, () => performUsdcWithdrawLocked(input));
}

async function performUsdcWithdrawLocked(input: UsdcWithdrawInput): Promise<WithdrawResult> {
  const { org, actor, amount, destination } = input;
  const assetId = USDC_ASSET_ID;
  const orgAvail = accountId("org", org.id);
  const available = store.getAccountMap(org.id).get(orgAvail)?.balanceMicro ?? 0n;
  if (amount <= 0n || amount > available) {
    return {
      status: 400,
      body: {
        error: {
          code: "INSUFFICIENT_STIPEND",
          message: `Org has ${formatMicroToUsdc(available)} available`,
        },
      },
    };
  }
  if (!destination || !/^0x[a-fA-F0-9]{40}$/.test(destination)) {
    return {
      status: 400,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: "A 0x destination address is required to withdraw USDC.",
        },
      },
    };
  }
  const guard = guardTreasuryWithdraw({
    org,
    actor,
    assetId,
    amountMicro: amount,
    amountDisplay: formatMicroToUsdc(amount),
    destination,
    // Rule 6: the balance left after other in-flight / unknown withdrawals.
    availableMicro: available,
  });
  if (!guard.ok) {
    recordObs({
      name: "treasury.withdraw.denied",
      orgId: org.id,
      attrs: { ruleIds: guard.ruleIds, amountUsdc: input.amountUsdc },
    });
    return { status: guard.status, body: withdrawDenialBody(guard) };
  }
  let transfer: Awaited<ReturnType<typeof transferUsdcFromVault>> | undefined;
  // The guard reserved this withdrawal as a `pending` settlement row in the
  // shared database. Name its resolver and human now, before anything is sent.
  store.annotateSettlement(guard.intentId, {
    resolver: "chain:tx_receipt",
    escalateTo: escalationOwner(org.id),
    policyRevision: store.getPolicyVersion(org.id),
    idempotencyKey: input.idempotencyKey,
    idempotencyExpiresAt: input.idempotencyExpiresAt,
  });
  // Every org is live: a Treasury send always broadcasts (no book-only send).
  {
    const intentId = guard.intentId;
    let broadcastHash: string | undefined;
    try {
      // Broadcast first. Booking the outflow before the chain accepts it
      // is how a ledger ends up claiming a payment that never happened.
      transfer = await transferUsdcFromVault({
        orgId: org.id,
        to: destination,
        amountMicro: amount,
        onBroadcast: (txHash) => {
          broadcastHash = txHash;
          // Durable before the receipt wait, so the recovery sweep can find it.
          store.recordSignedMax(intentId, amount);
          store.markSettlementBroadcast(intentId, "evm-usdc-transfer", txHash);
        },
      });
    } catch (e) {
      const code = e instanceof VaultTransferError ? e.code : "TRANSFER_FAILED";
      const message = e instanceof Error ? e.message : String(e);
      if (broadcastHash) {
        // A transaction exists. It may confirm later (timeout) or may have
        // reverted; either way a clean "failed" would invite a second send.
        // Count it against the caps and leave it for reconciliation.
        guard.commit();
        store.finishSettlement(intentId, {
          state: "needs_review",
          error: message,
          rail: "evm-usdc-transfer",
          txHash: broadcastHash,
        });
        // Outcome unknown: rechecked from the receipt, handed to a named human
        // at the second deadline. The amount stays reserved against the org.
        const unknown = unknownDeadlines();
        store.markOutcomeUnknown(intentId, { ...unknown, error: message });
        recordObs({
          name: "treasury.withdraw.uncertain",
          orgId: org.id,
          attrs: { code, amountUsdc: input.amountUsdc, txHash: broadcastHash },
        });
        return {
          status: 409,
          body: {
            outcome: "pending_reconciliation",
            state: "outcome_unknown",
            recheck_after: unknown.recheckAfter,
            escalate_at: unknown.escalateAt,
            status_url: `/v1/guardian/settlements/${intentId}`,
            intentId,
            txHash: broadcastHash,
            explorerUrl: activeChain().explorerTx(broadcastHash),
            error: {
              code: "SETTLEMENT_UNCERTAIN",
              cause: code,
              message: `${message} The ledger was not changed; this withdrawal is held for reconciliation. Do not resubmit it.`,
            },
          },
        };
      }
      guard.fail(e instanceof Error ? e.message : String(e), code);
      recordObs({
        name: "treasury.withdraw.failed",
        orgId: org.id,
        attrs: { code, amountUsdc: input.amountUsdc },
      });
      return {
        status: 400,
        body: { error: { code, message: e instanceof Error ? e.message : String(e) } },
      };
    }
  }

  try {
    store.applyEntries(org.id, [
      {
        id: id("j"),
        orgId: org.id,
        memo: input.memo ?? `treasury_withdraw:${destination}`,
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: orgAvail, deltaMicro: -amount },
          { accountId: `org:${org.id}:external`, deltaMicro: amount },
        ],
      },
    ]);
  } catch (e) {
    // The transfer already went out, so count it against the cap even
    // though the books could not record it — a human must reconcile.
    if (transfer) {
      guard.commit();
      store.finishSettlement(guard.intentId, {
        state: "needs_review",
        error: `Withdrawal confirmed on-chain but the ledger write failed: ${e instanceof Error ? e.message : String(e)}`,
        rail: "evm-usdc-transfer",
        txHash: transfer.txHash,
      });
    } else guard.fail(e instanceof Error ? e.message : String(e), "LEDGER_WRITE_FAILED");
    throw e;
  }
  guard.commit();
  // Close the settlement row opened at broadcast. Without this a confirmed,
  // booked withdrawal stays `broadcast` and the recovery sweep flags it as
  // "confirmed on-chain but the ledger has no matching entry" ten minutes on.
  if (transfer) {
    store.finishSettlement(guard.intentId, {
      state: "settled",
      rail: "evm-usdc-transfer",
      chargedMicro: amount,
      txHash: transfer.txHash,
    });
  }
  recordObs({
    name: "treasury.withdraw",
    orgId: org.id,
    attrs: { amountUsdc: input.amountUsdc },
  });
  return {
    status: 200,
    body: {
      ok: true,
      outcome: "allow",
      intentId: guard.intentId,
      amountUsdc: input.amountUsdc,
      assetId,
      symbol: "USDC",
      txHash: transfer?.txHash,
      explorerUrl: transfer?.explorerUrl,
    },
  };
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
    kind: m.kind ?? "move",
    ...(m.destination && { destination: m.destination }),
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
      // Only the caller's org: a request's subrequest budget must not pay for
      // every tenant's chain scan (the alarm sweeps everyone round-robin).
      void runOnchainDepositSweep({ orgIds: [org.id] }).catch((e) =>
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

  /**
   * Org holdings, each labelled with how it is backed.
   *
   * `recorded` is what the books say. `onchain` is what the chain says, for
   * assets with an adapter — null when unknown, never 0, because a failed read
   * must not read as an empty wallet.
   */
  app.get(
    "/v1/guardian/assets",
    guardianRoute(async (org, req, res) => {
      const holdings = store.listOrgAssetHoldings(org.id);
      const vault = store.getVaultAddress(org.id);
      // Opt out with ?onchain=0 — the roster renders fine without a chain
      // round trip, and some callers poll it.
      const wantChain = req.query.onchain !== "0";
      const reads = wantChain
        ? await readAssetsOnchain(
            holdings.map((h) => h.asset),
            vault,
          )
        : holdings.map((h) => ({
            assetId: h.asset.id,
            symbol: h.asset.symbol,
            backing: assetBacking(h.asset),
            onchainMicro: null as string | null,
            error: undefined as string | undefined,
          }));
      const byId = new Map(reads.map((r) => [r.assetId, r]));

      res.json({
        assets: holdings.map(({ asset, balanceMicro }) => {
          const read = byId.get(asset.id);
          const onchainMicro = read?.onchainMicro ?? null;
          // USDC lives on the double-entry spend rail, so its authoritative
          // comparison is the backing report, not this per-asset balance.
          const recordedMicro = asset.id === USDC_ASSET_ID ? null : balanceMicro;
          const drift =
            onchainMicro != null && recordedMicro != null
              ? BigInt(onchainMicro) - recordedMicro
              : null;
          const backing = read?.backing ?? assetBacking(asset);
          return {
            ...asset,
            networkName: backing.networkName,
            chainId: backing.chainId ?? null,
            balance: formatAssetAmount(balanceMicro, asset.decimals),
            balanceMicro: balanceMicro.toString(),
            spendRail: asset.id === USDC_ASSET_ID,
            onchainSync: read?.backing.kind === "chain",
            backing,
            onchainMicro,
            onchainBalance:
              onchainMicro != null ? formatAssetAmount(BigInt(onchainMicro), asset.decimals) : null,
            onchainError: read?.error,
            driftMicro: drift?.toString() ?? null,
            drift: drift != null ? formatAssetAmount(drift, asset.decimals) : null,
          };
        }),
      });
    }),
  );

  app.post(
    "/v1/guardian/departments",
    guardianRoute(
      (org, req, res) => {
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
      },
      { ownerOnly: true },
    ),
  );

  /** Alias: create a budget (same ledger as department). See docs/decisions/2026-07-21-budgets-vs-team-membership.md */
  app.post(
    "/v1/guardian/budgets",
    guardianRoute(
      (org, req, res) => {
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
            opsLabel = scopedStore(org.id).getAgentGroup(sameName.id);
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
      },
      { ownerOnly: true },
    ),
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
    guardianRoute(
      (_org, _req, res) => {
        // Soft-deprecated: Picture A uses budgets (envelopes) instead of shared pools.
        // Existing pools remain readable/movable for drain; new creates are refused.
        res.setHeader("Deprecation", "true");
        res.setHeader("Link", '</v1/guardian/budgets>; rel="successor-version"');
        return res.status(410).json({
          error: {
            code: "DEPRECATED",
            message:
              "Shared pools are legacy. Create a group budget, then assign agents to its group.",
            successor: "/v1/guardian/budgets",
          },
        });
      },
      { ownerOnly: true },
    ),
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
    guardianRoute(
      (org, req, res) => {
        const wallet = scopedStore(org.id).getSharedWallet(req.params.id);
        if (!wallet) {
          return res.status(404).json({ error: { code: "NOT_FOUND", message: "shared wallet" } });
        }
        const body = z.object({ memberAgentIds: z.array(z.string()) }).parse(req.body);
        for (const agentId of body.memberAgentIds) {
          const a = scopedStore(org.id).getAgent(agentId);
          if (!a) {
            return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
          }
        }
        store.setSharedWalletMembers(wallet.id, body.memberAgentIds);
        res.json({ wallet: scopedStore(org.id).getSharedWallet(wallet.id) });
      },
      { ownerOnly: true },
    ),
  );

  /**
   * Unified multi-wallet move. Amounts above org treasury HITL threshold park
   * for multi-guardian approval (treasury multisig).
   */
  app.post(
    "/v1/guardian/wallets/move",
    guardianRoute(
      (org, req, res) => {
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

        if (body.from.scope === "agent" || body.to.scope === "agent") {
          return res.status(410).json({
            error: {
              code: "INDIVIDUAL_AGENT_FUNDS_REMOVED",
              message: "Agents do not own wallets. Move funds to or between group budgets instead.",
            },
          });
        }

        if (body.from.scope === body.to.scope && body.from.id === body.to.id) {
          return res.status(400).json({
            error: {
              code: "VALIDATION_ERROR",
              message: "Source and destination are the same wallet",
            },
          });
        }
        const fromOwner = resolveWalletOwner(org, body.from as WalletRef);
        const toOwner = resolveWalletOwner(org, body.to as WalletRef);
        if (!fromOwner || !toOwner) {
          return res.status(404).json({ error: { code: "NOT_FOUND", message: "wallet" } });
        }
        if (!store.getAsset(body.assetId)) {
          return res
            .status(400)
            .json({ error: { code: "VALIDATION_ERROR", message: "Unknown asset" } });
        }

        const amount = parseUsdcToMicro(body.amountUsdc);
        if (amount <= 0n) {
          return res
            .status(400)
            .json({ error: { code: "VALIDATION_ERROR", message: "Amount must be positive" } });
        }

        const available =
          store.getAccountMap(org.id).get(accountId(body.from.scope, fromOwner))?.balanceMicro ??
          0n;
        if (amount > available) {
          return res.status(400).json({
            error: {
              code: "INSUFFICIENT_STIPEND",
              message: `${walletLabel(org, body.from as WalletRef)} has ${formatMicroToUsdc(available)} available`,
            },
          });
        }

        const hitl = treasuryHitlMicro(org);
        const needsApproval =
          !body.forceImmediate && treasuryThresholdOutcome(amount, hitl) === "review";
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
            thresholdUsdc: formatMicroToUsdc(hitl),
            awaitingVotes: Math.max(0, treasuryQuorum(org.id) - move.votes.length),
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
        res.json({
          outcome: "allow",
          move: moveView(scopedStore(org.id).getTreasuryMove(moveId)!),
        });
      },
      { ownerOnly: true },
    ),
  );

  app.get(
    "/v1/guardian/treasury/moves",
    guardianRoute((org, req, res) => {
      const status = req.query.status ? String(req.query.status) : undefined;
      res.json({ moves: store.listTreasuryMoves(org.id, status).map(moveView) });
    }),
  );

  /**
   * Guardian review for parked treasury requests (moves and withdrawals that
   * went above the treasury approval threshold). Any one denial stops it;
   * `approvalQuorum` distinct approvals (the requester's own counts) run it.
   */
  app.post(
    "/v1/guardian/treasury/moves/:id/resolve",
    guardianRoute(async (org, req, res) => {
      const body = z
        .object({ approve: z.boolean(), resolvedBy: z.string().optional() })
        .parse(req.body);
      const move = scopedStore(org.id).getTreasuryMove(req.params.id);
      if (!move) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "treasury move" } });
      }
      if (move.status !== "pending") {
        return res.json({ ok: true, move: moveView(move), replayed: true });
      }

      // The vote belongs to whoever is authenticated. A client-supplied name
      // used to be accepted here, which let one guardian satisfy a 2-of-N
      // quorum alone by resolving twice under two names.
      const voter = guardianIdentity(req);
      if (!body.approve) {
        store.updateTreasuryMove(move.id, {
          status: "denied",
          votes: [...new Set([...move.votes, voter])],
          resolvedAt: new Date().toISOString(),
          resolvedBy: voter,
        });
        return res.json({
          ok: true,
          move: moveView(scopedStore(org.id).getTreasuryMove(move.id)!),
        });
      }

      const votes = [...new Set([...move.votes, voter])];
      const quorum = treasuryQuorum(org.id);
      if (votes.length < quorum) {
        store.updateTreasuryMove(move.id, { votes });
        return res.json({
          ok: true,
          move: moveView(scopedStore(org.id).getTreasuryMove(move.id)!),
          awaitingVotes: quorum - votes.length,
        });
      }

      if (move.kind === "withdraw") {
        // Take it before awaiting anything: a second approval racing this one
        // must see it as no longer pending, or the money could leave twice.
        if (!store.claimPendingTreasuryMove(move.id, votes, voter)) {
          return res.json({
            ok: true,
            move: moveView(scopedStore(org.id).getTreasuryMove(move.id)!),
            replayed: true,
          });
        }
        let result: WithdrawResult;
        try {
          result = await performUsdcWithdraw({
            org,
            actor: voter,
            amount: move.amountMicro,
            amountUsdc: formatMicroToUsdc(move.amountMicro),
            destination: move.destination,
            memo: move.memo,
          });
        } catch (e) {
          store.updateTreasuryMove(move.id, { status: "cancelled", resolvedBy: "system" });
          throw e;
        }
        if (result.status === 409) {
          // Broadcast but unconfirmed: never record a cancel while money may
          // have moved. The move stays executed; the settlement row (outcome
          // unknown) is what gets reconciled.
          return res.status(409).json({
            ...result.body,
            move: moveView(scopedStore(org.id).getTreasuryMove(move.id)!),
          });
        }
        if (result.status !== 200) {
          // Approved, but the guard or the chain refused it now. Nothing moved.
          store.updateTreasuryMove(move.id, {
            status: "cancelled",
            resolvedAt: new Date().toISOString(),
            resolvedBy: "system",
          });
          return res.status(result.status).json({
            ...result.body,
            move: moveView(scopedStore(org.id).getTreasuryMove(move.id)!),
          });
        }
        const done = scopedStore(org.id).getTreasuryMove(move.id)!;
        emitEvent(org.id, "treasury.move.executed", moveView(done));
        return res.json({ ok: true, move: moveView(done), withdrawal: result.body });
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
      const done = scopedStore(org.id).getTreasuryMove(move.id)!;
      emitEvent(org.id, "treasury.move.executed", moveView(done));
      res.json({ ok: true, move: moveView(done) });
    }),
  );

  /**
   * Record a holding by hand — only for assets ABI cannot read from a chain
   * (no adapter / no RPC). USDC and chain-read assets are refused: their
   * balance must come from money that actually arrived at the vault address
   * (credited by the on-chain deposit sweep). Simulated sandbox top-ups were
   * removed with sandbox mode.
   */
  app.post(
    "/v1/guardian/treasury/deposit",
    guardianRoute(
      (org, req, res) => {
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
          return res
            .status(400)
            .json({ error: { code: "VALIDATION_ERROR", message: "Unknown asset" } });
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
          return res
            .status(400)
            .json({ error: { code: "VALIDATION_ERROR", message: "Amount must be positive" } });
        }

        // USDC is credited only by on-chain deposit detection.
        if (assetId === "asset_usdc") {
          return res.status(400).json({
            error: {
              code: "UNBACKED_DEPOSIT_REFUSED",
              message:
                "Send USDC to the vault address instead — it is credited automatically once the transfer confirms.",
              vaultAddress: store.getVaultAddress(org.id),
              network: activeChain().id,
            },
          });
        }

        // Same rule as USDC: if a balance can be read from the chain, it may not
        // be typed in. Assets without an adapter stay manual — that is a gap in
        // coverage, not permission to invent numbers where coverage exists.
        if (assetBacking(asset).kind === "chain") {
          return res.status(400).json({
            error: {
              code: "UNBACKED_DEPOSIT_REFUSED",
              message: `${asset.symbol} balances are read from the chain. Send ${asset.symbol} to the vault address instead of recording it by hand.`,
              vaultAddress: store.getVaultAddress(org.id),
              chain: asset.chain,
            },
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
        recordObs({
          name: "treasury.deposit",
          orgId: org.id,
          attrs: { amountUsdc: body.amountUsdc, assetId },
        });
        res.json({
          ok: true,
          amountUsdc: body.amountUsdc,
          assetId,
          symbol: asset.symbol,
          balance: formatAssetAmount(bal, asset.decimals),
          // A typed-in amount is never an on-chain deposit.
          recordedOnly: true,
          onchain: false,
        });
      },
      { ownerOnly: true },
    ),
  );

  /**
   * Withdraw from org treasury / holdings.
   *
   * Live orgs broadcast a real USDC transfer from the vault and only book the
   * outflow once the transfer succeeds — the ledger never claims money left
   * unless it did.
   *
   * Every withdrawal passes the guardian treasury guard first (org freeze,
   * blocklist, optional destination allowlist, per-withdrawal and rolling 24h
   * caps) and is recorded as a decision — no human path moves money out of the
   * org without a policy check. See treasury-guard.ts.
   */
  app.post(
    "/v1/guardian/treasury/withdraw",
    guardianRoute(
      async (org, req, res) => {
        const body = z
          .object({
            amountUsdc: z.string(),
            destination: z.string().optional(),
            memo: z.string().max(120).optional(),
            assetId: z.string().optional(),
            /** Safe-retry key; the `Idempotency-Key` header works too. */
            idempotencyKey: z.string().min(8).max(128).optional(),
          })
          .parse(req.body);
        const idemRaw =
          body.idempotencyKey ??
          (typeof req.headers["idempotency-key"] === "string"
            ? req.headers["idempotency-key"]
            : undefined);
        if (idemRaw !== undefined && (idemRaw.length < 8 || idemRaw.length > 128)) {
          return res.status(400).json({
            error: {
              code: "VALIDATION_ERROR",
              message: "Idempotency key must be 8-128 characters.",
              field: "idempotencyKey",
            },
          });
        }
        // Make the withdrawal safe to retry: the same key replays the first
        // result instead of sending twice. A key reused for a different
        // request, or one still in flight, maps to "unknown", never "failed".
        let idem: { key: string; expiresAt?: string } | undefined;
        if (idemRaw) {
          const key = `withdraw:${idemRaw}`;
          const requestHash = sha256Hex(
            canonicalJson({
              amountUsdc: body.amountUsdc.trim(),
              destination: body.destination?.trim().toLowerCase() ?? null,
              assetId: body.assetId?.trim() || "asset_usdc",
              memo: body.memo ?? null,
            }),
          );
          if (!store.reserveIdempotent(org.id, key, { requestHash })) {
            const meta = store.getIdempotentMeta(org.id, key);
            const existing = store.getIdempotent(org.id, key) as
              (Record<string, unknown> & { status?: string; httpStatus?: number }) | undefined;
            if (meta?.requestHash && meta.requestHash !== requestHash) {
              return res.status(409).json({
                outcome: "unknown",
                state: "outcome_unknown",
                error: {
                  code: "IDEMPOTENCY_MISMATCH",
                  message:
                    "This idempotency key was already used for a different withdrawal. Treat that one's outcome as unknown and read its status; do not resend under a new key.",
                },
                ...(typeof existing?.intentId === "string" && {
                  intentId: existing.intentId,
                  status_url: `/v1/guardian/settlements/${existing.intentId}`,
                }),
              });
            }
            if (!existing || existing.status === "in_flight") {
              return res.status(409).json({
                outcome: "unknown",
                state: "outcome_unknown",
                recheck_after: new Date(Date.now() + 5_000).toISOString(),
                error: {
                  code: "IDEMPOTENCY_IN_FLIGHT",
                  message:
                    "A withdrawal with this key is still in flight. Its outcome is unknown until it finishes; retry the same key later.",
                },
              });
            }
            const { httpStatus, ...payload } = existing;
            return res
              .status(typeof httpStatus === "number" ? httpStatus : 200)
              .json({ ...payload, replayed: true });
          }
          idem = { key, expiresAt: store.getIdempotentMeta(org.id, key)?.expiresAt };
        }
        // Record the final answer under the key. A clean "nothing was sent"
        // failure frees the key so the same request can simply be retried.
        const finish = (status: number, payload: Record<string, unknown>) => {
          if (idem) {
            const nothingSent =
              status >= 400 &&
              status !== 403 &&
              status !== 409 &&
              payload.outcome !== "pending_reconciliation";
            if (nothingSent) store.releaseIdempotent(org.id, idem.key);
            else store.setIdempotent(org.id, idem.key, { ...payload, httpStatus: status });
          }
          return res.status(status).json(payload);
        };
        try {
          return await withdrawRoute(body, idem);
        } catch (e) {
          // An unexpected throw may have come after the broadcast (e.g. the
          // ledger write). Never free the key on a guess: a retry under it
          // reads "unknown" and the settlement row says what happened.
          if (idem) {
            store.setIdempotent(org.id, idem.key, {
              outcome: "unknown",
              state: "outcome_unknown",
              error: {
                code: "OUTCOME_UNKNOWN",
                message:
                  "The first attempt with this key ended unexpectedly. Check the treasury settlements before sending again.",
              },
              httpStatus: 409,
            });
          }
          throw e;
        }

        async function withdrawRoute(
          body: {
            amountUsdc: string;
            destination?: string;
            memo?: string;
            assetId?: string;
          },
          idem: { key: string; expiresAt?: string } | undefined,
        ) {
          const assetId = body.assetId?.trim() || "asset_usdc";
          const asset = store.getAsset(assetId);
          if (!asset) {
            return res
              .status(400)
              .json({ error: { code: "VALIDATION_ERROR", message: "Unknown asset" } });
          }

          if (assetId === "asset_usdc") {
            let amount: bigint;
            try {
              amount = parseUsdcToMicro(body.amountUsdc);
            } catch {
              return res
                .status(400)
                .json({ error: { code: "VALIDATION_ERROR", message: "Invalid USDC amount" } });
            }
            const orgAvail = accountId("org", org.id);
            const available = store.getAccountMap(org.id).get(orgAvail)?.balanceMicro ?? 0n;
            if (amount <= 0n || amount > available) {
              return finish(400, {
                error: {
                  code: "INSUFFICIENT_STIPEND",
                  message: `Org has ${formatMicroToUsdc(available)} available`,
                },
              });
            }

            const destination = body.destination?.trim();
            if (!destination || !/^0x[a-fA-F0-9]{40}$/.test(destination)) {
              return finish(400, {
                error: {
                  code: "VALIDATION_ERROR",
                  message: "A 0x destination address is required to withdraw real USDC.",
                },
              });
            }
            const actor = guardianIdentity(req);

            // Above the treasury approval threshold: park for guardian review
            // instead of sending. The guard still runs first (as a dry run), so
            // a request the hard limits would refuse is refused now rather than
            // parked, and an approval is never stacked on top of a refusal.
            const threshold = treasuryHitlMicro(org);
            if (treasuryThresholdOutcome(amount, threshold) === "review") {
              const check = guardTreasuryWithdraw({
                org,
                actor,
                assetId,
                amountMicro: amount,
                amountDisplay: formatMicroToUsdc(amount),
                destination,
                dryRun: true,
              });
              if (!check.ok) return finish(check.status, withdrawDenialBody(check));
              const move = store.createTreasuryMove({
                id: id("tmv"),
                orgId: org.id,
                kind: "withdraw",
                fromScope: "org",
                fromId: org.id,
                toScope: "org",
                toId: "external",
                destination,
                amountMicro: amount,
                assetId,
                memo: body.memo,
                status: "pending",
                votes: [actor],
                createdAt: new Date().toISOString(),
              });
              emitEvent(org.id, "treasury.move.pending", moveView(move));
              void notify({
                kind: "info",
                orgId: org.id,
                title: "Treasury withdrawal needs approval",
                body: `${formatMicroToUsdc(amount)} USDC → ${destination ?? "external"}`,
                meta: { moveId: move.id },
              });
              return finish(202, {
                ok: true,
                outcome: "review",
                move: moveView(move),
                thresholdUsdc: formatMicroToUsdc(threshold),
                awaitingVotes: Math.max(0, treasuryQuorum(org.id) - move.votes.length),
                hint: "A guardian approves it under Treasury → Move → Activity.",
              });
            }

            const result = await performUsdcWithdraw({
              org,
              actor,
              amount,
              amountUsdc: body.amountUsdc,
              destination,
              memo: body.memo,
              idempotencyKey: idem?.key,
              idempotencyExpiresAt: idem?.expiresAt,
            });
            return finish(result.status, result.body);
          }

          // No bookkeeping in place of settlement: a live org cannot "send" an
          // asset that is read from the chain unless a real send rail exists.
          const sendSupport = assetSendSupport(asset);
          if (sendSupport.mode === "unsupported") {
            return finish(409, {
              error: {
                code: "ASSET_SEND_UNSUPPORTED",
                message: sendSupport.reason,
                assetId,
                symbol: asset.symbol,
              },
            });
          }
          let amount: bigint;
          try {
            amount = parseAssetAmount(body.amountUsdc, asset.decimals);
          } catch {
            return finish(400, {
              error: { code: "VALIDATION_ERROR", message: `Invalid ${asset.symbol} amount` },
            });
          }
          const available = store.getOrgAssetBalance(org.id, assetId);
          if (amount <= 0n || amount > available) {
            return finish(400, {
              error: {
                code: "INSUFFICIENT_STIPEND",
                message: `Vault has ${formatAssetAmount(available, asset.decimals)} ${asset.symbol}`,
              },
            });
          }
          // Recorded holdings, not a chain broadcast — but still money the org
          // says it sent, so freeze / blocklist / allowlist apply. USDC caps do not.
          const guard = guardTreasuryWithdraw({
            org,
            actor: guardianIdentity(req),
            assetId,
            amountMicro: amount,
            amountDisplay: `${formatAssetAmount(amount, asset.decimals)} ${asset.symbol}`,
            destination: body.destination,
          });
          if (!guard.ok) return finish(guard.status, withdrawDenialBody(guard));
          const bal = store.creditOrgAsset(org.id, assetId, -amount);
          guard.commit();
          store.addVaultAssetEvent({
            orgId: org.id,
            assetId,
            kind: "out",
            amountMicro: amount,
            memo: body.memo ?? "vault_send",
            counterparty: body.destination,
          });
          return finish(200, {
            ok: true,
            intentId: guard.intentId,
            amountUsdc: body.amountUsdc,
            assetId,
            symbol: asset.symbol,
            balance: formatAssetAmount(bal, asset.decimals),
            // Nothing was broadcast. Say exactly what happened.
            sendMode: sendSupport.mode,
            recordedOnly: true,
          });
        }
      },
      { ownerOnly: true },
    ),
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

  /**
   * Wallet source of truth: the verified receiving address, its network and
   * chain id, native gas (separate from USDC), ledger vs on-chain balances,
   * and what "send" really does for each asset. See chain/wallet-profile.ts.
   */
  app.get(
    "/v1/guardian/wallet",
    guardianRoute(async (org, _req, res) => {
      const address = store.getVaultAddress(org.id);
      let snap = null;
      try {
        snap = await readVaultOnchain(address, { balancesOnly: true });
      } catch {
        snap = null;
      }
      let custodyProvider: string | null = null;
      try {
        custodyProvider = getCustodyProvider().name;
      } catch {
        custodyProvider = null;
      }
      const profile = buildWalletProfile({
        orgId: org.id,
        vaultAddress: address,
        vaultPrivateKey: store.getVaultPrivateKey(org.id),
        custodyProvider,
        assets: store.listAssets(org.id),
        ledgerAvailableMicro:
          store.getAccountMap(org.id).get(accountId("org", org.id))?.balanceMicro ?? 0n,
        unbackedMicro: store.getUnbackedMicro(org.id),
        snap,
      });
      res.json(profile);
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
        // Degrade gracefully: the console still needs vault address / network
        // metadata when the RPC is cold or rate-limited. A hard 502 made the
        // Fund tab look broken even though the ledger was fine.
        return res.status(200).json({
          onchain: {
            ...result.snap,
            ok: false,
            error: result.error ?? "Could not read vault on-chain",
            transfers: [],
          },
          backing: null,
          newlyCredited: [],
          creditedCount: 0,
          credited: [],
          ledgerAvailableUsdc: result.ledgerAvailableUsdc,
          autoSynced: false,
          chainUnavailable: true,
          note:
            result.error ??
            "On-chain status is temporarily unavailable. Ledger balances below are still authoritative.",
        });
      }
      const { credited, transfers } = decorateOnchainTransfers(result.snap, org.id);
      // Reuse the snapshot the sync already read — and compute backing after
      // crediting, so the expectation includes deposits found on this pass.
      const backing = await reconcileOrgOnchain(org.id, result.snap);
      res.json({
        onchain: { ...result.snap, transfers },
        backing,
        newlyCredited: result.newly,
        creditedCount: result.newly.length,
        credited,
        ledgerAvailableUsdc: result.ledgerAvailableUsdc,
        autoSynced: true,
        ...(result.logsError ? { logsError: result.logsError } : {}),
        note:
          result.newly.length > 0
            ? `Auto-credited ${result.newly.length} on-chain deposit(s) into the org vault ledger.`
            : result.logsError
              ? "Vault balance is current. The deposit scan will retry on the next sweep."
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
        kind: "demo_in" | "withdraw" | "writeoff";
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

        // Internal budget allocation (seed_demo_budget) debits org:available and
        // credits a department — that is not a vault deposit/withdrawal. Showing
        // it as -40 USDC confused the demo seed path.
        if (memo.includes("seed_demo_budget") || memo.includes("seed_budget")) continue;

        if (memo.startsWith("sandbox_writeoff:")) {
          ledgerItems.push({
            id: j.id,
            kind: "writeoff",
            source: "ledger",
            assetId: "asset_usdc",
            symbol: "USDC",
            amount: amt,
            amountUsdc: amt,
            direction: delta < 0n ? "out" : "in",
            at: j.createdAt,
            label: "Simulated sandbox balance written off (nothing sent on-chain)",
            memo: j.memo,
          });
          continue;
        }
        if (
          (memo.includes("treasury_deposit") ||
            memo.includes("sandbox_deposit") ||
            memo === "deposit") &&
          delta > 0n
        ) {
          ledgerItems.push({
            id: j.id,
            kind: "demo_in",
            source: "ledger",
            assetId: "asset_usdc",
            symbol: "USDC",
            amount: amt,
            amountUsdc: amt,
            direction: "in",
            at: j.createdAt,
            label: "Demo ledger credit",
            memo: j.memo,
          });
        } else if (
          memo.includes("treasury_withdraw") ||
          memo.includes("withdraw") ||
          memo.includes("sandbox_withdraw")
        ) {
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
          label:
            e.kind === "in"
              ? `Received ${asset?.symbol ?? "asset"}`
              : `Sent ${asset?.symbol ?? "asset"}`,
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
    guardianRoute(
      async (org, req, res) => {
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
        const snap = await readVaultOnchain(store.getVaultAddress(org.id), {
          balancesOnly: true,
        });
        // An unreadable vault is not an empty vault. Rotating blind could strand
        // whatever it holds, so refuse outright until the balance can be read.
        if (!snap.ok && store.getVaultAddress(org.id)) {
          return res.status(503).json({
            error: {
              code: "CHAIN_UNAVAILABLE",
              message:
                "Could not read the vault balance on-chain, so rotation is refused — it might " +
                "still hold funds. Retry when the chain is reachable.",
            },
          });
        }
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

        const rotated = store.rotateVaultKey(
          org.id,
          body.note ? `guardian:${body.note}` : "guardian_rotation",
        );
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
      },
      { ownerOnly: true },
    ),
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
    guardianRoute(
      (org, req, res) => {
        const body = z.object({ agentId: z.string() }).parse(req.body);
        const agent = scopedStore(org.id).getAgent(body.agentId);
        if (!agent) {
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
      },
      { ownerOnly: true },
    ),
  );
}
