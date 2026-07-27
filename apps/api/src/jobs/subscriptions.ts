/**
 * Recurring agent spend.
 *
 * Every run passes the full policy engine — a recurring charge gets no special
 * authority, so a frozen agent or a blown cap stops it exactly like a one-off.
 *
 * This lived inside the API's `setInterval` block, which was gated behind
 * `if (!embedded)`. On the serverless deployment that gate was always true, so
 * subscriptions **never charged in production** while the feature was shipped
 * and visible in the console.
 */
import { formatMicroToUsdc } from "@policyvault/common";
import { evaluatePolicy } from "@policyvault/policy";
import {
  APPROVAL_TTL_MINUTES,
  executeIntent,
  id,
  recordDecision,
  rulesFor,
} from "../engine.js";
import { notify } from "../platform/notifier.js";
import { store, type ApprovalRow } from "../store.js";
import { emitEvent } from "../webhooks.js";

export async function runDueSubscriptions(): Promise<{ charged: number; parked: number }> {
  let charged = 0;
  let parked = 0;

  for (const sub of store.listDueSubscriptions()) {
    if (sub.maxTotalMicro && sub.spentMicro >= sub.maxTotalMicro) {
      store.setSubscriptionStatus(sub.id, "exhausted");
      continue;
    }
    const nextRunAt = new Date(Date.now() + sub.intervalHours * 3600_000).toISOString();
    // Claim the due slot BEFORE awaiting the rail — otherwise an overlapping
    // sweep can pick up the same in-flight charge and double-spend.
    if (!store.claimSubscriptionRun(sub.id, sub.nextRunAt, nextRunAt)) continue;

    const intentId = id("int");
    const decision = evaluatePolicy(
      {
        agentId: sub.agentId,
        orgId: sub.orgId,
        tool: "pay_api",
        amountMicro: sub.amountMicro,
        destination: sub.vendor,
        idempotencyKey: `sub_${sub.id}_${sub.runs}`,
      },
      rulesFor(sub.agentId, sub.orgId, sub.vendor),
      "subscription",
    );
    recordDecision({
      intentId,
      orgId: sub.orgId,
      agentId: sub.agentId,
      outcome: decision.outcome,
      ruleIds: decision.ruleIds,
      reasons: decision.reasons,
      tool: "pay_api",
      amountUsdc: formatMicroToUsdc(sub.amountMicro),
      destination: sub.vendor,
    });

    if (decision.outcome === "review") {
      const approval: ApprovalRow = {
        id: id("apr"),
        orgId: sub.orgId,
        agentId: sub.agentId,
        intentId,
        tool: "pay_api",
        amountMicro: sub.amountMicro,
        amountUsdc: formatMicroToUsdc(sub.amountMicro),
        destination: sub.vendor,
        memo: sub.memo ?? `subscription ${sub.id}`,
        idempotencyKey: `sub_${sub.id}_${sub.runs}`,
        ruleIds: decision.ruleIds,
        reasons: decision.reasons,
        status: "pending",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + APPROVAL_TTL_MINUTES * 60_000).toISOString(),
      };
      store.createApproval(approval);
      void notify({ kind: "approval.pending", approval });
      emitEvent(sub.orgId, "approval.pending", {
        approvalId: approval.id,
        intentId,
        agentId: sub.agentId,
        tool: "pay_api",
        amountUsdc: approval.amountUsdc,
        destination: sub.vendor,
        reasons: decision.reasons,
        expiresAt: approval.expiresAt,
        source: "subscription",
        subscriptionId: sub.id,
      });
      store.recordSubscriptionRun({
        subId: sub.id,
        chargedMicro: 0n,
        nextRunAt,
        error: `review: pending approval ${approval.id}`,
      });
      parked += 1;
      continue;
    }

    if (decision.outcome !== "allow") {
      store.recordSubscriptionRun({
        subId: sub.id,
        chargedMicro: 0n,
        nextRunAt,
        error: `${decision.outcome}: ${decision.reasons[0] ?? ""}`,
      });
      continue;
    }

    const result = await executeIntent({
      orgId: sub.orgId,
      agentId: sub.agentId,
      tool: "pay_api",
      amountMicro: sub.amountMicro,
      amountUsdc: formatMicroToUsdc(sub.amountMicro),
      destination: sub.vendor,
      intentId,
      memo: sub.memo ?? `subscription ${sub.id}`,
    });
    store.recordSubscriptionRun({
      subId: sub.id,
      chargedMicro: result.ok ? sub.amountMicro : 0n,
      nextRunAt,
      error: result.ok ? undefined : JSON.stringify(result.payload.error),
    });
    if (result.ok) charged += 1;
  }

  return { charged, parked };
}
