/**
 * Money engine: policy-gated intent execution, escrow settlement, approval
 * resolution, and background sweeps. Pure of HTTP — driven by the REST routes
 * and by the Telegram approvals bot.
 */
import { randomBytes } from "node:crypto";
import { accountId, formatMicroToUsdc, parseUsdcToMicro, type IntentTool, type MicroUsdc } from "@policyvault/common";
import {
  finalizePayment,
  holdForPayment,
  lockEscrow,
  refundEscrow,
  releaseEscrow,
  releaseHold,
  type JournalEntry,
} from "@policyvault/ledger";
import { evaluatePolicy, type PolicyRules } from "@policyvault/policy";
import { X402Error, X402Rail } from "./rails/x402.js";
import { TransferMockRail } from "./rails/transfer-mock.js";
import { EvmUsdcTransferRail, isEvmPayDestination } from "./rails/evm-usdc-transfer.js";
import type { PaymentRail } from "./rails/types.js";
import { screenDestination } from "./platform/compliance.js";
import { notify } from "./platform/notifier.js";
import { recordObs } from "./platform/observability.js";
import { store, type ApprovalRow, type EscrowRow } from "./store.js";
import { emitEvent } from "./webhooks.js";

export const APPROVAL_TTL_MINUTES = Number(process.env.APPROVAL_TTL_MINUTES ?? 10);
export const ESCROW_DEFAULT_TIMEOUT_MINUTES = Number(process.env.ESCROW_TIMEOUT_MINUTES ?? 15);

const x402Rail: PaymentRail = new X402Rail();
const transferMockRail: PaymentRail = new TransferMockRail();
const evmUsdcTransferRail: PaymentRail = new EvmUsdcTransferRail();

/** Escape hatch for offline demos — never use for the Coinbase/Sepolia proof. */
const forceMockTransfer = process.env.POLICYVAULT_MOCK_TRANSFER === "1";

export function id(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

export function scopedIdempotencyKey(agentId: string, key: string): string {
  return `${agentId}:${key}`;
}

export function rulesFor(agentId: string, orgId: string): PolicyRules {
  const agent = store.getAgent(agentId)!;
  const org = store.getOrg(orgId)!;
  const base = store.getPolicyTemplate(orgId);
  const orgAgentIds = store.listAgents(orgId).map((a) => a.id);
  const availableId = accountId("agent", agentId, "available");
  return {
    ...base,
    knownCounterparties: [
      ...store.knownCounterparties(orgId),
      // same-org agents are never "new counterparties" for internal moves
      ...orgAgentIds,
    ],
    spentLast24hMicro: store.spentLast24h(agentId),
    paysLastMinute: store.paysLastMinute(agentId),
    // Archived agents are non-spendable — same deny path as freeze.
    agentFrozen: agent.status === "frozen" || agent.status === "archived",
    orgFrozen: org.status === "frozen",
    walletBalanceMicro: store.getAccountMap(orgId).get(availableId)?.balanceMicro ?? 0n,
  };
}

export function recordDecision(args: {
  intentId: string;
  orgId: string;
  agentId: string;
  outcome: string;
  ruleIds: string[];
  reasons: string[];
  tool: string;
  amountUsdc: string;
  destination: string;
}) {
  store.addDecision({ ...args, at: new Date().toISOString() });
}

export interface ExecInput {
  orgId: string;
  agentId: string;
  tool: IntentTool;
  amountMicro: MicroUsdc;
  amountUsdc: string;
  destination: string;
  intentId: string;
  jobId?: string;
  memo?: string;
  /** escrow_lock only */
  payeeAgentId?: string;
  timeoutMinutes?: number;
}

export type ExecResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; status: number; payload: Record<string, unknown> };

/**
 * Execute an already-allowed intent against the ledger + rail.
 * - pay_api + http(s) → x402 (EIP-712; seller/facilitator settles)
 * - pay / withdraw + 0x address → real Base USDC ERC-20 transfer from vault
 * - otherwise → transfer-mock (vendor strings / offline demo)
 */
export async function executeIntent(input: ExecInput): Promise<ExecResult> {
  const agentAvailableId = accountId("agent", input.agentId, "available");
  const agentHeldId = accountId("agent", input.agentId, "held");
  const externalId = `org:${input.orgId}:external`;

  if (input.tool === "escrow_lock") {
    const destination = input.destination || input.payeeAgentId || "";
    const screen = await screenDestination(destination, {
      orgId: input.orgId,
      agentId: input.agentId,
    });
    if (!screen.ok) {
      emitEvent(input.orgId, "compliance.flagged", {
        intentId: input.intentId,
        agentId: input.agentId,
        destination,
        tool: input.tool,
        reason: screen.reason,
        provider: screen.provider,
      });
      recordObs({
        name: "compliance.flagged",
        orgId: input.orgId,
        agentId: input.agentId,
        attrs: { destination, reason: screen.reason, tool: input.tool },
      });
      void notify({
        kind: "compliance.flagged",
        orgId: input.orgId,
        title: "Compliance blocked",
        body: screen.reason ?? "Destination blocked by compliance screen",
        meta: { destination, tool: input.tool, provider: screen.provider },
      });
      return {
        ok: false,
        status: 403,
        payload: {
          intentId: input.intentId,
          error: {
            code: "COMPLIANCE_BLOCKED",
            message: screen.reason ?? "Destination blocked by compliance screen",
          },
        },
      };
    }

    const escrowId = id("esc");
    const escrowAccountId = `escrow:${escrowId}`;
    try {
      store.applyEntries(
        input.orgId,
        [
          lockEscrow({
            orgId: input.orgId,
            journalId: `jl_${escrowId}`,
            intentId: input.intentId,
            payerAvailableId: agentAvailableId,
            escrowAccountId,
            amountMicro: input.amountMicro,
          }),
        ],
        {
          createAccounts: [
            { id: escrowAccountId, orgId: input.orgId, kind: "escrow", balanceMicro: 0n },
          ],
        },
      );
      const timeoutMinutes = input.timeoutMinutes ?? ESCROW_DEFAULT_TIMEOUT_MINUTES;
      const row: EscrowRow = {
        id: escrowId,
        orgId: input.orgId,
        payerAgentId: input.agentId,
        payeeAgentId: input.payeeAgentId!,
        amountMicro: input.amountMicro,
        state: "locked",
        jobId: input.jobId,
        memo: input.memo,
        createdAt: new Date().toISOString(),
        timeoutAt: new Date(Date.now() + timeoutMinutes * 60_000).toISOString(),
      };
      store.createEscrow(row);
      store.recordPay(input.agentId, input.amountMicro);
      emitEvent(input.orgId, "escrow.locked", {
        escrowId,
        payerAgentId: input.agentId,
        payeeAgentId: input.payeeAgentId,
        amountUsdc: input.amountUsdc,
        jobId: input.jobId,
      });
      return {
        ok: true,
        payload: {
          intentId: input.intentId,
          outcome: "allow",
          escrowId,
          state: "locked",
          amountUsdc: input.amountUsdc,
          timeoutAt: row.timeoutAt,
        },
      };
    } catch (e) {
      emitEvent(input.orgId, "payment.failed", {
        intentId: input.intentId,
        tool: input.tool,
        agentId: input.agentId,
        amountUsdc: input.amountUsdc,
        reason: String(e),
      });
      return {
        ok: false,
        status: 402,
        payload: {
          intentId: input.intentId,
          error: { code: "INSUFFICIENT_STIPEND", message: String(e) },
        },
      };
    }
  }

  // pay / pay_api: hold the authorized amount, run the rail, then finalize
  // exactly what the rail charged and release any remainder back to the agent.

  try {
    store.applyEntries(input.orgId, [
      holdForPayment({
        orgId: input.orgId,
        journalId: `h_${input.intentId}`,
        intentId: input.intentId,
        agentAvailableId,
        agentHeldId,
        amountMicro: input.amountMicro,
      }),
    ]);
  } catch (e) {
    emitEvent(input.orgId, "payment.failed", {
      intentId: input.intentId,
      tool: input.tool,
      agentId: input.agentId,
      amountUsdc: input.amountUsdc,
      reason: String(e),
    });
    return {
      ok: false,
      status: 402,
      payload: {
        intentId: input.intentId,
        error: { code: "INSUFFICIENT_STIPEND", message: String(e) },
      },
    };
  }

  const releaseFullHold = () =>
    store.applyEntries(input.orgId, [
      releaseHold({
        orgId: input.orgId,
        journalId: `r_${input.intentId}`,
        intentId: input.intentId,
        agentHeldId,
        agentAvailableId,
        amountMicro: input.amountMicro,
      }),
    ]);

  let chargedMicro = input.amountMicro;
  let rail = transferMockRail.name;
  let txHash: string | undefined;
  let resource: unknown;
  const isUrl = /^https?:\/\//i.test(input.destination);

  // Compliance screen — pluggable; allow-all by default.
  const screen = await screenDestination(input.destination, {
    orgId: input.orgId,
    agentId: input.agentId,
  });
  if (!screen.ok) {
    releaseFullHold();
    emitEvent(input.orgId, "compliance.flagged", {
      intentId: input.intentId,
      agentId: input.agentId,
      destination: input.destination,
      reason: screen.reason,
      provider: screen.provider,
    });
    recordObs({
      name: "compliance.flagged",
      orgId: input.orgId,
      agentId: input.agentId,
      attrs: { destination: input.destination, reason: screen.reason },
    });
    void notify({
      kind: "compliance.flagged",
      orgId: input.orgId,
      title: "Compliance blocked",
      body: screen.reason ?? "Destination blocked by compliance screen",
      meta: {
        destination: input.destination,
        tool: input.tool,
        provider: screen.provider,
      },
    });
    return {
      ok: false,
      status: 403,
      payload: {
        intentId: input.intentId,
        error: {
          code: "COMPLIANCE_BLOCKED",
          message: screen.reason ?? "Destination blocked by compliance screen",
        },
      },
    };
  }

  const selectedRail: PaymentRail = (() => {
    if (input.tool === "pay_api" && isUrl) return x402Rail;
    if (
      !forceMockTransfer &&
      (input.tool === "pay" || input.tool === "withdraw") &&
      isEvmPayDestination(input.destination)
    ) {
      return evmUsdcTransferRail;
    }
    return transferMockRail;
  })();

  try {
    const settled = await selectedRail.settle({
      orgId: input.orgId,
      agentId: input.agentId,
      intentId: input.intentId,
      destination: input.destination,
      authorizedMicro: input.amountMicro,
      blocklist: store.getPolicyTemplate(input.orgId).blocklist,
    });
    if (!settled.settled) {
      throw new X402Error(
        "RAIL_FAILED",
        "Rail reported settlement failure — not booking a payment.",
      );
    }
    chargedMicro = settled.chargedMicro;
    rail = settled.rail;
    txHash = settled.txHash;
    resource = settled.resource;
  } catch (e) {
    releaseFullHold();
    const railCode =
      e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string"
        ? (e as { code: string }).code
        : undefined;
    const code =
      e instanceof X402Error
        ? e.code === "CUSTODY_UNAVAILABLE"
          ? "CUSTODY_UNAVAILABLE"
          : e.code
        : railCode === "CUSTODY_UNAVAILABLE"
          ? "CUSTODY_UNAVAILABLE"
          : railCode === "INSUFFICIENT_ONCHAIN_USDC"
            ? "INSUFFICIENT_ONCHAIN_USDC"
            : railCode === "INSUFFICIENT_GAS"
              ? "INSUFFICIENT_GAS"
              : railCode === "INVALID_DESTINATION"
                ? "INVALID_DESTINATION"
                : "RAIL_FAILED";
    emitEvent(input.orgId, "payment.failed", {
      intentId: input.intentId,
      tool: input.tool,
      agentId: input.agentId,
      amountUsdc: input.amountUsdc,
      destination: input.destination,
      reason: String(e),
    });
    const status =
      code === "CUSTODY_UNAVAILABLE"
        ? 502
        : code === "INSUFFICIENT_ONCHAIN_USDC" || code === "INSUFFICIENT_GAS"
          ? 402
          : code === "INVALID_DESTINATION"
            ? 400
            : 402;
    return {
      ok: false,
      status,
      payload: {
        intentId: input.intentId,
        error: { code, message: e instanceof Error ? e.message : String(e) },
      },
    };
  }

  const settleEntries: JournalEntry[] = [
    finalizePayment({
      orgId: input.orgId,
      journalId: `f_${input.intentId}`,
      intentId: input.intentId,
      agentHeldId,
      externalId,
      amountMicro: chargedMicro,
    }),
  ];
  if (chargedMicro < input.amountMicro) {
    settleEntries.push(
      releaseHold({
        orgId: input.orgId,
        journalId: `r_${input.intentId}`,
        intentId: input.intentId,
        agentHeldId,
        agentAvailableId,
        amountMicro: input.amountMicro - chargedMicro,
      }),
    );
  }
  try {
    store.applyEntries(input.orgId, settleEntries);
  } catch (e) {
    // The rail may already have taken the money, but our books could not record
    // it. Release the hold so the agent's balance is not frozen forever, and
    // shout — this is a reconciliation event a human must look at.
    console.error(
      `SETTLEMENT FAILED intent=${input.intentId} org=${input.orgId} charged=${chargedMicro}:`,
      e,
    );
    try {
      releaseFullHold();
    } catch (releaseErr) {
      console.error(`HOLD ORPHANED intent=${input.intentId} — manual reconciliation required:`, releaseErr);
    }
    emitEvent(input.orgId, "payment.failed", {
      intentId: input.intentId,
      tool: input.tool,
      agentId: input.agentId,
      amountUsdc: input.amountUsdc,
      reason: `settlement failed after rail succeeded: ${String(e)}`,
      needsReconciliation: true,
    });
    return {
      ok: false,
      status: 500,
      payload: {
        intentId: input.intentId,
        error: { code: "RECONCILE_STALE", message: `Settlement failed: ${String(e)}` },
      },
    };
  }
  store.recordPay(input.agentId, chargedMicro);
  store.addKnownCounterparty(input.orgId, input.destination);
  const payload: Record<string, unknown> = {
    intentId: input.intentId,
    outcome: "allow" as const,
    receiptId: `rcpt_${input.intentId}`,
    amountUsdc: formatMicroToUsdc(chargedMicro),
    authorizedUsdc: input.amountUsdc,
    rail,
  };
  if (txHash) payload.txHash = txHash;
  if (resource !== undefined) payload.resource = resource;
  emitEvent(input.orgId, "payment.succeeded", {
    intentId: input.intentId,
    receiptId: payload.receiptId,
    tool: input.tool,
    agentId: input.agentId,
    amountUsdc: formatMicroToUsdc(chargedMicro),
    destination: input.destination,
    jobId: input.jobId,
    rail,
    txHash,
  });
  return { ok: true, payload };
}

// ---------------------------------------------------------------------------
// Approval resolution (shared by REST + Telegram)
// ---------------------------------------------------------------------------

export type ApprovalResolution =
  | { kind: "not_found" }
  | { kind: "conflict"; approval: ApprovalRow }
  | { kind: "expired"; approval: ApprovalRow }
  | { kind: "frozen"; approval: ApprovalRow }
  | { kind: "forbidden"; message: string; approval: ApprovalRow }
  | { kind: "pending_quorum"; have: number; need: number; approval: ApprovalRow }
  | { kind: "resolved"; ok: boolean; execStatus?: number; approval: ApprovalRow };

/**
 * Enforce secondary-guardian role + optional max-approve cap.
 * Founding owner (`guardianId === "owner"`) and Telegram stubs skip seat checks.
 * Deny votes are always allowed (safe asymmetry).
 */
function guardianApproveGate(
  orgId: string,
  guardianId: string,
  approve: boolean,
  approval: ApprovalRow,
): { ok: true } | { ok: false; message: string } {
  if (!approve) return { ok: true };
  if (guardianId === "owner" || guardianId.startsWith("tg:")) return { ok: true };

  // Signed-in users authorize through their org membership, not a guardian
  // seat. Without this branch every session-authenticated approval was refused
  // as "unknown guardian" — the identity layer and the approval gate had no
  // shared notion of who a person is.
  if (guardianId.startsWith("user:")) {
    const userId = guardianId.slice("user:".length);
    const membership = store.getMembership(userId, orgId);
    if (!membership) {
      return { ok: false, message: "You are not a member of this organization." };
    }
    if (membership.role === "viewer") {
      const user = store.getUser(userId);
      return {
        ok: false,
        message: `${user?.name ?? "This account"} is view-only and cannot approve payments.`,
      };
    }
    return { ok: true };
  }

  const seat = store.listGuardians(orgId).find((g) => g.id === guardianId && !g.revokedAt);
  if (!seat) {
    return { ok: false, message: "Unknown guardian — cannot approve this payment." };
  }
  if (seat.role === "viewer") {
    return { ok: false, message: `${seat.name} is view-only and cannot approve payments.` };
  }
  if (seat.conditions?.restricted && seat.conditions.maxApproveUsdc) {
    try {
      const max = parseUsdcToMicro(seat.conditions.maxApproveUsdc);
      if (approval.amountMicro > max) {
        return {
          ok: false,
          message: `${seat.name} may only approve up to $${seat.conditions.maxApproveUsdc} (this is $${approval.amountUsdc}).`,
        };
      }
    } catch {
      return {
        ok: false,
        message: `Invalid max-approve amount for ${seat.name}.`,
      };
    }
  }
  return { ok: true };
}

export async function resolveApproval(
  orgId: string,
  approvalId: string,
  approve: boolean,
  resolvedBy: string,
  /**
   * Authenticated identity of the voter. Quorum counts distinct values of
   * THIS, never the client-supplied resolvedBy label — otherwise one guardian
   * could satisfy a 2-of-N quorum alone by sending two different names.
   */
  guardianId = "owner",
): Promise<ApprovalResolution> {
  const approval = store.getApproval(approvalId, orgId);
  if (!approval) return { kind: "not_found" };
  if (approval.status !== "pending") return { kind: "conflict", approval };
  if (new Date(approval.expiresAt).getTime() < Date.now()) {
    sweepApprovalExpiry();
    return { kind: "expired", approval: store.getApproval(approvalId, orgId)! };
  }

  const gate = guardianApproveGate(orgId, guardianId, approve, approval);
  if (!gate.ok) {
    return { kind: "forbidden", message: gate.message, approval };
  }

  // Always record the vote for audit attribution — including quorum=1 solo
  // approves. Quorum only gates *proceeding*; the ledger must still know who
  // decided. A deny from anyone still kills immediately once claimed below.
  const quorum = Math.max(1, store.getPolicyTemplate(orgId).approvalQuorum ?? 1);
  store.recordVote({
    approvalId: approval.id,
    guardianId,
    guardianName: resolvedBy,
    approve,
    at: new Date().toISOString(),
  });
  const votes = store.listVotes(approval.id);
  const approvals = votes.filter((v) => v.approve).length;
  if (approve && approvals < quorum) {
    return {
      kind: "pending_quorum",
      have: approvals,
      need: quorum,
      approval: store.getApproval(approvalId, orgId)!,
    };
  }

  // Claim it atomically. Without this, two guardians pressing Approve at the
  // same instant (console + Telegram) both pass the status check above and the
  // payment executes twice.
  if (!store.claimApproval(approval.id)) {
    return { kind: "conflict", approval: store.getApproval(approvalId, orgId)! };
  }

  const resolvedAt = new Date().toISOString();
  const idemKey = scopedIdempotencyKey(approval.agentId, approval.idempotencyKey);

  if (!approve) {
    const result = {
      outcome: "deny",
      error: { code: "POLICY_DENIED", message: "Denied by guardian" },
    };
    store.resolveApproval(approval.id, {
      status: "denied",
      resolvedAt,
      resolvedBy,
      result,
    });
    recordDecision({
      intentId: approval.intentId,
      orgId: approval.orgId,
      agentId: approval.agentId,
      outcome: "deny",
      ruleIds: ["guardian_denied"],
      reasons: [`Denied by ${resolvedBy}`],
      tool: approval.tool,
      amountUsdc: approval.amountUsdc,
      destination: approval.destination,
    });
    store.setIdempotent(approval.orgId, idemKey, { ...result, httpStatus: 403 });
    emitEvent(orgId, "approval.resolved", {
      approvalId: approval.id,
      status: "denied",
      resolvedBy,
    });
    return { kind: "resolved", ok: true, approval: store.getApproval(approvalId, orgId)! };
  }

  // Approved: re-evaluate against CURRENT rules before executing.
  //
  // A guardian's approval satisfies the human-in-the-loop rule — it does not
  // waive the hard limits. Between parking and approving, the agent may have
  // been frozen, the destination blocklisted, the caps lowered, or several
  // other approvals may have settled and consumed the daily cap. Executing the
  // stale decision would let a queue of individually-legal approvals blow
  // every limit collectively.
  const rules = rulesFor(approval.agentId, approval.orgId);
  if (rules.agentFrozen || rules.orgFrozen) {
    const result = {
      outcome: "deny",
      error: { code: "FROZEN", message: "Agent or org frozen since approval was requested" },
    };
    store.resolveApproval(approval.id, {
      status: "denied",
      resolvedAt,
      resolvedBy,
      result,
    });
    recordDecision({
      intentId: approval.intentId,
      orgId: approval.orgId,
      agentId: approval.agentId,
      outcome: "deny",
      ruleIds: [rules.orgFrozen ? "org_frozen" : "agent_frozen"],
      reasons: ["Frozen before guardian approval resolved"],
      tool: approval.tool,
      amountUsdc: approval.amountUsdc,
      destination: approval.destination,
    });
    store.setIdempotent(approval.orgId, idemKey, { ...result, httpStatus: 403 });
    emitEvent(orgId, "approval.resolved", {
      approvalId: approval.id,
      status: "denied",
      resolvedBy,
      reason: "frozen",
    });
    return { kind: "frozen", approval: store.getApproval(approvalId, orgId)! };
  }

  const recheck = evaluatePolicy(
    {
      agentId: approval.agentId,
      orgId: approval.orgId,
      tool: approval.tool as IntentTool,
      amountMicro: approval.amountMicro,
      destination: approval.destination,
      jobId: approval.jobId,
      idempotencyKey: approval.idempotencyKey,
      memo: approval.memo,
    },
    // The guardian is the human-in-the-loop, so ignore the rules that exist
    // purely to summon one. Every hard limit still applies.
    { ...rules, hitlAboveMicro: approval.amountMicro, hitlCategories: [], quietHours: undefined },
  );
  if (recheck.outcome === "deny") {
    const result = {
      outcome: "deny",
      error: {
        code: "POLICY_DENIED",
        message: `No longer permitted: ${recheck.reasons.join("; ")}`,
      },
    };
    store.resolveApproval(approval.id, { status: "denied", resolvedAt, resolvedBy, result });
    recordDecision({
      intentId: approval.intentId,
      orgId: approval.orgId,
      agentId: approval.agentId,
      outcome: "deny",
      ruleIds: recheck.ruleIds,
      reasons: [`Approved by ${resolvedBy} but policy now refuses: ${recheck.reasons[0]}`],
      tool: approval.tool,
      amountUsdc: approval.amountUsdc,
      destination: approval.destination,
    });
    store.setIdempotent(approval.orgId, idemKey, { ...result, httpStatus: 403 });
    emitEvent(orgId, "approval.resolved", {
      approvalId: approval.id,
      status: "denied",
      resolvedBy,
      reason: recheck.reasons[0],
    });
    return { kind: "resolved", ok: false, execStatus: 403, approval: store.getApproval(approvalId, orgId)! };
  }
  const result = await executeIntent({
    orgId: approval.orgId,
    agentId: approval.agentId,
    tool: approval.tool as IntentTool,
    amountMicro: approval.amountMicro,
    amountUsdc: approval.amountUsdc,
    destination: approval.destination,
    intentId: approval.intentId,
    jobId: approval.jobId,
    memo: approval.memo,
    payeeAgentId: approval.payeeAgentId,
    timeoutMinutes: approval.timeoutMinutes,
  }).catch((e) => {
    // Unexpected throw after claim — release the lock so a guardian can retry.
    store.unclaimApproval(approval.id);
    throw e;
  });
  store.resolveApproval(approval.id, {
    status: result.ok ? "approved" : "denied",
    resolvedAt,
    resolvedBy,
    result: result.payload,
  });
  recordDecision({
    intentId: approval.intentId,
    orgId: approval.orgId,
    agentId: approval.agentId,
    outcome: result.ok ? "allow" : "deny",
    ruleIds: [result.ok ? "guardian_approved" : "execution_failed"],
    reasons: [
      result.ok ? `Approved by ${resolvedBy}` : `Approved by ${resolvedBy} but execution failed`,
    ],
    tool: approval.tool,
    amountUsdc: approval.amountUsdc,
    destination: approval.destination,
  });
  store.setIdempotent(approval.orgId, idemKey, {
    ...result.payload,
    httpStatus: result.ok ? 200 : result.status,
  });
  emitEvent(orgId, "approval.resolved", {
    approvalId: approval.id,
    status: result.ok ? "approved" : "denied",
    resolvedBy,
  });
  return {
    kind: "resolved",
    ok: result.ok,
    execStatus: result.ok ? undefined : result.status,
    approval: store.getApproval(approvalId, orgId)!,
  };
}

// ---------------------------------------------------------------------------
// Escrow settlement + sweeps
// ---------------------------------------------------------------------------

export function settleEscrow(
  escrow: EscrowRow,
  action: "release" | "refund" | "timeout_refund",
  actor: string,
): ExecResult {
  // A11: CAS claim before ledger apply so concurrent settlers cannot double-book.
  if (!store.claimEscrow(escrow.id)) {
    const fresh = store.getEscrow(escrow.id, escrow.orgId) ?? escrow;
    return {
      ok: false,
      status: 409,
      payload: {
        error: {
          code: "VALIDATION_ERROR",
          message: `Escrow is ${fresh.state !== "locked" ? fresh.state : "busy"}`,
        },
      },
    };
  }
  const escrowAccountId = `escrow:${escrow.id}`;
  try {
    let newState: EscrowRow["state"];
    if (action === "release") {
      store.applyEntries(escrow.orgId, [
        releaseEscrow({
          orgId: escrow.orgId,
          journalId: id("j"),
          escrowAccountId,
          payeeAvailableId: `agent:${escrow.payeeAgentId}:available`,
          amountMicro: escrow.amountMicro,
        }),
      ]);
      newState = "released";
    } else {
      store.applyEntries(escrow.orgId, [
        refundEscrow({
          orgId: escrow.orgId,
          journalId: id("j"),
          escrowAccountId,
          payerAvailableId: `agent:${escrow.payerAgentId}:available`,
          amountMicro: escrow.amountMicro,
          reason: action === "timeout_refund" ? "timeout_refund" : "refund",
        }),
      ]);
      newState = action === "timeout_refund" ? "timeout_refunded" : "refunded";
    }
    store.updateEscrowState(escrow.id, newState, new Date().toISOString());
    recordDecision({
      intentId: id("int"),
      orgId: escrow.orgId,
      agentId: escrow.payerAgentId,
      outcome: "allow",
      ruleIds: [`escrow_${newState}`],
      reasons: [`Escrow ${escrow.id} ${newState} by ${actor}`],
      tool: newState === "released" ? "escrow_release" : "escrow_refund",
      amountUsdc: formatMicroToUsdc(escrow.amountMicro),
      destination: newState === "released" ? escrow.payeeAgentId : escrow.payerAgentId,
    });
    emitEvent(escrow.orgId, newState === "released" ? "escrow.released" : "escrow.refunded", {
      escrowId: escrow.id,
      state: newState,
      actor,
      amountUsdc: formatMicroToUsdc(escrow.amountMicro),
      payerAgentId: escrow.payerAgentId,
      payeeAgentId: escrow.payeeAgentId,
    });
    return { ok: true, payload: { state: newState } };
  } catch (e) {
    store.unclaimEscrow(escrow.id);
    return {
      ok: false,
      status: 500,
      payload: { error: { code: "RAIL_FAILED", message: String(e) } },
    };
  }
}

export function sweepEscrowTimeouts() {
  for (const escrow of store.listExpiredLockedEscrows()) {
    settleEscrow(escrow, "timeout_refund", "system:timeout");
  }
}

export function sweepApprovalExpiry() {
  for (const approval of store.listExpiredPendingApprovals()) {
    store.resolveApproval(approval.id, {
      status: "expired",
      resolvedAt: new Date().toISOString(),
      result: {
        outcome: "deny",
        error: { code: "APPROVAL_TIMEOUT", message: "Guardian did not respond in time" },
      },
    });
    recordDecision({
      intentId: approval.intentId,
      orgId: approval.orgId,
      agentId: approval.agentId,
      outcome: "deny",
      ruleIds: ["approval_timeout"],
      reasons: ["Approval expired without guardian response"],
      tool: approval.tool,
      amountUsdc: approval.amountUsdc,
      destination: approval.destination,
    });
    emitEvent(approval.orgId, "approval.resolved", {
      approvalId: approval.id,
      status: "expired",
    });
  }
}
