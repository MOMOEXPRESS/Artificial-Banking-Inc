/**
 * Reconcile settlements left in flight, and recheck uncertain payments.
 *
 * A settlement has an irreversible middle: the rail broadcasts (or signs an
 * EIP-3009 authorization a seller can claim later), and only then does the
 * ledger record it. `settlement_attempts` makes that window observable; this
 * job closes it.
 *
 * Stuck sweep (rows left `pending` / `broadcast`):
 *   pending   + stale, never signed -> nothing left the building; failed.
 *   broadcast + stale               -> something may have moved: the row
 *                                      becomes `outcome_unknown` with a named
 *                                      resolver and two deadlines. Never guess.
 *
 * Recheck pass (rows in `outcome_unknown`, Oct 30 reliability):
 *   - Only two moves exist: READ the outcome with the resolver named on the
 *     row, or ESCALATE to the named human at the second deadline.
 *   - Resolvers: `x402:authorization_state` asks the USDC contract whether the
 *     EIP-3009 nonce was used (a seller "voucher claim"); `chain:tx_receipt`
 *     asks whether a transaction was mined. `human` means nothing to read.
 *   - Evidence of a claim/mined tx  -> `claimed_unbooked`, handed to a human to
 *     book (a background job never books a payment on its own evidence).
 *   - Authorization unused AND past its validBefore -> `expired_unclaimed`:
 *     it can never be claimed, so the held amount goes back to the agent and
 *     the row says where it went.
 *   - Reverted tx -> `failed`, held amount goes back, row says where.
 *   - Anything else (RPC down, not mined yet, still valid) stays unknown:
 *     the amount stays held and counted, `recheck_after` moves forward.
 *   - Deadlines use the store's clock, so a restarted or skewed worker can
 *     neither retry the payment nor declare it failed.
 */
import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import { releaseHold } from "@policyvault/ledger";
import { activeChain, rpcUrl } from "../chain/network.js";
import { notify } from "../platform/notifier.js";
import { recordObs } from "../platform/observability.js";
import {
  idempotencyTtlMs,
  store,
  storeNowMs,
  type SettlementOutcome,
  type SettlementRow,
  type SignedAuthorization,
} from "../store.js";
import { emitEvent } from "../webhooks.js";

/**
 * How long an attempt may sit before it is considered stuck. Comfortably
 * longer than the rail's own confirmation timeout, so a slow-but-healthy
 * payment is never disturbed.
 */
function stuckAfterMs(): number {
  return Number(process.env.ABI_SETTLEMENT_STUCK_MINUTES ?? 10) * 60_000;
}

function minutesEnv(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) && n >= 0 ? n * 60_000 : fallback * 60_000;
}

/** First deadline: how soon an unknown outcome is read again (default 2 min). */
export function recheckIntervalMs(): number {
  return minutesEnv("ABI_RECHECK_MINUTES", 2);
}

/**
 * Second deadline: how long an outcome may stay unknown before it is handed
 * to a named human (default 60 min). Always well before the idempotency key
 * expires, so the escalation happens while a retry still replays.
 */
export function escalateAfterMs(): number {
  return Math.min(minutesEnv("ABI_UNKNOWN_ESCALATE_MINUTES", 60), idempotencyTtlMs() / 2);
}

/** Grace after an authorization's validBefore before calling it expired. */
const EXPIRY_GRACE_MS = 60_000;

/** Both deadlines for an outcome that just became unknown (store clock). */
export function unknownDeadlines(nowMs = storeNowMs()): {
  recheckAfter: string;
  escalateAt: string;
} {
  return {
    recheckAfter: new Date(nowMs + recheckIntervalMs()).toISOString(),
    escalateAt: new Date(nowMs + escalateAfterMs()).toISOString(),
  };
}

/** The named person an unknown outcome goes to: the org's owner. */
export function escalationOwner(orgId: string): string {
  try {
    const owner = store.listMembersOfOrg(orgId).find((m) => m.role === "owner");
    if (owner) return `owner:${owner.name || owner.email}`;
  } catch {
    /* fall through */
  }
  const org = store.getOrg(orgId);
  return `owner:${org ? `${org.name} owner` : "organization owner"}`;
}

/** Which resolver can read this row's outcome. */
export function resolverFor(row: Pick<SettlementRow, "authorization" | "txHash" | "rail">): string {
  if (row.authorization?.nonce) return "x402:authorization_state";
  if (row.txHash && isTxHash(row.txHash)) return "chain:tx_receipt";
  if (row.rail === "evm-usdc-transfer") return "chain:tx_receipt";
  return "human";
}

function isTxHash(v?: string): v is `0x${string}` {
  return Boolean(v && /^0x[0-9a-fA-F]{64}$/.test(v));
}

function isMockHash(txHash?: string): boolean {
  return Boolean(txHash?.startsWith("0xmock_"));
}

// ------------------------------------------------------------------ readers

export type ReadVerdict = "used" | "unused" | "unknown";
export type TxVerdict = "success" | "reverted" | "unknown";

export interface OutcomeReaders {
  /** Has this EIP-3009 nonce been used on-chain (a seller claimed it)? */
  authorizationState(auth: SignedAuthorization): Promise<ReadVerdict>;
  /** Was this transaction mined, and did it succeed? */
  txStatus(txHash: string): Promise<TxVerdict>;
  /** The vault's on-chain nonce (direct sends only move it). Null if unreadable. */
  vaultNonce(address: string): Promise<number | null>;
  /**
   * USDC Transfer logs out of `from` in one transaction's receipt — the
   * evidence for EIP-3009 / batch payments, which do not move the vault nonce.
   */
  transfersFrom(txHash: string, from: string): Promise<{ to: string; valueMicro: bigint }[] | null>;
}

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const authorizationStateAbi = [
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

function publicClient() {
  const cfg = activeChain();
  return createPublicClient({
    chain: cfg.id === "base" ? base : baseSepolia,
    transport: http(rpcUrl(cfg), { timeout: 15_000 }),
  });
}

const chainReaders: OutcomeReaders = {
  async authorizationState(auth) {
    try {
      if (!auth.payer || !auth.asset || !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) return "unknown";
      const onBase = activeChain().id === "base";
      // Only read on the chain this deployment is configured for.
      if (auth.network && (auth.network === "eip155:8453") !== onBase) return "unknown";
      const used = await publicClient().readContract({
        address: auth.asset as `0x${string}`,
        abi: authorizationStateAbi,
        functionName: "authorizationState",
        args: [auth.payer as `0x${string}`, auth.nonce as `0x${string}`],
      });
      return used ? "used" : "unused";
    } catch {
      return "unknown";
    }
  },
  async txStatus(txHash) {
    try {
      const receipt = await publicClient().getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });
      return receipt.status === "success" ? "success" : "reverted";
    } catch {
      // Not mined yet, or the RPC is unreachable. Both mean "do not conclude".
      return "unknown";
    }
  },
  async vaultNonce(address) {
    try {
      return await publicClient().getTransactionCount({ address: address as `0x${string}` });
    } catch {
      return null;
    }
  },
  async transfersFrom(txHash, from) {
    try {
      const receipt = await publicClient().getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });
      const fromTopic = `0x${from.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
      return receipt.logs
        .filter(
          (l) =>
            l.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
            l.topics[1]?.toLowerCase() === fromTopic,
        )
        .map((l) => ({
          to: `0x${(l.topics[2] ?? "").slice(-40)}`,
          valueMicro: BigInt(l.data),
        }));
    } catch {
      return null;
    }
  },
};

let readers: OutcomeReaders = chainReaders;

/** The chain readers in use (real, or a test's stand-ins). */
export function outcomeReaders(): OutcomeReaders {
  return readers;
}

/** Test hook: replace the chain readers (undefined restores the real ones). */
export function __setOutcomeReadersForTests(r?: Partial<OutcomeReaders>): void {
  readers = r ? { ...chainReaders, ...r } : chainReaders;
}

// ------------------------------------------------------------------ actions

/**
 * Give the held amount back to the account it came from and record where it
 * went. Agent payments only; a treasury withdrawal never booked anything.
 */
function releaseRemainingHold(row: SettlementRow, reason: string): bigint {
  if (!row.heldAccountId || !row.availableAccountId) return 0n;
  const remaining = row.amountMicro - (row.releasedMicro ?? 0n);
  if (remaining <= 0n) return 0n;
  store.applyEntries(row.orgId, [
    releaseHold({
      orgId: row.orgId,
      journalId: `rx_${row.intentId}`,
      intentId: row.intentId,
      agentHeldId: row.heldAccountId,
      agentAvailableId: row.availableAccountId,
      amountMicro: remaining,
    }),
  ]);
  store.recordHoldRelease(row.intentId, {
    amountMicro: remaining,
    to: row.availableAccountId,
    reason,
  });
  return remaining;
}

function announceResolved(row: SettlementRow, outcome: SettlementOutcome, detail: string) {
  const after = store.getSettlement(row.intentId);
  recordObs({
    name: "settlement.outcome_resolved",
    orgId: row.orgId,
    agentId: row.agentId,
    attrs: { intentId: row.intentId, outcome, resolver: row.resolver ?? null },
  });
  emitEvent(row.orgId, "payment.outcome_resolved", {
    intentId: row.intentId,
    agentId: row.agentId,
    outcome,
    resolvedBy: after?.resolvedBy,
    resolvedAt: after?.resolvedAt,
    ...(after?.releasedMicro !== undefined && {
      releasedMicro: after.releasedMicro.toString(),
      releasedTo: after.releasedTo,
    }),
    detail,
  });
}

/** Mark a row unknown (first time) with a resolver, a named human and deadlines. */
function openUnknown(row: SettlementRow, reason: string) {
  store.annotateSettlement(row.intentId, {
    resolver: row.resolver ?? resolverFor(row),
    escalateTo: row.escalateTo ?? escalationOwner(row.orgId),
  });
  // Left behind by a dead worker: read it on this very sweep.
  const d = { ...unknownDeadlines(), recheckAfter: new Date(storeNowMs()).toISOString() };
  store.markOutcomeUnknown(row.intentId, { ...d, error: reason });
  emitEvent(row.orgId, "payment.outcome_unknown", {
    intentId: row.intentId,
    agentId: row.agentId,
    reason,
    recheckAfter: d.recheckAfter,
    escalateAt: d.escalateAt,
  });
}

/** Hand an unknown or claimed-but-unbooked payment to a named human. */
function escalate(row: SettlementRow, reason: string, outcome?: SettlementOutcome) {
  store.finishSettlement(row.intentId, {
    state: "needs_review",
    error: reason,
    rail: row.rail,
    txHash: row.txHash,
  });
  const named = row.escalateTo ?? escalationOwner(row.orgId);
  store.annotateSettlement(row.intentId, {
    resolver: row.resolver ?? resolverFor(row),
    escalateTo: named,
  });
  if (outcome === "claimed_unbooked") {
    store.resolveSettlementOutcome(row.intentId, {
      outcome,
      state: "needs_review",
      resolvedBy: `resolver:${row.resolver ?? resolverFor(row)}`,
    });
  } else {
    store.markOutcomeUnknown(row.intentId, { ...unknownDeadlines(), error: reason });
  }
  store.markEscalated(row.intentId, named);
  recordObs({
    name: "settlement.needs_review",
    orgId: row.orgId,
    agentId: row.agentId,
    attrs: { intentId: row.intentId, txHash: row.txHash ?? null, reason, escalatedTo: named },
  });
  emitEvent(row.orgId, "payment.failed", {
    intentId: row.intentId,
    agentId: row.agentId,
    destination: row.destination,
    txHash: row.txHash,
    reason,
    needsReconciliation: true,
    escalatedTo: named,
  });
  void notify({
    kind: "info",
    orgId: row.orgId,
    title: "Payment needs reconciliation",
    body:
      `Intent ${row.intentId} was left mid-settlement. ${reason}` +
      (row.txHash ? ` Transaction ${row.txHash}.` : "") +
      ` Assigned to ${named.replace(/^owner:/, "")}.`,
    meta: { intentId: row.intentId, txHash: row.txHash, escalatedTo: named },
  });
}

// ------------------------------------------------------------------ stuck sweep

export async function recoverStuckSettlements(): Promise<{
  checked: number;
  failed: number;
  needsReview: number;
  rechecked?: number;
  resolved?: number;
  escalated?: number;
}> {
  const stuck = store.listStuckSettlements(stuckAfterMs());
  let failed = 0;
  let needsReview = 0;

  for (const row of stuck) {
    // Never signed, never broadcast: nothing left the building.
    if (row.state === "pending" && !row.txHash && row.signedMaxMicro === undefined) {
      store.finishSettlement(row.intentId, {
        state: "failed",
        error: "Abandoned before the rail was invoked (process restart or timeout).",
      });
      failed += 1;
      continue;
    }

    // A mock rail never touched a chain, so there is nothing to look up.
    if (isMockHash(row.txHash)) {
      escalate(row, "Simulated settlement interrupted before the ledger was written.");
      needsReview += 1;
      continue;
    }

    if (!row.txHash && !row.authorization) {
      escalate(
        row,
        "Marked broadcast without a transaction hash — cannot determine whether funds moved.",
      );
      needsReview += 1;
      continue;
    }

    // Something may have moved. Make it an explicit unknown with a resolver
    // and two deadlines; the recheck pass below reads it.
    openUnknown(
      row,
      "Left mid-settlement (process restart or timeout); the outcome is being rechecked.",
    );
    needsReview += 1;
  }

  const recheck = await recheckUncertainPayments();
  failed += recheck.failed;
  return {
    checked: stuck.length,
    failed,
    needsReview,
    rechecked: recheck.checked,
    resolved: recheck.resolved,
    escalated: recheck.escalated,
  };
}

// ------------------------------------------------------------------ recheck

/**
 * Read every unknown outcome whose first deadline passed. Never retries a
 * payment and never marks one failed without evidence.
 */
export async function recheckUncertainPayments(): Promise<{
  checked: number;
  resolved: number;
  failed: number;
  escalated: number;
}> {
  const due = store.listDueRechecks();
  let resolved = 0;
  let failed = 0;
  let escalated = 0;
  for (const row of due) {
    const resolver = row.resolver ?? resolverFor(row);
    const nowMs = storeNowMs();
    let verdict: "claimed" | "expired_unclaimed" | "reverted" | "open" = "open";
    let detail = "";

    if (resolver === "x402:authorization_state" && row.authorization) {
      // A real facilitator hash, when we got one, is the stronger evidence.
      const tx = isTxHash(row.txHash) ? await readers.txStatus(row.txHash) : "unknown";
      if (tx === "success") {
        verdict = "claimed";
        detail = `Settlement transaction ${row.txHash} succeeded on-chain.`;
      } else {
        const used = await readers.authorizationState(row.authorization);
        const validBeforeMs = Number(row.authorization.validBefore ?? NaN) * 1000;
        if (used === "used") {
          verdict = "claimed";
          detail = `EIP-3009 authorization ${row.authorization.nonce} was claimed on-chain.`;
        } else if (
          used === "unused" &&
          Number.isFinite(validBeforeMs) &&
          nowMs > validBeforeMs + EXPIRY_GRACE_MS
        ) {
          verdict = "expired_unclaimed";
          detail = `Authorization ${row.authorization.nonce} expired unclaimed at ${new Date(validBeforeMs).toISOString()}; it can never be used.`;
        }
      }
    } else if (resolver === "chain:tx_receipt" && isTxHash(row.txHash)) {
      const tx = await readers.txStatus(row.txHash);
      if (tx === "success") {
        verdict = "claimed";
        detail = `Transaction ${row.txHash} confirmed on-chain.`;
      } else if (tx === "reverted") {
        verdict = "reverted";
        detail = `Transaction ${row.txHash} reverted on-chain; no funds moved.`;
      }
    }

    if (verdict === "claimed") {
      // Already handed over as claimed_unbooked? Leave it with the human.
      if (row.outcome !== "claimed_unbooked") {
        escalate(
          { ...row, resolver },
          `${detail} The ledger has no matching entry; a human must book it.`,
          "claimed_unbooked",
        );
        announceResolved(row, "claimed_unbooked", detail);
        resolved += 1;
      }
      continue;
    }

    if (verdict === "expired_unclaimed" || verdict === "reverted") {
      const outcome: SettlementOutcome =
        verdict === "expired_unclaimed" ? "expired_unclaimed" : "failed";
      // CAS on the outcome still being open: two workers cannot both release.
      if (
        store.resolveSettlementOutcome(row.intentId, {
          outcome,
          state: "failed",
          resolvedBy: `resolver:${resolver}`,
          error: detail,
        })
      ) {
        releaseRemainingHold(row, outcome);
        announceResolved(row, outcome, detail);
        resolved += 1;
        failed += 1;
      }
      continue;
    }

    // Still open. Read again later; at the second deadline, a named human.
    const next = new Date(nowMs + Math.max(recheckIntervalMs(), 1)).toISOString();
    store.scheduleRecheck(row.intentId, next);
    if (row.escalateAt && !row.escalatedAt && nowMs >= Date.parse(row.escalateAt)) {
      const named = row.escalateTo ?? escalationOwner(row.orgId);
      if (store.markEscalated(row.intentId, named)) {
        escalated += 1;
        recordObs({
          name: "settlement.unknown_escalated",
          orgId: row.orgId,
          agentId: row.agentId,
          attrs: { intentId: row.intentId, escalatedTo: named },
        });
        emitEvent(row.orgId, "payment.outcome_resolved", {
          intentId: row.intentId,
          agentId: row.agentId,
          outcome: "outcome_unknown",
          escalatedTo: named,
          detail: "Outcome still unknown at the second deadline; handed to a named human.",
        });
        void notify({
          kind: "info",
          orgId: row.orgId,
          title: "Payment outcome still unknown",
          body: `Intent ${row.intentId}: ABI could not confirm whether money moved. The amount stays held. Assigned to ${named.replace(/^owner:/, "")}.`,
          meta: { intentId: row.intentId, escalatedTo: named },
        });
      }
    }
  }
  return { checked: due.length, resolved, failed, escalated };
}
