/**
 * x402 seller app, split from the entrypoint so its hardening is testable
 * without a live facilitator.
 *
 * Two hardening rules live here:
 *
 * 1. **Paid routes answer only their paid method.** In @x402/core <= 2.28.0
 *    the route matcher compares verbs exactly, so `HEAD /report` does not
 *    match the `"GET /report"` paywall. Express then runs the GET handler for
 *    HEAD and drops the body — the paid work runs, unpaid (upstream x402 PR
 *    #3796, merged but unreleased as of 2026-10-23). The upstream fix creates
 *    a second issue: a HEAD that *carries* a payment can settle with no body
 *    (x402 issue #3810). We refuse every non-paid method on a paid path with
 *    405 before the paywall sees it, which closes both.
 *
 * 2. **The PAYMENT-REQUIRED header stays small.** Proxies and browsers start
 *    rejecting headers around 8 KB. We budget 4 KB and refuse to boot over it.
 */
import express, { type RequestHandler } from "express";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";

/** Hard budget for any x402 header we emit (well under the ~8 KB proxy limit). */
export const MAX_PAYMENT_HEADER_BYTES = 4096;

export const USDC_BY_NETWORK: Record<string, string> = {
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

export interface SellerConfig {
  network: "eip155:84532" | "eip155:8453";
  price: string;
  payTo: `0x${string}`;
  facilitatorUrl: string;
  /** Lines served at /.well-known/abi-seller-verification (ABI ownership proof). */
  abiVerification?: string[];
}

/** Split ABI_SELLER_VERIFICATION (comma or newline separated) into record lines. */
export function parseVerificationRecords(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => /^abi-seller-verification=[a-f0-9]{16,64}$/.test(s));
}

export function paidRoutes(cfg: SellerConfig) {
  return {
    "GET /report": {
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

/** "GET /report" → { method: "GET", path: "/report" } */
function parseRouteKey(key: string): { method: string; path: string } {
  const [method, ...rest] = key.trim().split(/\s+/);
  return { method: (method ?? "").toUpperCase(), path: rest.join(" ") };
}

/**
 * Refuse any method other than the configured one on a paid path. Mount this
 * BEFORE the payment middleware.
 */
export function paidMethodGuard(routeKeys: string[]): RequestHandler {
  const byPath = new Map<string, Set<string>>();
  for (const key of routeKeys) {
    const { method, path } = parseRouteKey(key);
    if (!byPath.has(path)) byPath.set(path, new Set());
    byPath.get(path)!.add(method);
  }
  return (req, res, next) => {
    const allowed = byPath.get(req.path);
    if (!allowed || allowed.has(req.method.toUpperCase())) return next();
    const allow = [...allowed].join(", ");
    res.setHeader("Allow", allow);
    return res.status(405).json({
      error: "method_not_allowed",
      message: `${req.method} is not a paid method for ${req.path}. Use ${allow}.`,
    });
  };
}

/** Representative unpaid challenge for a route, used for the header budget. */
export function samplePaymentRequired(cfg: SellerConfig, url: string): PaymentRequired {
  const route = paidRoutes(cfg)["GET /report"];
  // `$0.01` → 10000 atomic units. The exact amount does not move the size.
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

/** Build the seller. `paywall` is the x402 payment middleware (injected for tests). */
export function createSellerApp(
  cfg: SellerConfig,
  paywall: RequestHandler,
  opts: { onPaidWork?: () => void } = {},
): express.Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "abi-x402-seller",
      protocol: "x402-v2",
      network: cfg.network,
      price: cfg.price,
      facilitator: cfg.facilitatorUrl,
      payTo: cfg.payTo,
    });
  });

  if (cfg.abiVerification?.length) {
    const body = `${cfg.abiVerification.join("\n")}\n`;
    app.get("/.well-known/abi-seller-verification", (_req, res) => {
      res.type("text/plain").set("cache-control", "no-store").send(body);
    });
  }

  app.use(paidMethodGuard(Object.keys(paidRoutes(cfg))));
  app.use(paywall);

  app.get("/report", (_req, res) => {
    opts.onPaidWork?.();
    res.json({
      report: "Competitor pricing summary",
      rows: [
        { vendor: "Acme API", plan: "Pro", pricePerMonthUsd: 49 },
        { vendor: "Globex Data", plan: "Team", pricePerMonthUsd: 99 },
        { vendor: "Initech Cloud", plan: "Scale", pricePerMonthUsd: 249 },
      ],
      generatedAt: new Date().toISOString(),
    });
  });

  return app;
}
