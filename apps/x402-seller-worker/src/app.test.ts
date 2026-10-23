import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { x402HTTPResourceServer, x402ResourceServer } from "@x402/core/server";
import type { FacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  MAX_PAYMENT_HEADER_BYTES,
  assertPaymentHeaderBudget,
  canonicalPath,
  configFromEnv,
  createSellerHandler,
  paidRoutes,
  paymentRequiredHeaderBytes,
  type SellerConfig,
} from "./app.js";
import worker from "./worker.js";

const cfg: SellerConfig = {
  network: "eip155:84532",
  price: "$0.01",
  payTo: "0x001f2Bd37f9847b24D220a499b48eC3661258EEc",
  facilitatorUrl: "https://facilitator.invalid",
};
const BASE = "https://abi-x402-seller.example.workers.dev";
const TX = `0x${"ab".repeat(32)}`;

/** In-memory facilitator: supports exact/eip155:84532 and records calls. */
function fakeFacilitator(opts: { valid?: boolean; settleOk?: boolean } = {}) {
  const calls = { verify: 0, settle: 0, supported: 0 };
  const client: FacilitatorClient = {
    async getSupported() {
      calls.supported += 1;
      return {
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
        extensions: [],
        signers: {},
      };
    },
    async verify() {
      calls.verify += 1;
      return opts.valid === false
        ? { isValid: false, invalidReason: "invalid_signature" }
        : { isValid: true, payer: "0x1111111111111111111111111111111111111111" };
    },
    async settle(_p, req) {
      calls.settle += 1;
      return opts.settleOk === false
        ? { success: false, errorReason: "settle_failed", transaction: "", network: req.network }
        : {
            success: true,
            transaction: TX,
            network: req.network,
            payer: "0x1111111111111111111111111111111111111111",
          };
    },
  };
  return { client, calls };
}

function realSeller(fac = fakeFacilitator()) {
  let paidWork = 0;
  const rs = new x402ResourceServer(fac.client).register(cfg.network, new ExactEvmScheme());
  const http = new x402HTTPResourceServer(rs, paidRoutes(cfg));
  const handle = createSellerHandler(cfg, http, { onPaidWork: () => (paidWork += 1) });
  return { handle, fac, paidWork: () => paidWork };
}

async function challenge(handle: (r: Request) => Promise<Response>) {
  const res = await handle(new Request(`${BASE}/report`));
  assert.equal(res.status, 402);
  const header = res.headers.get("payment-required");
  assert.ok(header, "PAYMENT-REQUIRED header present");
  return { res, required: decodePaymentRequiredHeader(header) };
}

function paymentFor(required: ReturnType<typeof decodePaymentRequiredHeader>) {
  return encodePaymentSignatureHeader({
    x402Version: 2,
    resource: required.resource,
    accepted: required.accepts[0]!,
    payload: {
      signature: `0x${"11".repeat(65)}`,
      authorization: {
        from: "0x1111111111111111111111111111111111111111",
        to: cfg.payTo,
        value: required.accepts[0]!.amount,
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 600),
        nonce: `0x${"22".repeat(32)}`,
      },
    },
  });
}

describe("x402 seller worker", () => {
  it("serves /health with the seller config (same shape as the old host)", async () => {
    const { handle } = realSeller();
    const res = await handle(new Request(`${BASE}/health`));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      ok: true,
      service: "abi-x402-seller",
      protocol: "x402-v2",
      network: "eip155:84532",
      price: "$0.01",
      facilitator: "https://facilitator.invalid",
      payTo: cfg.payTo,
    });
    const head = await handle(new Request(`${BASE}/health`, { method: "HEAD" }));
    assert.equal(head.status, 200);
  });

  it("unpaid GET /report → 402 challenge with Base Sepolia USDC requirements", async () => {
    const { handle, paidWork } = realSeller();
    const { res, required } = await challenge(handle);
    assert.equal(await res.text(), "{}");
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(required.x402Version, 2);
    assert.equal(required.resource.url, `${BASE}/report`);
    assert.equal(required.resource.description, "ABI merchant competitor-pricing report");
    assert.equal(required.accepts.length, 1);
    const a = required.accepts[0]!;
    assert.equal(a.scheme, "exact");
    assert.equal(a.network, "eip155:84532");
    assert.equal(a.amount, "10000");
    assert.equal(a.asset, "0x036CbD53842c5426634e7929541eC2318f3dCF7e");
    assert.equal(a.payTo, cfg.payTo);
    assert.equal(a.maxTimeoutSeconds, 120);
    assert.deepEqual(a.extra, { name: "USDC", version: "2" });
    assert.equal(paidWork(), 0);
  });

  it("valid payment → facilitator verify + settle, report + PAYMENT-RESPONSE", async () => {
    const { handle, fac, paidWork } = realSeller();
    const { required } = await challenge(handle);
    const res = await handle(
      new Request(`${BASE}/report`, { headers: { "PAYMENT-SIGNATURE": paymentFor(required) } }),
    );
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await res.json()) as { rows: unknown[]; report: string };
    assert.equal(body.report, "Competitor pricing summary");
    assert.equal(body.rows.length, 3);
    assert.equal(fac.calls.verify, 1);
    assert.equal(fac.calls.settle, 1);
    assert.equal(paidWork(), 1);
    const pr = res.headers.get("payment-response");
    assert.ok(pr, "PAYMENT-RESPONSE header present");
    const settled = JSON.parse(Buffer.from(pr, "base64").toString("utf8"));
    assert.equal(settled.success, true);
    assert.equal(settled.transaction, TX);
    assert.match(res.headers.get("cache-control") ?? "", /private/);
  });

  it("invalid payment → 402 again, handler never runs, nothing settles", async () => {
    const { handle, fac, paidWork } = realSeller(fakeFacilitator({ valid: false }));
    const { required } = await challenge(handle);
    const res = await handle(
      new Request(`${BASE}/report`, { headers: { "PAYMENT-SIGNATURE": paymentFor(required) } }),
    );
    assert.equal(res.status, 402);
    assert.equal(fac.calls.settle, 0);
    assert.equal(paidWork(), 0);
  });

  it("failed settlement → no report body is released", async () => {
    const { handle } = realSeller(fakeFacilitator({ settleOk: false }));
    const { required } = await challenge(handle);
    const res = await handle(
      new Request(`${BASE}/report`, { headers: { "PAYMENT-SIGNATURE": paymentFor(required) } }),
    );
    assert.equal(res.status, 402);
    assert.doesNotMatch(await res.text(), /Competitor pricing/);
  });

  it("HEAD /report (paid or unpaid) is 405 and never reaches the paywall", async () => {
    const fac = fakeFacilitator();
    const { handle, paidWork } = realSeller(fac);
    for (const headers of [{}, { "payment-signature": "eyJmYWtlIjp0cnVlfQ==" }] as Record<
      string,
      string
    >[]) {
      const res = await handle(new Request(`${BASE}/report`, { method: "HEAD", headers }));
      assert.equal(res.status, 405);
      assert.equal(res.headers.get("allow"), "GET");
    }
    assert.equal(fac.calls.supported + fac.calls.verify + fac.calls.settle, 0);
    assert.equal(paidWork(), 0);
  });

  it("other methods and path variants on /report are refused", async () => {
    const { handle, paidWork } = realSeller();
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
      const res = await handle(new Request(`${BASE}/report`, { method }));
      assert.equal(res.status, 405, method);
    }
    for (const p of ["/REPORT", "/report/", "/Report?x=1"]) {
      const res = await handle(new Request(`${BASE}${p}`, { method: "HEAD" }));
      assert.equal(res.status, 405, p);
      const get = await handle(new Request(`${BASE}${p}`));
      assert.equal(get.status, 402, p);
    }
    assert.equal(paidWork(), 0);
  });

  it("unknown paths are a JSON 404", async () => {
    const { handle } = realSeller();
    const res = await handle(new Request(`${BASE}/nope`));
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not_found" });
  });

  it("facilitator outage → 5xx, never a free report", async () => {
    const broken: FacilitatorClient = {
      getSupported: () => Promise.reject(new Error("down")),
      verify: () => Promise.reject(new Error("down")),
      settle: () => Promise.reject(new Error("down")),
    };
    let paidWork = 0;
    const rs = new x402ResourceServer(broken).register(cfg.network, new ExactEvmScheme());
    const handle = createSellerHandler(cfg, new x402HTTPResourceServer(rs, paidRoutes(cfg)), {
      onPaidWork: () => (paidWork += 1),
    });
    const res = await handle(new Request(`${BASE}/report`));
    assert.ok(res.status >= 500, String(res.status));
    assert.equal(paidWork, 0);
  });

  it("keeps the PAYMENT-REQUIRED header under budget and refuses oversize", () => {
    const bytes = paymentRequiredHeaderBytes(cfg, `${BASE}/report`);
    assert.ok(bytes > 0 && bytes <= MAX_PAYMENT_HEADER_BYTES, `${bytes} bytes`);
    assert.throws(() => assertPaymentHeaderBudget(cfg, `${BASE}/${"x".repeat(6000)}`), /budget/);
  });

  it("config: requires a payout wallet, defaults to Base Sepolia", () => {
    assert.throws(() => configFromEnv({}), /X402_SELLER_ADDRESS/);
    assert.throws(() => configFromEnv({ X402_SELLER_ADDRESS: "nope" }), /X402_SELLER_ADDRESS/);
    const c = configFromEnv({ X402_SELLER_ADDRESS: cfg.payTo, CHAIN: "base-sepolia" });
    assert.equal(c.network, "eip155:84532");
    assert.equal(c.price, "$0.01");
    assert.equal(c.facilitatorUrl, "https://x402.org/facilitator");
    assert.equal(
      configFromEnv({ X402_SELLER_ADDRESS: cfg.payTo, CHAIN: "base" }).network,
      "eip155:8453",
    );
  });

  it("worker entry: missing wallet → 500 JSON, health works with vars", async () => {
    const bad = await worker.fetch(new Request(`${BASE}/health`), {});
    assert.equal(bad.status, 500);
    const ok = await worker.fetch(new Request(`${BASE}/health`), {
      X402_SELLER_ADDRESS: cfg.payTo,
      CHAIN: "base-sepolia",
    });
    assert.equal(ok.status, 200);
  });

  it("canonicalPath matches Express routing", () => {
    assert.equal(canonicalPath("/Report/"), "/report");
    assert.equal(canonicalPath("/"), "/");
  });
});
