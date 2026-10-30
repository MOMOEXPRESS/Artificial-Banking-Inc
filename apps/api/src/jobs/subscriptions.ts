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
  approvalBindingHash,
  approvalExpiresAt,
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
      store.setSubscriptionStatus(sub.id, sub.kind === "one_shot" ? "completed" : "exhausted");
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
    const recorded = recordDecision({
      intentId,
      orgId: sub.orgId,
      agentId: sub.agentId,
      outcome: decision.outcome,
      ruleIds: decision.ruleIds,
      reasons: decision.reasons,
      tool: "pay_api",
      amountUsdc: formatMicroToUsdc(sub.amountMicro),
      destination: sub.vendor,
      limits: decision.limits,
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
        subscriptionId: sub.id,
        ruleIds: decision.ruleIds,
        reasons: decision.reasons,
        status: "pending",
        createdAt: new Date().toISOString(),
        expiresAt: approvalExpiresAt(),
        // Bound to these rules: a policy change cancels it (cancelled_stale).
        rulesHash: approvalBindingHash(sub.agentId, sub.orgId),
        policyRevision: store.getPolicyVersion(sub.orgId),
      };
      store.createApproval(approval);
      // notify() already fans into the webhook channel — do not also emitEvent.
      void notify({ kind: "approval.pending", approval });
      store.recordSubscriptionRun({
        subId: sub.id,
        chargedMicro: 0n,
        nextRunAt,
        error: `review: pending approval ${approval.id}`,
        status: "awaiting_approval",
      });
      parked += 1;
      continue;
    }

    if (decision.outcome !== "allow") {
      const error = `${decision.outcome}: ${decision.reasons[0] ?? ""}`;
      store.recordSubscriptionRun({
        subId: sub.id,
        chargedMicro: 0n,
        nextRunAt,
        error,
        status: sub.kind === "one_shot" ? "failed" : "active",
      });
      emitEvent(sub.orgId, "payment.failed", {
        subscriptionId: sub.id,
        agentId: sub.agentId,
        destination: sub.vendor,
        amountUsdc: formatMicroToUsdc(sub.amountMicro),
        reason: error,
        intentId,
        ruleIds: decision.ruleIds,
        ...(recorded.limits && { limits: recorded.limits }),
        receipt: recorded.receipt,
      });
      void notify({
        kind: "info",
        orgId: sub.orgId,
        title: sub.kind === "one_shot" ? "Scheduled payment failed" : "Subscription charge failed",
        body: `${formatMicroToUsdc(sub.amountMicro)} USDC to ${sub.vendor} — ${error}`,
        meta: { subscriptionId: sub.id, agentId: sub.agentId },
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
    const spentAfter = sub.spentMicro + (result.ok ? sub.amountMicro : 0n);
    const completed =
      result.ok &&
      (sub.kind === "one_shot" || Boolean(sub.maxTotalMicro && spentAfter >= sub.maxTotalMicro));
    const error = result.ok ? undefined : JSON.stringify(result.payload.error);
    store.recordSubscriptionRun({
      subId: sub.id,
      chargedMicro: result.ok ? sub.amountMicro : 0n,
      nextRunAt,
      error,
      status: result.ok
        ? completed
          ? sub.kind === "one_shot"
            ? "completed"
            : "exhausted"
          : "active"
        : sub.kind === "one_shot"
          ? "failed"
          : "active",
    });
    if (result.ok) {
      charged += 1;
      emitEvent(sub.orgId, "subscription.charged", {
        subscriptionId: sub.id,
        kind: sub.kind,
        agentId: sub.agentId,
        destination: sub.vendor,
        amountUsdc: formatMicroToUsdc(sub.amountMicro),
        status: sub.kind === "one_shot" ? "completed" : completed ? "exhausted" : "active",
      });
      void notify({
        kind: "info",
        orgId: sub.orgId,
        title: sub.kind === "one_shot" ? "Scheduled payment completed" : "Subscription charged",
        body: `${formatMicroToUsdc(sub.amountMicro)} USDC paid to ${sub.vendor}.`,
        meta: { subscriptionId: sub.id, agentId: sub.agentId },
      });
    } else {
      emitEvent(sub.orgId, "payment.failed", {
        subscriptionId: sub.id,
        agentId: sub.agentId,
        destination: sub.vendor,
        amountUsdc: formatMicroToUsdc(sub.amountMicro),
        reason: error,
      });
      void notify({
        kind: "info",
        orgId: sub.orgId,
        title: sub.kind === "one_shot" ? "Scheduled payment failed" : "Subscription charge failed",
        body: `${formatMicroToUsdc(sub.amountMicro)} USDC to ${sub.vendor} did not settle.`,
        meta: { subscriptionId: sub.id, agentId: sub.agentId },
      });
    }
  }

  return { charged, parked };
}
