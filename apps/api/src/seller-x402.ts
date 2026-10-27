/**
 * ABI-hosted x402 V2 resource server for seller offers.
 *
 * A seller without their own server lists a hosted offer; ABI answers
 *   GET /v1/x402/offers/:offerId
 * with 402 + PAYMENT-REQUIRED (payTo = the seller's payout address), and on a
 * paid retry verifies and settles the signed authorization through the x402
 * facilitator before returning the offer's content with PAYMENT-RESPONSE.
 * USDC moves buyer vault → seller wallet on-chain; ABI never holds it.
 */
import type express from "express";
import {
  HTTPFacilitatorClient,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { sellerStore, store, type OfferRow } from "./store.js";
import { gateOffer, recordSellerSale } from "./seller-ingest.js";

export const X402_NETWORKS: Record<string, { caip2: string; asset: string; tokenName: string }> = {
  "base-sepolia": {
    caip2: "eip155:84532",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    tokenName: "USDC",
  },
  base: {
    caip2: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokenName: "USD Coin",
  },
};

export interface Facilitator {
  verify(payload: PaymentPayload, req: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, req: PaymentRequirements): Promise<SettleResponse>;
}

let facilitatorOverride: Facilitator | null = null;

/** Tests swap in a local facilitator; production always uses X402_FACILITATOR_URL. */
export function setHostedFacilitator(f: Facilitator | null): void {
  facilitatorOverride = f;
}

function facilitator(): Facilitator {
  if (facilitatorOverride) return facilitatorOverride;
  return new HTTPFacilitatorClient({
    url: process.env.X402_FACILITATOR_URL?.trim() || "https://x402.org/facilitator",
    timeoutMs: 25_000,
  });
}

export function publicApiBase(): string {
  const configured = process.env.ABI_PUBLIC_API_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  return `http://localhost:${process.env.PORT ?? "4000"}`;
}

export const HOSTED_PATH_PREFIX = "/v1/x402/offers/";

export function hostedOfferUrl(offerId: string): string {
  return `${publicApiBase()}${HOSTED_PATH_PREFIX}${offerId}`;
}

/** The offer id when `url` is this deployment's hosted route, else undefined. */
export function hostedOfferIdFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const base = new URL(publicApiBase());
    if (u.host.toLowerCase() !== base.host.toLowerCase()) return undefined;
    if (!u.pathname.startsWith(HOSTED_PATH_PREFIX)) return undefined;
    const rest = u.pathname.slice(HOSTED_PATH_PREFIX.length).replace(/\/+$/, "");
    return /^[A-Za-z0-9_-]+$/.test(rest) ? rest : undefined;
  } catch {
    return undefined;
  }
}

export function requirementFor(offer: OfferRow, payTo: string): PaymentRequirements {
  const net = X402_NETWORKS[offer.network] ?? X402_NETWORKS["base-sepolia"]!;
  return {
    scheme: "exact",
    network: net.caip2 as PaymentRequirements["network"],
    asset: net.asset,
    amount: offer.priceUsdcMicro,
    payTo,
    maxTimeoutSeconds: 120,
    extra: { name: net.tokenName, version: "2" },
  };
}

export interface HostedResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface HostedCaller {
  /** Set when an ABI buyer engine dispatches in-process; external x402 clients are anonymous. */
  buyerOrgId?: string;
  agentId?: string;
}

function err(status: number, code: string, message: string, extra: object = {}): HostedResult {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: { error: { code, message, ...extra } },
  };
}

function authorizationOf(payload: PaymentPayload): { nonce?: string; from?: string } {
  const auth = (payload.payload as { authorization?: { nonce?: unknown; from?: unknown } })
    ?.authorization;
  return {
    nonce: typeof auth?.nonce === "string" ? auth.nonce : undefined,
    from: typeof auth?.from === "string" ? auth.from : undefined,
  };
}

/**
 * Settle threw after the authorization reached the facilitator, so the
 * transfer may or may not be on-chain. Record the nonce for reconciliation and
 * never tell the buyer "nothing was charged".
 */
function outcomeUnknown(
  offer: OfferRow,
  payload: PaymentPayload,
  requirement: PaymentRequirements,
  caller: HostedCaller,
  error: unknown,
): HostedResult {
  const { nonce, from } = authorizationOf(payload);
  const reason = error instanceof Error ? error.message : String(error);
  console.error("hosted x402 settle outcome unknown:", { offerId: offer.id, nonce, reason });
  try {
    sellerStore.recordUnknownSettle({
      offerId: offer.id,
      sellerOrgId: offer.orgId,
      buyerOrgId: caller.buyerOrgId,
      nonce: nonce ?? "",
      payer: from,
      amountMicro: requirement.amount,
      network: requirement.network,
      error: reason.slice(0, 500),
    });
  } catch (recordError) {
    console.error("could not record unknown hosted settle:", recordError);
  }
  return err(
    502,
    "PAYMENT_OUTCOME_UNKNOWN",
    "The payment may have settled on-chain; its outcome is not confirmed yet. Do not pay again — ABI is reconciling it by authorization nonce.",
    { nonce: nonce ?? null },
  );
}

function parseContent(raw: string): unknown {
  const text = raw.trim();
  if (!text) return null;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function sameAddress(a: unknown, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}

/**
 * The hosted resource handler, independent of Express so the buyer rail can
 * call it in-process (a Worker cannot reliably fetch its own public URL).
 */
export async function handleHostedOffer(
  offerId: string,
  getHeader: (name: string) => string | undefined,
  caller: HostedCaller = {},
  requestUrl = hostedOfferUrl(offerId),
): Promise<HostedResult> {
  const offer = sellerStore.getOfferAnyOrg(offerId);
  if (!offer || !offer.hosted || offer.archivedAt) {
    return err(404, "OFFER_NOT_FOUND", "No hosted offer at this URL.");
  }
  const profile = store.getSellerProfile(offer.orgId);
  const payTo = profile?.payoutAddress;
  if (!payTo) {
    return err(503, "SELLER_NOT_READY", "The seller has not set a payout address yet.");
  }
  const requirement = requirementFor(offer, payTo);
  const sellerName = profile?.displayName || "Seller";
  const signature = getHeader("payment-signature") ?? getHeader("x-payment");

  // Refuse a paused or retired offer before issuing a challenge, so no buyer
  // signs an authorization the seller will not honour.
  if (offer.status === "paused" || (offer.sunsetAt && offer.sunsetAt <= new Date().toISOString())) {
    const gate = gateOffer(offer, caller.buyerOrgId, caller.agentId);
    if (!gate.ok) return err(gate.status, gate.error.code, gate.error.message, gate.error);
  }

  if (!signature) {
    const required: PaymentRequired = {
      x402Version: 2,
      error: "Payment required",
      resource: {
        url: requestUrl,
        description: `${sellerName}: ${offer.title}`.slice(0, 200),
        mimeType: "application/json",
      },
      accepts: [requirement],
    };
    return {
      status: 402,
      headers: {
        "content-type": "application/json",
        "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required),
        "cache-control": "no-store",
      },
      body: required,
    };
  }

  if (offer.status !== "published" && offer.status !== "verified") {
    return err(409, "OFFER_NOT_LIVE", `${offer.title} is not published yet.`);
  }
  const gate = gateOffer(offer, caller.buyerOrgId, caller.agentId);
  if (!gate.ok) return err(gate.status, gate.error.code, gate.error.message, gate.error);

  let payload: PaymentPayload;
  try {
    payload = decodePaymentSignatureHeader(signature);
  } catch {
    return err(400, "INVALID_PAYMENT", "PAYMENT-SIGNATURE is not a valid x402 payload.");
  }
  if (payload.x402Version !== 2) {
    return err(400, "UNSUPPORTED_VERSION", "Only x402 V2 payments are accepted.");
  }
  const accepted = (payload as { accepted?: Partial<PaymentRequirements> }).accepted ?? {};
  if (
    accepted.network !== requirement.network ||
    !sameAddress(accepted.asset, requirement.asset) ||
    !sameAddress(accepted.payTo, requirement.payTo) ||
    String(accepted.amount) !== requirement.amount
  ) {
    return err(
      402,
      "PAYMENT_MISMATCH",
      "The signed payment does not match this offer's price, network or payee. Request a fresh challenge.",
    );
  }

  const f = facilitator();
  let verified: VerifyResponse;
  try {
    verified = await f.verify(payload, requirement);
  } catch (error) {
    console.error("hosted x402 verify failed:", error);
    // Verify never moves funds, so this one really is nothing charged.
    return err(
      502,
      "FACILITATOR_UNAVAILABLE",
      "Payment could not be checked right now. Nothing was charged.",
    );
  }
  if (!verified.isValid) {
    return err(
      402,
      "PAYMENT_INVALID",
      verified.invalidMessage ?? verified.invalidReason ?? "Facilitator rejected the payment.",
    );
  }
  let settled: SettleResponse;
  try {
    settled = await f.settle(payload, requirement);
  } catch (error) {
    // A settle that times out may already have broadcast the transfer.
    return outcomeUnknown(offer, payload, requirement, caller, error);
  }
  if (!settled.success || !/^0x[0-9a-fA-F]{64}$/.test(settled.transaction ?? "")) {
    return err(
      402,
      "SETTLEMENT_FAILED",
      settled.errorMessage ?? settled.errorReason ?? "Facilitator did not settle the payment.",
    );
  }

  const amountMicro = BigInt(settled.amount ?? requirement.amount);
  recordSellerSale({
    offer,
    amountMicro,
    buyerOrgId: caller.buyerOrgId,
    agentId: caller.agentId,
    txHash: settled.transaction,
  });

  return {
    status: 200,
    headers: {
      "content-type": "application/json",
      "PAYMENT-RESPONSE": encodePaymentResponseHeader({
        ...settled,
        network: requirement.network,
        payer: settled.payer ?? verified.payer,
      }),
      "cache-control": "private, no-store",
    },
    body: {
      offer: { id: offer.id, slug: offer.slug, title: offer.title, version: offer.version },
      seller: { orgId: offer.orgId, name: sellerName },
      content: parseContent(offer.hostedContent),
      paid: {
        amountMicro: amountMicro.toString(),
        network: requirement.network,
        txHash: settled.transaction,
        payer: settled.payer ?? verified.payer ?? null,
      },
    },
  };
}

function headerReader(init?: RequestInit): (name: string) => string | undefined {
  const h = new Headers(init?.headers);
  return (name) => h.get(name) ?? undefined;
}

/**
 * A `fetch` for the buyer rail that answers hosted-offer URLs in-process and
 * refuses anything else (callers only use it for hosted URLs).
 */
export function hostedFetch(caller: HostedCaller): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const offerId = hostedOfferIdFromUrl(url);
    if (!offerId) throw new Error(`hostedFetch only serves hosted offer URLs, got ${url}`);
    const result = await handleHostedOffer(offerId, headerReader(init), caller, url);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: result.headers,
    });
  }) as typeof fetch;
}

export function registerHostedX402Routes(app: express.Express): void {
  // Express would run the GET handler for HEAD; a paid path answers GET only.
  app.head(`${HOSTED_PATH_PREFIX}:offerId`, (_req, res) => {
    res.setHeader("allow", "GET");
    res.status(405).end();
  });
  app.get(`${HOSTED_PATH_PREFIX}:offerId`, async (req, res) => {
    try {
      const result = await handleHostedOffer(
        req.params.offerId,
        (name) => {
          const v = req.headers[name.toLowerCase()];
          return Array.isArray(v) ? v[0] : v;
        },
        {},
        `${publicApiBase()}${req.originalUrl.split("?")[0]}`,
      );
      for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
      res.status(result.status).json(result.body);
    } catch (error) {
      console.error("hosted x402 offer failed:", error);
      const signed = Boolean(req.headers["payment-signature"] ?? req.headers["x-payment"]);
      res.status(502).json({
        error: signed
          ? {
              code: "PAYMENT_OUTCOME_UNKNOWN",
              message:
                "The payment may have settled on-chain; its outcome is not confirmed yet. Do not pay again.",
            }
          : { code: "OFFER_UNAVAILABLE", message: "This offer could not be served right now." },
      });
    }
  });
  app.all(`${HOSTED_PATH_PREFIX}:offerId`, (req, res) => {
    res.setHeader("allow", "GET");
    res.status(405).json({
      error: { code: "METHOD_NOT_ALLOWED", message: `${req.method} is not paid. Use GET.` },
    });
  });
}
