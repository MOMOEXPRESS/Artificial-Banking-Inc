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
      code: "SELLER_DENIED" | "SELLER_RATE_LIMITED" | "SELLER_ALLOWLIST";
      policyId: string;
      message: string;
    };

function startOfUtcDay(now: Date): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

/**
 * Every matching policy applies (agent, buyer org, offer-wide, seller-wide).
 * A deny at any matched level blocks; rate limits apply from every matched
 * policy. An offer in `allowlist` mode only admits a buyer org or agent named
 * by an allow policy on that offer or seller-wide.
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
  if (offer.accessMode === "allowlist") {
    const named = policies.some(
      (p) => p.effect === "allow" && (Boolean(p.buyerOrgId) || Boolean(p.agentId)),
    );
    if (!named) {
      return {
        allowed: false,
        code: "SELLER_ALLOWLIST",
        policyId: `allowlist:${offer.id}`,
        message: "This offer is limited to approved customers. Ask the seller for access.",
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

export type SellerOfferGate =
  | { ok: true; offer?: OfferRow }
  | {
      ok: false;
      status: 403 | 409 | 410 | 429;
      offer: OfferRow;
      error: {
        code: string;
        message: string;
        policyId?: string;
        successorOfferId?: string | null;
      };
    };

/**
 * Whether the seller behind `offer` will take this call right now: live,
 * not past sunset, and the buyer passes the seller's access policies.
 * A blocked call is recorded as `denied` usage so the seller sees it.
 */
export function gateOffer(
  offer: OfferRow,
  buyerOrgId: string | undefined,
  agentId: string | undefined,
  now = new Date(),
): SellerOfferGate {
  if (offer.archivedAt || offer.status === "paused") {
    return {
      ok: false,
      status: 409,
      offer,
      error: { code: "OFFER_PAUSED", message: `${offer.title} is not taking calls right now.` },
    };
  }
  if (offer.sunsetAt && offer.sunsetAt <= now.toISOString()) {
    return {
      ok: false,
      status: 410,
      offer,
      error: {
        code: "OFFER_SUNSET",
        message: `${offer.title} ${offer.version} was retired on ${offer.sunsetAt.slice(0, 10)}.`,
        successorOfferId: offer.successorOfferId ?? null,
      },
    };
  }
  const access = evaluateSellerAccess(offer, buyerOrgId, agentId, now);
  if (!access.allowed) {
    sellerStore.recordUsage({
      sellerOrgId: offer.orgId,
      offerId: offer.id,
      buyerOrgId,
      agentId,
      mode: "denied",
    });
    return {
      ok: false,
      status: access.code === "SELLER_RATE_LIMITED" ? 429 : 403,
      offer,
      error: { code: access.code, message: access.message, policyId: access.policyId },
    };
  }
  return { ok: true, offer };
}

/**
 * Before a buyer pay to a URL that belongs to a listed offer, ask the seller's
 * rules first so a refused call never holds money or signs anything.
 */
export function sellerPrePayCheck(
  destination: string,
  buyerOrgId: string,
  agentId: string,
  now = new Date(),
): SellerOfferGate {
  const offer = sellerStore.resolveOfferForPay(destination);
  if (!offer || offer.orgId === buyerOrgId) return { ok: true };
  return gateOffer(offer, buyerOrgId, agentId, now);
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

/**
 * Book one paid call against one offer. Idempotent on (offer, txHash): the
 * hosted resource server and the buyer's engine may both report the same sale,
 * and the second report only fills in the buyer if the first did not know it.
 */
export function recordSellerSale(input: {
  offer: OfferRow;
  amountMicro: bigint;
  buyerOrgId?: string;
  agentId?: string;
  txHash?: string;
}): { settlementId: string; created: boolean } {
  const { offer } = input;
  if (input.txHash) {
    const existing = sellerStore.settlementIdByTx(offer.id, input.txHash);
    if (existing) {
      if (input.buyerOrgId) sellerStore.attachBuyer(existing, input.buyerOrgId, input.agentId);
      return { settlementId: existing, created: false };
    }
  }
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
    buyerOrgId: input.buyerOrgId ?? null,
    agentId: input.agentId ?? null,
    amountUsdc: formatMicroToUsdc(input.amountMicro),
    txHash: input.txHash ?? null,
  });
  checkUsageAlerts(offer);
  return { settlementId, created: true };
}

/**
 * Called after a buyer pay settles. Credits the single offer the destination
 * resolves to (a URL pays one seller, one version). Never throws into the pay path.
 */
export function ingestSellerPayment(input: {
  destination: string;
  amountMicro: bigint;
  buyerOrgId: string;
  agentId?: string;
  txHash?: string;
}): number {
  try {
    const offer = sellerStore.resolveOfferForPay(input.destination);
    if (!offer || offer.orgId === input.buyerOrgId) return 0;
    recordSellerSale({ ...input, offer });
    return 1;
  } catch (error) {
    console.error("seller ingest failed (pay unaffected):", error);
    return 0;
  }
}
