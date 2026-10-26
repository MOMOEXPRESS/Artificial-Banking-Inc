/**
 * Seller-side bookkeeping for buyer pays that land on a listed offer endpoint:
 * settlement + usage rows, seller webhooks, usage threshold alerts, and the
 * per-buyer / per-agent access evaluator.
 */
import { formatMicroToUsdc } from "@policyvault/common";
import { sellerStore, type OfferRow, type SellerUsageMode } from "./store.js";
import { emitEvent } from "./webhooks.js";

const RATE_LIMITED_MODES: SellerUsageMode[] = ["paid", "sandbox"];

export type SellerAccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "SELLER_DENIED" | "SELLER_RATE_LIMITED";
      policyId: string;
      message: string;
    };

function startOfUtcDay(now: Date): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

/**
 * Most specific matching policy wins (agent > buyer org > offer-wide > seller-wide).
 * A deny at any matched level blocks; rate limits apply from every matched policy.
 */
export function evaluateSellerAccess(
  offer: OfferRow,
  buyerOrgId: string | undefined,
  agentId: string | undefined,
  now = new Date(),
): SellerAccessDecision {
  const policies = sellerStore
    .listPolicies(offer.orgId)
    .filter(
      (p) =>
        (!p.offerId || p.offerId === offer.id) &&
        (!p.buyerOrgId || p.buyerOrgId === buyerOrgId) &&
        (!p.agentId || p.agentId === agentId),
    );
  for (const p of policies) {
    if (p.effect === "deny") {
      return {
        allowed: false,
        code: "SELLER_DENIED",
        policyId: p.id,
        message: p.note || "The seller does not accept calls from this buyer or agent.",
      };
    }
  }
  const minuteAgo = new Date(now.getTime() - 60_000).toISOString();
  const dayStart = startOfUtcDay(now);
  for (const p of policies) {
    const scope = {
      offerId: p.offerId ? offer.id : undefined,
      sellerOrgId: offer.orgId,
      buyerOrgId: p.buyerOrgId ? buyerOrgId : undefined,
      agentId: p.agentId ? agentId : undefined,
      modes: RATE_LIMITED_MODES,
    };
    if (
      p.ratePerMinute !== undefined &&
      sellerStore.countCalls({ ...scope, sinceIso: minuteAgo }) >= p.ratePerMinute
    ) {
      return {
        allowed: false,
        code: "SELLER_RATE_LIMITED",
        policyId: p.id,
        message: `Rate limit of ${p.ratePerMinute} calls/minute reached.`,
      };
    }
    if (
      p.ratePerDay !== undefined &&
      sellerStore.countCalls({ ...scope, sinceIso: dayStart }) >= p.ratePerDay
    ) {
      return {
        allowed: false,
        code: "SELLER_RATE_LIMITED",
        policyId: p.id,
        message: `Rate limit of ${p.ratePerDay} calls/day reached.`,
      };
    }
  }
  return { allowed: true };
}

export function checkUsageAlerts(offer: OfferRow, now = new Date()): void {
  const day = startOfUtcDay(now);
  for (const alert of sellerStore.listAlerts(offer.orgId)) {
    if (alert.offerId && alert.offerId !== offer.id) continue;
    const calls = sellerStore.countCalls({
      sellerOrgId: offer.orgId,
      offerId: alert.offerId,
      sinceIso: day,
    });
    if (calls < alert.thresholdCalls) continue;
    if (!sellerStore.claimAlertFiring(alert.id, day.slice(0, 10))) continue;
    emitEvent(offer.orgId, "seller.usage.threshold", {
      alertId: alert.id,
      offerId: alert.offerId ?? null,
      thresholdCalls: alert.thresholdCalls,
      callsToday: calls,
      day: day.slice(0, 10),
    });
  }
}

/** Called after a buyer pay settles. Never throws into the pay path. */
export function ingestSellerPayment(input: {
  destination: string;
  amountMicro: bigint;
  buyerOrgId: string;
  agentId?: string;
  txHash?: string;
}): number {
  let matched = 0;
  try {
    for (const offer of sellerStore.findOffersByEndpoint(input.destination)) {
      if (offer.orgId === input.buyerOrgId) continue;
      const settlementId = sellerStore.recordSettlement({
        sellerOrgId: offer.orgId,
        offerId: offer.id,
        buyerOrgId: input.buyerOrgId,
        amountMicro: input.amountMicro.toString(),
        txHash: input.txHash,
      });
      sellerStore.recordUsage({
        sellerOrgId: offer.orgId,
        offerId: offer.id,
        buyerOrgId: input.buyerOrgId,
        agentId: input.agentId,
        mode: "paid",
        amountMicro: input.amountMicro.toString(),
        settlementId,
      });
      emitEvent(offer.orgId, "seller.payment.received", {
        settlementId,
        offerId: offer.id,
        offerSlug: offer.slug,
        offerVersion: offer.version,
        buyerOrgId: input.buyerOrgId,
        agentId: input.agentId ?? null,
        amountUsdc: formatMicroToUsdc(input.amountMicro),
        txHash: input.txHash ?? null,
      });
      checkUsageAlerts(offer);
      matched += 1;
    }
  } catch (error) {
    console.error("seller ingest failed (pay unaffected):", error);
  }
  return matched;
}
