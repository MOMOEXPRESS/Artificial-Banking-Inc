/**
 * Reconcile settlements left in flight.
 *
 * A settlement has an irreversible middle: the rail broadcasts, and only then
 * does the ledger record it. A crash, restart or timeout in that window used to
 * leave money moved with nothing written down — every balance and report
 * silently wrong from then on, with no signal that it had happened.
 *
 * `settlement_attempts` makes that window observable. This job closes it:
 *
 *   pending   + stale -> the rail never started; safe to mark failed.
 *   broadcast + stale -> a transaction may exist. Ask the chain, then either
 *                        confirm it or escalate for a human. Never guess.
 *
 * Deliberately does not re-apply ledger entries on its own. Booking a payment
 * from a background job, on evidence assembled after the fact, is how a
 * recovery path becomes a double-spend. It surfaces the discrepancy and stops.
 */
import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import { activeChain, rpcUrl } from "../chain/network.js";
import { notify } from "../platform/notifier.js";
import { recordObs } from "../platform/observability.js";
import { store, type SettlementRow } from "../store.js";
import { emitEvent } from "../webhooks.js";

/**
 * How long an attempt may sit before it is considered stuck. Comfortably
 * longer than the rail's own confirmation timeout, so a slow-but-healthy
 * payment is never disturbed.
 */
const STUCK_AFTER_MS = Number(process.env.ABI_SETTLEMENT_STUCK_MINUTES ?? 10) * 60_000;

function isMockHash(txHash?: string): boolean {
  return Boolean(txHash?.startsWith("0xmock_"));
}

async function chainStatus(
  txHash: string,
): Promise<"success" | "reverted" | "unknown"> {
  try {
    const cfg = activeChain();
    const client = createPublicClient({
      chain: cfg.id === "base" ? base : baseSepolia,
      transport: http(rpcUrl(cfg), { timeout: 15_000 }),
    });
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
    return receipt.status === "success" ? "success" : "reverted";
  } catch {
    // Not mined yet, or the RPC is unreachable. Both mean "do not conclude".
    return "unknown";
  }
}

function escalate(row: SettlementRow, reason: string) {
  store.finishSettlement(row.intentId, {
    state: "needs_review",
    error: reason,
    rail: row.rail,
    txHash: row.txHash,
  });
  recordObs({
    name: "settlement.needs_review",
    orgId: row.orgId,
    agentId: row.agentId,
    attrs: { intentId: row.intentId, txHash: row.txHash ?? null, reason },
  });
  emitEvent(row.orgId, "payment.failed", {
    intentId: row.intentId,
    agentId: row.agentId,
    destination: row.destination,
    txHash: row.txHash,
    reason,
    needsReconciliation: true,
  });
  void notify({
    kind: "info",
    orgId: row.orgId,
    title: "Payment needs reconciliation",
    body:
      `Intent ${row.intentId} was left mid-settlement. ${reason}` +
      (row.txHash ? ` Transaction ${row.txHash}.` : ""),
    meta: { intentId: row.intentId, txHash: row.txHash },
  });
}

export async function recoverStuckSettlements(): Promise<{
  checked: number;
  failed: number;
  needsReview: number;
}> {
  const stuck = store.listStuckSettlements(STUCK_AFTER_MS);
  let failed = 0;
  let needsReview = 0;

  for (const row of stuck) {
    // Never broadcast: nothing left the building, so the hold was released and
    // the attempt simply failed.
    if (row.state === "pending" && !row.txHash) {
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

    if (!row.txHash) {
      escalate(
        row,
        "Marked broadcast without a transaction hash — cannot determine whether funds moved.",
      );
      needsReview += 1;
      continue;
    }

    const status = await chainStatus(row.txHash);
    if (status === "unknown") continue; // try again next sweep

    if (status === "reverted") {
      store.finishSettlement(row.intentId, {
        state: "failed",
        error: `Transaction ${row.txHash} reverted on-chain; no funds moved.`,
        txHash: row.txHash,
      });
      failed += 1;
      continue;
    }

    // Confirmed on-chain but the ledger never recorded it. This is the exact
    // discrepancy the table exists to catch, and it needs a human.
    escalate(
      row,
      "Transaction confirmed on-chain but the ledger has no matching entry. " +
        "The books understate this agent's spend until it is reconciled.",
    );
    needsReview += 1;
  }

  return { checked: stuck.length, failed, needsReview };
}
