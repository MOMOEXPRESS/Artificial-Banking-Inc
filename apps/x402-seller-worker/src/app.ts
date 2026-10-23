/**
 * ABI x402 V2 demo seller as a fetch handler (Cloudflare Workers).
 *
 * Behaviour matches the Express seller in apps/x402-seller, which it replaces
 * as the hosted demo:
 *
 *   GET  /health  → seller config (free)
 *   GET  /report  → paid: 402 + PAYMENT-REQUIRED until a valid payment is sent,
 *                   then the report plus PAYMENT-RESPONSE after settlement
 *   any other method on /report → 405 (closes the HEAD-bypass, x402 PR #3796 /
 *                   issue #3810) before the paywall ever sees the request
 *
 * The PAYMENT-REQUIRED header is budgeted at 4 KB (proxies reject ~8 KB).
 * Settlement is delegated to the configured facilitator.
 */
import { Buffer } from "node:buffer";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { getFacilitatorResponseError, withPrivateCacheControl } from "@x402/core/server";
import type {
  HTTPAdapter,
  HTTPProcessResult,
  HTTPRequestContext,
  ProcessSettleResultResponse,
} from "@x402/core/server";

export const MAX_PAYMENT_HEADER_BYTES = 4096;

export const USDC_BY_NETWORK: Record<string, string> = {
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

export type SellerNetwork = "eip155:84532" | "eip155:8453";

export interface SellerConfig {
  network: SellerNetwork;
  price: string;
  payTo: `0x${string}`;
  facilitatorUrl: string;
}

export interface SellerEnv {
  X402_SELLER_ADDRESS?: string;
  X402_FACILITATOR_URL?: string;
  X402_PRICE_USDC?: string;
  CHAIN?: string;
}

/** Read config from Worker vars. Throws (→ 500) when the payout wallet is missing. */
export function configFromEnv(env: SellerEnv): SellerConfig {
  const payTo = env.X402_SELLER_ADDRESS?.trim();
  if (!payTo || !/^0x[a-fA-F0-9]{40}$/.test(payTo)) {
    throw new Error(
      "X402_SELLER_ADDRESS must be the Base wallet that receives the USDC settlement.",
    );
  }
  return {
    network: env.CHAIN === "base" ? "eip155:8453" : "eip155:84532",
    price: env.X402_PRICE_USDC?.trim() || "$0.01",
    payTo: payTo as `0x${string}`,
    facilitatorUrl: env.X402_FACILITATOR_URL?.trim() || "https://x402.org/facilitator",
  };
}

export const PAID_ROUTE_KEY = "GET /report";
export const PAID_PATH = "/report";

export function paidRoutes(cfg: SellerConfig) {
  return {
    [PAID_ROUTE_KEY]: {
      accepts: {
        scheme: "exact",
        price: cfg.price,
        network: cfg.network,
        payTo: cfg.payTo,
        maxTimeoutSeconds: 120,
      },
      description: "ABI merchant competitor-pricing report",
      mimeType: "application/json",
    },
  } as const;
}

/** Representative unpaid challenge, used for the header budget. */
export function samplePaymentRequired(cfg: SellerConfig, url: string): PaymentRequired {
  const route = paidRoutes(cfg)[PAID_ROUTE_KEY];
  const atomic = String(Math.round(Number(cfg.price.replace(/^\$/, "")) * 1_000_000) || 1);
  return {
    x402Version: 2,
    error: "Payment required",
    resource: { url, description: route.description, mimeType: route.mimeType },
    accepts: [
      {
        scheme: "exact",
        network: cfg.network,
        asset: USDC_BY_NETWORK[cfg.network]!,
        amount: atomic,
        payTo: cfg.payTo,
        maxTimeoutSeconds: route.accepts.maxTimeoutSeconds,
        extra: { name: "USDC", version: "2" },
      },
    ],
  };
}

export function paymentRequiredHeaderBytes(cfg: SellerConfig, url: string): number {
  return Buffer.byteLength(encodePaymentRequiredHeader(samplePaymentRequired(cfg, url)), "utf8");
}

export function assertPaymentHeaderBudget(cfg: SellerConfig, url: string): number {
  const bytes = paymentRequiredHeaderBytes(cfg, url);
  if (bytes > MAX_PAYMENT_HEADER_BYTES) {
    throw new Error(
      `PAYMENT-REQUIRED header is ${bytes} bytes; budget is ${MAX_PAYMENT_HEADER_BYTES}. ` +
        "Trim route metadata or extensions before shipping.",
    );
  }
  return bytes;
}

/** The slice of x402HTTPResourceServer the handler uses (injectable for tests). */
export interface Paywall {
  requiresPayment(context: HTTPRequestContext): boolean;
  initialize(): Promise<void>;
  processHTTPRequest(context: HTTPRequestContext): Promise<HTTPProcessResult>;
  processSettlement(
    ...args: Parameters<import("@x402/core/server").x402HTTPResourceServer["processSettlement"]>
  ): Promise<ProcessSettleResultResponse>;
  createFailurePathSettlementHeaders(
    ...args: Parameters<
      import("@x402/core/server").x402HTTPResourceServer["createFailurePathSettlementHeaders"]
    >
  ): Record<string, string> | undefined;
}

/** Same paths Express would route: case-insensitive, one optional trailing slash. */
export function canonicalPath(pathname: string): string {
  const lower = pathname.toLowerCase();
  return lower.length > 1 && lower.endsWith("/") ? lower.slice(0, -1) : lower;
}

class FetchAdapter implements HTTPAdapter {
  constructor(
    private readonly req: Request,
    private readonly url: URL,
    private readonly path: string,
  ) {}
  getHeader(name: string) {
    return this.req.headers.get(name) ?? undefined;
  }
  getMethod() {
    return this.req.method.toUpperCase();
  }
  getPath() {
    return this.path;
  }
  getUrl() {
    return this.url.toString();
  }
  getAcceptHeader() {
    return this.req.headers.get("accept") ?? "";
  }
  getUserAgent() {
    return this.req.headers.get("user-agent") ?? "";
  }
  getQueryParams() {
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of this.url.searchParams) {
      const prev = out[k];
      out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
    }
    return out;
  }
  getQueryParam(name: string) {
    const all = this.url.searchParams.getAll(name);
    return all.length === 0 ? undefined : all.length === 1 ? all[0] : all;
  }
  getBody() {
    return undefined;
  }
}

const JSON_TYPE = "application/json; charset=utf-8";

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": JSON_TYPE, ...headers },
  });
}

function instructionsResponse(r: {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  isHtml?: boolean;
}): Response {
  const headers = new Headers(r.headers);
  if (r.isHtml) {
    if (!headers.has("content-type")) headers.set("content-type", "text/html; charset=utf-8");
    return new Response(String(r.body ?? ""), { status: r.status, headers });
  }
  headers.set("content-type", JSON_TYPE);
  return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers });
}

export interface SellerHandlerOptions {
  onPaidWork?: () => void;
  now?: () => Date;
}

/** Build the seller fetch handler around a paywall (the real one or a test double). */
export function createSellerHandler(
  cfg: SellerConfig,
  paywall: Paywall,
  opts: SellerHandlerOptions = {},
): (req: Request) => Promise<Response> {
  let initPromise: Promise<void> | null = null;
  let budgetChecked = false;

  const reportResponse = () => {
    opts.onPaidWork?.();
    return json(200, {
      report: "Competitor pricing summary",
      rows: [
        { vendor: "Acme API", plan: "Pro", pricePerMonthUsd: 49 },
        { vendor: "Globex Data", plan: "Team", pricePerMonthUsd: 99 },
        { vendor: "Initech Cloud", plan: "Scale", pricePerMonthUsd: 249 },
      ],
      generatedAt: (opts.now?.() ?? new Date()).toISOString(),
    });
  };

  async function paid(req: Request, url: URL, path: string): Promise<Response> {
    if (!budgetChecked) {
      assertPaymentHeaderBudget(cfg, `${url.origin}${PAID_PATH}`);
      budgetChecked = true;
    }
    const adapter = new FetchAdapter(req, url, path);
    const context: HTTPRequestContext = {
      adapter,
      path,
      method: "GET",
      paymentHeader: adapter.getHeader("payment-signature") || adapter.getHeader("x-payment"),
    };
    if (!paywall.requiresPayment(context)) {
      // Fail closed: the paid path must always be gated.
      return json(500, { error: "Internal Server Error" });
    }
    if (!initPromise) initPromise = paywall.initialize();
    try {
      await initPromise;
    } catch (err) {
      initPromise = null;
      throw err;
    }

    const result = await paywall.processHTTPRequest(context);
    if (result.type === "no-payment-required") {
      return json(500, { error: "Internal Server Error" });
    }
    if (result.type === "payment-error") return instructionsResponse(result.response);

    const { cancellationDispatcher, beforeHandlerSettlement, paymentPayload, paymentRequirements } =
      result;
    let work: Response;
    try {
      work = reportResponse();
    } catch (error) {
      const cancel = await cancellationDispatcher.cancel({ reason: "handler_threw", error });
      const failure = paywall.createFailurePathSettlementHeaders(
        cancel,
        beforeHandlerSettlement,
        paymentPayload,
        null,
      );
      return json(500, { error: "Internal Server Error" }, failure ?? {});
    }
    const bodyBytes = Buffer.from(await work.arrayBuffer());
    const responseHeaders: Record<string, string> = {};
    work.headers.forEach((v, k) => (responseHeaders[k] = v));

    const settle = await paywall.processSettlement(
      paymentPayload,
      paymentRequirements,
      result.declaredExtensions,
      { request: context, responseBody: bodyBytes, responseHeaders },
      undefined,
      beforeHandlerSettlement,
    );
    if (!settle.success) return instructionsResponse(settle.response);

    const headers = new Headers(responseHeaders);
    for (const [k, v] of Object.entries(settle.headers)) headers.set(k, v);
    headers.set("cache-control", withPrivateCacheControl(headers.get("cache-control")));
    return new Response(bodyBytes, { status: work.status, headers });
  }

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = canonicalPath(url.pathname);
    const method = req.method.toUpperCase();
    try {
      if (path === "/health") {
        if (method !== "GET" && method !== "HEAD") return json(404, { error: "not_found" });
        const res = json(200, {
          ok: true,
          service: "abi-x402-seller",
          protocol: "x402-v2",
          network: cfg.network,
          price: cfg.price,
          facilitator: cfg.facilitatorUrl,
          payTo: cfg.payTo,
        });
        return method === "HEAD" ? new Response(null, { status: 200, headers: res.headers }) : res;
      }
      if (path === PAID_PATH) {
        if (method !== "GET") {
          return json(
            405,
            {
              error: "method_not_allowed",
              message: `${req.method} is not a paid method for ${PAID_PATH}. Use GET.`,
            },
            { allow: "GET" },
          );
        }
        return await paid(req, url, path);
      }
      return json(404, { error: "not_found" });
    } catch (err) {
      const facilitatorError = getFacilitatorResponseError(err);
      if (facilitatorError) return json(502, { error: facilitatorError.message });
      console.error(JSON.stringify({ type: "abi.x402-seller.error", message: String(err) }));
      return json(500, { error: "Internal Server Error" });
    }
  };
}
