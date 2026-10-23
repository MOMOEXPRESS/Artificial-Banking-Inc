import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { RequestHandler } from "express";
import {
  MAX_PAYMENT_HEADER_BYTES,
  assertPaymentHeaderBudget,
  createSellerApp,
  paymentRequiredHeaderBytes,
  type SellerConfig,
} from "./app.js";

const cfg: SellerConfig = {
  network: "eip155:84532",
  price: "$0.01",
  payTo: "0x5555555555555555555555555555555555555555",
  facilitatorUrl: "https://facilitator.invalid",
};

/**
 * Stand-in for @x402/express <= 2.28: it gates exactly "GET /report" and lets
 * every other method through — the upstream HEAD bypass (x402 PR #3796).
 */
let paywallSaw: string[] = [];
const exactVerbPaywall: RequestHandler = (req, res, next) => {
  paywallSaw.push(`${req.method} ${req.path}`);
  if (req.method === "GET" && req.path === "/report" && !req.header("payment-signature")) {
    res.setHeader("PAYMENT-REQUIRED", "challenge");
    return res.status(402).json({});
  }
  return next();
};

let handlerRuns = 0;
let base = "";
let server: ReturnType<ReturnType<typeof createSellerApp>["listen"]>;

before(async () => {
  const app = createSellerApp(cfg, exactVerbPaywall, { onPaidWork: () => (handlerRuns += 1) });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server?.close());

describe("x402 seller hardening", () => {
  it("unpaid GET gets the 402 challenge and never runs the handler", async () => {
    handlerRuns = 0;
    const res = await fetch(`${base}/report`);
    assert.equal(res.status, 402);
    assert.equal(handlerRuns, 0);
  });

  it("unpaid HEAD on a paid GET route is refused and never runs the handler", async () => {
    handlerRuns = 0;
    paywallSaw = [];
    const res = await fetch(`${base}/report`, { method: "HEAD" });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET");
    assert.equal(handlerRuns, 0, "paid work must not run for an unpaid HEAD");
    assert.deepEqual(paywallSaw, [], "the request must not even reach the paywall");
  });

  it("a HEAD carrying a payment is refused too (no paid request without a body)", async () => {
    handlerRuns = 0;
    const res = await fetch(`${base}/report`, {
      method: "HEAD",
      headers: { "payment-signature": "eyJmYWtlIjp0cnVlfQ==" },
    });
    assert.equal(res.status, 405);
    assert.equal(handlerRuns, 0);
  });

  it("other methods on a paid path are refused", async () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
      const res = await fetch(`${base}/report`, { method });
      assert.equal(res.status, 405, method);
    }
    assert.equal(handlerRuns, 0);
  });

  it("free routes are unaffected", async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const head = await fetch(`${base}/health`, { method: "HEAD" });
    assert.equal(head.status, 200);
  });

  it("keeps the PAYMENT-REQUIRED header well under 8 KB", () => {
    const bytes = paymentRequiredHeaderBytes(cfg, "https://seller.example/report");
    assert.ok(bytes > 0);
    assert.ok(bytes <= MAX_PAYMENT_HEADER_BYTES, `${bytes} bytes`);
    assert.ok(MAX_PAYMENT_HEADER_BYTES < 8190);
  });

  it("refuses to boot when the challenge would exceed the budget", () => {
    assert.throws(
      () => assertPaymentHeaderBudget(cfg, `https://seller.example/${"x".repeat(6000)}`),
      /budget/,
    );
  });
});
