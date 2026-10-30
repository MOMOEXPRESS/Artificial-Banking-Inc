/**
 * Read models for payment outcomes, approval records and outflow
 * reconciliation (Oct 30 reliability list, items 2-4).
 *
 *   - `intentStatus`         — the cheap, idempotent status read an agent polls
 *                              (with `recheck_after`) instead of retrying.
 *   - `approvalRecord`       — the approval as the agent may read it: who
 *                              approved and when, the rules hash and policy
 *                              revision it was checked against, and what
 *                              would make it stale.
 *   - `outflowReconciliation`— every send that left (or may have left) the
 *                              vault, with a transfer id, the policy revision
 *                              it ran under, staleness fields, and where any
 *                              released or cancelled money went.
 */
import { formatMicroToUsdc } from "@policyvault/common";
import { getCustodyProvider } from "@policyvault/custody";
import { canonicalJson, sha256Hex } from "./decision-receipts.js";
import { approvalStaleReasons } from "./engine.js";
import { outcomeReaders, recheckIntervalMs } from "./jobs/settlement-recovery.js";
import { store, storeNowMs, type ApprovalRow, type SettlementRow } from "./store.js";

/** Every state the status read can return. Terminal ones never change. */
export type IntentState =
  | "in_flight"
  | "settled"
  | "failed"
  | "outcome_unknown"
  | "unresolved_closed"
  | "claimed_unbooked"
  | "expired_unclaimed"
  | "awaiting_approval"
  | "expired_not_sent"
  | "cancelled_stale"
  | "rejected_by_policy"
  | "not_assessed"
  | "allowed";

const TERMINAL: ReadonlySet<IntentState> = new Set([
  "settled",
  "failed",
  "expired_unclaimed",
  "expired_not_sent",
  "cancelled_stale",
  "rejected_by_policy",
  "not_assessed",
]);

/** sha256 of the canonical rules object a request was checked against. */
export function rulesHash(rules: unknown): string {
  return sha256Hex(canonicalJson(rules));
}

function settlementState(row: SettlementRow): IntentState {
  if (row.outcome) return row.outcome;
  switch (row.state) {
    case "settled":
      return "settled";
    case "failed":
      return "failed";
    case "needs_review":
      return "outcome_unknown";
    default:
      return "in_flight";
  }
}

function usdc(v?: bigint): string | undefined {
  return v === undefined ? undefined : formatMicroToUsdc(v);
}

function isTxHash(v?: string): boolean {
  return Boolean(v && /^0x[0-9a-fA-F]{64}$/.test(v));
}

/** The id that names this transfer on-chain (tx hash, else EIP-3009 nonce). */
function transferId(row: SettlementRow): string | undefined {
  if (isTxHash(row.txHash)) return row.txHash;
  if (row.authorization?.nonce) return `eip3009:${row.authorization.nonce}`;
  return row.txHash;
}

/** Settlement facts safe for the agent and guardian to read. */
export function settlementView(row: SettlementRow) {
  const state = settlementState(row);
  const open =
    state === "outcome_unknown" || state === "unresolved_closed" || state === "claimed_unbooked";
  // Remaining hold: authorized minus anything already given back.
  const held = open ? row.amountMicro - (row.releasedMicro ?? 0n) : 0n;
  return {
    state,
    terminal: TERMINAL.has(state),
    tool: row.tool,
    rail: row.rail,
    transferId: transferId(row),
    authorizedUsdc: usdc(row.amountMicro),
    signedMaxUsdc: usdc(row.signedMaxMicro),
    chargedUsdc: usdc(row.chargedMicro),
    ...(open && { heldUsdc: usdc(held) }),
    resolver: row.resolver,
    escalateTo: row.escalateTo,
    ...(open && {
      recheck_after: row.recheckAfter,
      escalateAt: row.escalateAt,
      escalatedAt: row.escalatedAt,
    }),
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt,
    policyRevision: row.policyRevision,
    checkedAt: row.checkedAt ?? row.updatedAt,
    ...(row.authorization?.validBefore && {
      authorizationValidBefore: new Date(
        Number(row.authorization.validBefore) * 1000,
      ).toISOString(),
    }),
    ...(row.releasedMicro !== undefined && {
      released: {
        amountUsdc: usdc(row.releasedMicro),
        to: row.releasedTo,
        reason: row.releaseReason,
        // Money was released after something had been signed or broadcast.
        cancelledAfterEffect: row.signedMaxMicro !== undefined || isTxHash(row.txHash),
      },
    }),
    idempotencyKeyExpiresAt: row.idempotencyExpiresAt,
    error: row.error,
  };
}

/**
 * What the agent learns about an approval: the outcome, who decided and when
 * (every vote), and the exact rules it was checked against. Proposed in the
 * Oct 30 list; the agent could already read resolvedBy/resolvedAt on main.
 */
export function approvalRecord(a: ApprovalRow) {
  const { amountMicro: _m, ...rest } = a;
  const nowRevision = store.getPolicyVersion(a.orgId);
  const stale: string[] =
    a.status === "cancelled_stale"
      ? (a.staleReasons ?? [])
      : a.status === "pending"
        ? [
            ...approvalStaleReasons(a),
            ...(Date.parse(a.expiresAt) <= storeNowMs() ? ["expired"] : []),
          ]
        : [];
  return {
    ...rest,
    approver:
      a.status === "pending"
        ? null
        : {
            resolvedBy: a.resolvedBy ?? null,
            resolvedAt: a.resolvedAt ?? null,
            votes: store
              .listVotes(a.id)
              .map((v) => ({ guardian: v.guardianName, approve: v.approve, at: v.at })),
          },
    rulesHash: a.rulesHash ?? null,
    policyRevision: a.policyRevision ?? null,
    policyRevisionNow: nowRevision,
    // An approval binds (amount, payee, rules, expiry). Any change kills it.
    // Amount and payee are immutable on an approval; a change to either is a
    // new request. A rules change cancels it automatically ("dead, not old").
    staleIf: ["policy_revision_changed", "rules_hash_changed", "expired"],
    stale,
    ...(a.status === "cancelled_stale" && {
      cancelled: {
        reason: "stale",
        staleReasons: a.staleReasons ?? [],
        by: a.resolvedBy ?? null,
        at: a.resolvedAt ?? null,
        rule_code: "approval_stale",
        next_step: "re_request",
      },
    }),
    ...(a.status === "pending" && {
      recheck_after: new Date(
        Math.min(Date.parse(a.expiresAt), storeNowMs() + Math.max(recheckIntervalMs(), 30_000)),
      ).toISOString(),
    }),
  };
}

/** The cheap status read. Undefined when the intent is not this org's. */
export function intentStatus(orgId: string, intentId: string, agentId?: string) {
  const row = store.getSettlementForOrg(orgId, intentId);
  const approval = store.getApprovalByIntent(orgId, intentId);
  const decision = store.getDecision(orgId, intentId);
  const owner = row?.agentId ?? approval?.agentId ?? decision?.agentId;
  if (!owner || (agentId && owner !== agentId)) return undefined;

  let state: IntentState;
  if (row) state = settlementState(row);
  else if (approval?.status === "pending") state = "awaiting_approval";
  else if (approval?.status === "expired") state = "expired_not_sent";
  else if (approval?.status === "cancelled_stale") state = "cancelled_stale";
  else if (decision?.ruleIds.includes("policy_unavailable")) state = "not_assessed";
  else if (decision?.outcome === "deny") state = "rejected_by_policy";
  else state = "allowed";

  const view = row ? settlementView(row) : undefined;
  const recheckAfter =
    view && "recheck_after" in view
      ? view.recheck_after
      : state === "awaiting_approval" && approval
        ? approvalRecord(approval).recheck_after
        : state === "in_flight"
          ? new Date(storeNowMs() + 5_000).toISOString()
          : undefined;
  return {
    intentId,
    state,
    terminal: TERMINAL.has(state),
    ...(recheckAfter && { recheck_after: recheckAfter }),
    ...(decision && {
      decision: { outcome: decision.outcome, ruleIds: decision.ruleIds, at: decision.at },
    }),
    ...(approval && { approval: approvalRecord(approval) }),
    ...(view && { settlement: view }),
  };
}

const RECON_NOTE =
  "Direct USDC transfers (agent pay, treasury withdrawals) are signed by the vault and move its nonce, so they reconcile against the vault nonce. x402 payments are EIP-3009 authorizations that the seller or facilitator submits (and batch settlement redeems many at once); they do not move the vault nonce, so they reconcile against USDC Transfer logs out of the vault and the authorization state of each nonce (the seller's voucher claim).";

/** Every outflow with staleness fields, plus an optional on-chain cross-check. */
export async function outflowReconciliation(
  orgId: string,
  opts: { limit?: number; onchain?: boolean } = {},
) {
  const rows = store.listOutflows(orgId, opts.limit ?? 100);
  const nowRevision = store.getPolicyVersion(orgId);
  const nowMs = storeNowMs();
  const readers = outcomeReaders();
  let vault: string | undefined;
  if (opts.onchain) {
    try {
      vault = (await getCustodyProvider().getAddress(orgId))?.address;
    } catch {
      vault = undefined;
    }
  }

  let onchainBudget = 25; // bound RPC calls per request
  const out = [];
  for (const row of rows) {
    const view = settlementView(row);
    const kind = row.authorization
      ? "eip3009_authorization"
      : row.tool === "treasury_withdraw"
        ? "treasury_withdraw"
        : row.rail === "evm-usdc-transfer"
          ? "direct_transfer"
          : row.rail === "transfer-mock"
            ? "simulated"
            : "other";
    const staleReasons: string[] = [];
    if (row.policyRevision && row.policyRevision !== nowRevision) {
      staleReasons.push("policy_revision_changed");
    }
    const validBeforeMs = Number(row.authorization?.validBefore ?? NaN) * 1000;
    if (!view.terminal && Number.isFinite(validBeforeMs) && nowMs > validBeforeMs) {
      staleReasons.push("authorization_expired");
    }
    if (
      row.chargedMicro !== undefined &&
      row.signedMaxMicro !== undefined &&
      row.chargedMicro > row.signedMaxMicro
    ) {
      staleReasons.push("amount_changed");
    }
    let onchain: Record<string, unknown> | undefined;
    if (opts.onchain && onchainBudget > 0 && kind !== "simulated") {
      onchainBudget -= 1;
      const findings: string[] = [];
      if (row.authorization) {
        const claim = await readers.authorizationState(row.authorization);
        onchain = { voucherClaim: claim };
        if (claim === "used" && view.state !== "settled") findings.push("claimed_not_booked");
        if (claim === "unused" && view.state === "settled") findings.push("booked_not_claimed");
      }
      if (isTxHash(row.txHash)) {
        const tx = await readers.txStatus(row.txHash!);
        onchain = { ...onchain, tx };
        if (vault && kind === "eip3009_authorization" && tx === "success") {
          const logs = await readers.transfersFrom(row.txHash!, vault);
          const total = logs?.reduce((s, l) => s + l.valueMicro, 0n);
          onchain = {
            ...onchain,
            transferLogs: logs === null ? "unknown" : logs.length,
            ...(total !== undefined && { transferredUsdc: formatMicroToUsdc(total) }),
          };
          if (total !== undefined && row.chargedMicro !== undefined && total !== row.chargedMicro) {
            findings.push("transfer_amount_mismatch");
          }
        }
        if (tx === "success" && view.state !== "settled") findings.push("mined_not_booked");
        if (tx === "reverted" && view.state === "settled") findings.push("booked_but_reverted");
      }
      if (onchain) onchain.findings = findings;
    }
    out.push({
      intentId: row.intentId,
      agentId: row.agentId,
      kind,
      destination: row.destination,
      createdAt: row.createdAt,
      ...view,
      policyRevisionNow: nowRevision,
      staleIf: [
        "amount_changed",
        "payee_changed",
        "policy_revision_changed",
        "authorization_expired",
      ],
      stale: staleReasons,
      ...(onchain && { onchain }),
    });
  }

  const directBroadcast = rows.filter(
    (r) => isTxHash(r.txHash) && !r.authorization && r.rail === "evm-usdc-transfer",
  ).length;
  let nonce: Record<string, unknown> | undefined;
  if (opts.onchain && vault) {
    const n = await readers.vaultNonce(vault);
    const recorded = store.countDirectVaultSends(orgId);
    nonce = {
      vault,
      onchainNonce: n,
      recordedDirectSends: recorded,
      // A positive gap is a send ABI did not record (or a non-USDC tx).
      unexplained: n === null ? "unknown" : n - recorded,
    };
  }
  const openRows = out.filter(
    (r) =>
      r.state === "outcome_unknown" ||
      r.state === "unresolved_closed" ||
      r.state === "claimed_unbooked",
  );
  return {
    checkedAt: new Date(nowMs).toISOString(),
    policyRevision: nowRevision,
    note: RECON_NOTE,
    summary: {
      outflows: out.length,
      settled: out.filter((r) => r.state === "settled").length,
      open: openRows.length,
      directTransfers: directBroadcast,
      eip3009Authorizations: rows.filter((r) => r.authorization).length,
      released: out.filter((r) => "released" in r && r.released).length,
      stale: out.filter((r) => r.stale.length > 0).length,
    },
    ...(nonce && { nonce }),
    outflows: out,
  };
}
