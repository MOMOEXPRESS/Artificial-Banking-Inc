/**
 * x401 at ABI's hosted x402 checkout, through the real Express app and store.
 * TEST-ONLY keys and trust anchors (./test-fixtures); the x402 facilitator is
 * a counting stand-in, so nothing is broadcast and no funds move.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import {
  decodeProofRequest,
  fixturePem,
  issueSdJwtVc,
  newHolder,
  newVerifierSigningJwk,
  present,
  proofResponseHeader,
  TEST_ISSUER,
  TEST_VCT,
} from "./test-helpers.js";

const dir = mkdtempSync(join(tmpdir(), "abi-x401-checkout-"));
process.env.POLICYVAULT_DB = join(dir, "x401.db");
process.env.ABI_KEY_PEPPER = "x401-checkout-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.ABI_ALLOW_UNVERIFIED_SIGNUP = "1";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";
process.env.ABI_PUBLIC_API_URL = "https://api.abi.test";
const CLIENT_ID = "https://api.abi.test/.well-known/abi-x401-client.json";
// The production config path, fed test-only values.
process.env.X401_ENABLED = "1";
process.env.X401_ENVIRONMENT = "sandbox";
process.env.X401_CLIENT_ID = CLIENT_ID;
process.env.X401_SIGNING_JWK = JSON.stringify(newVerifierSigningJwk());
process.env.X401_TRUSTED_ISSUERS = JSON.stringify([
  {
    id: "test",
    issuer: TEST_ISSUER,
    anchorsPem: [fixturePem("test-root.cert.pem")],
    vcts: [TEST_VCT],
  },
]);

const { store, sellerStore, x401Store } = await import("../../store.js");
const { app } = await import("../../index.js");
const { setHostedFacilitator } = await import("../../seller-x402.js");
const { setX401VerifierForTests } = await import("./gate.js");

const PAYOUT = "0x2222222222222222222222222222222222222222";
const PASSWORD = "X401-Checkout-Pass-1!";
const calls = { verify: 0, settle: 0 };
let tx = 0;
setHostedFacilitator({
  async verify(payload: PaymentPayload, req: PaymentRequirements) {
    calls.verify += 1;
    const auth = (payload.payload as { authorization?: { to?: string; value?: string } })
      .authorization;
    return auth?.to?.toLowerCase() === req.payTo.toLowerCase() && auth?.value === req.amount
      ? { isValid: true, payer: "0x4444444444444444444444444444444444444444" }
      : { isValid: false, invalidReason: "mismatch" };
  },
  async settle(_payload: PaymentPayload, req: PaymentRequirements) {
    calls.settle += 1;
    tx += 1;
    return {
      success: true,
      transaction: `0x${tx.toString(16).padStart(64, "0")}`,
      network: req.network,
      payer: "0x4444444444444444444444444444444444444444",
    };
  },
});

let server: ReturnType<typeof app.listen>;
let base: string;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  setHostedFacilitator(null);
  setX401VerifierForTests(undefined);
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

type Session = { cookies: string; csrf: string; orgId: string };

async function signup(email: string, companyName: string): Promise<Session> {
  const res = await fetch(`${base}/v1/partner/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, name: "Seller", password: PASSWORD, companyName }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  const body = (await res.json()) as { org: { id: string } };
  const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const csrf = cookies
    .split("; ")
    .find((c) => c.startsWith("abi_partner_csrf="))!
    .slice("abi_partner_csrf=".length);
  return { cookies, csrf, orgId: body.org.id };
}

function call(s: Session, method: string, path: string, body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers:
      method === "GET"
        ? { cookie: s.cookies }
        : { cookie: s.cookies, "x-abi-csrf": s.csrf, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type OfferJson = { id: string; endpointUrl: string; identityRequirement: string };

async function x401Offer(slug: string): Promise<{ s: Session; offer: OfferJson }> {
  const s = await signup(`${slug}@example.com`, `${slug} Co`);
  await call(s, "PATCH", "/v1/seller/profile", { payoutAddress: PAYOUT });
  const created = await call(s, "POST", "/v1/seller/offers", {
    slug,
    title: `Report ${slug}`,
    hosted: true,
    priceUsdc: "0.05",
    category: "research",
    description: "An identity-gated brief.",
    hostedContent: '{"brief":"secret"}',
  });
  assert.equal(created.status, 201, await created.clone().text());
  const { offer } = (await created.json()) as { offer: OfferJson };
  assert.equal(offer.identityRequirement, "none", "x401 is opt-in per offer");
  const patched = await call(s, "PATCH", `/v1/seller/offers/${offer.id}`, {
    identityRequirement: "x401",
  });
  assert.equal(patched.status, 200, await patched.clone().text());
  assert.equal(((await patched.json()) as { offer: OfferJson }).offer.identityRequirement, "x401");
  assert.equal((await call(s, "POST", `/v1/seller/offers/${offer.id}/verify`)).status, 200);
  const pub = await call(s, "POST", `/v1/seller/offers/${offer.id}/publish`);
  assert.equal(pub.status, 200, await pub.clone().text());
  return { s, offer: ((await pub.json()) as { offer: OfferJson }).offer };
}

const get = (offer: OfferJson, headers: Record<string, string> = {}) =>
  fetch(`${base}/v1/x402/offers/${offer.id}`, { headers });

/** Ask for a challenge and answer it with a test-only credential. */
async function proofFor(offer: OfferJson, aud = CLIENT_ID): Promise<string> {
  const res = await get(offer);
  assert.equal(res.status, 401);
  const { request } = decodeProofRequest(res.headers.get("proof-request")!);
  const holder = newHolder();
  const vc = await issueSdJwtVc({ holder });
  return proofResponseHeader(await present(vc, holder, { aud, nonce: request.nonce as string }));
}

/** A well-formed x402 V2 payment for the offer's 402 requirement (stand-in facilitator only). */
async function paymentFor(offer: OfferJson, proof: string): Promise<string> {
  const res = await get(offer, { "proof-response": proof });
  assert.equal(res.status, 402, await res.clone().text());
  const required = decodePaymentRequiredHeader(res.headers.get("payment-required")!);
  const req = required.accepts[0]!;
  return encodePaymentSignatureHeader({
    x402Version: 2,
    resource: required.resource,
    accepted: req,
    payload: {
      signature: `0x${"11".repeat(65)}`,
      authorization: {
        from: "0x4444444444444444444444444444444444444444",
        to: req.payTo,
        value: req.amount,
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 600),
        nonce: `0x${"22".repeat(32)}`,
      },
    },
  } as PaymentPayload);
}

const errorCode = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe("x401 at the hosted x402 checkout", () => {
  it("leaves offers without x401 on the plain 402 path", async () => {
    const s = await signup("plain@example.com", "Plain Co");
    await call(s, "PATCH", "/v1/seller/profile", { payoutAddress: PAYOUT });
    const created = await call(s, "POST", "/v1/seller/offers", {
      slug: "plain",
      title: "Plain",
      hosted: true,
      priceUsdc: "0.05",
      category: "research",
      description: "No identity needed.",
      hostedContent: "{}",
    });
    const { offer } = (await created.json()) as { offer: OfferJson };
    const res = await get(offer);
    assert.equal(res.status, 402);
    assert.equal(res.headers.get("proof-request"), null);
  });

  it("asks for proof (401 PROOF-REQUEST) before any 402 or facilitator call", async () => {
    const { offer } = await x401Offer("needs-proof");
    const before = { ...calls };
    const res = await get(offer);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("payment-required"), null, "no payment challenge before identity");
    assert.equal(await errorCode(res), "IDENTITY_PROOF_REQUIRED");
    const { payload, request } = decodeProofRequest(res.headers.get("proof-request")!);
    assert.equal(payload.version, "0.2.0");
    assert.equal(request.client_id, CLIENT_ID);
    assert.deepEqual(calls, before);
  });

  it("a valid proof unlocks the 402 challenge but is not payment", async () => {
    const { offer } = await x401Offer("proof-not-payment");
    const before = { ...calls };
    const res = await get(offer, { "proof-response": await proofFor(offer) });
    assert.equal(res.status, 402);
    assert.ok(res.headers.get("payment-required"));
    assert.doesNotMatch(await res.text(), /secret/);
    assert.deepEqual(calls, before, "proof alone verifies and settles nothing");
  });

  it("proof + payment completes once; the proof cannot be replayed", async () => {
    const { s, offer } = await x401Offer("full-flow");
    const proof = await proofFor(offer);
    const payment = await paymentFor(offer, proof);
    const before = { ...calls };
    const res = await get(offer, { "proof-response": proof, "payment-signature": payment });
    const body = (await res.json()) as {
      content: { brief: string };
      identity: {
        verified: boolean;
        protocol: string;
        issuer: string;
        proves: Record<string, boolean>;
      };
    };
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.content.brief, "secret");
    assert.equal(body.identity.verified, true);
    assert.equal(body.identity.protocol, "x401");
    assert.equal(body.identity.issuer, TEST_ISSUER);
    assert.equal(body.identity.proves.paymentAuthorization, false);
    assert.equal(body.identity.proves.humanDelegation, false);
    assert.equal(
      JSON.stringify(body).includes("given_name"),
      false,
      "disclosed claims are not echoed",
    );
    assert.deepEqual(calls, { verify: before.verify + 1, settle: before.settle + 1 });
    assert.equal(sellerStore.listSettlements(s.orgId).length, 1);

    const replay = await get(offer, { "proof-response": proof, "payment-signature": payment });
    assert.equal(replay.status, 401);
    assert.equal(
      ((await replay.json()) as { error: { x401Error: string } }).error.x401Error,
      "replayed",
    );
    assert.ok(replay.headers.get("proof-result"));
    assert.deepEqual(
      calls,
      { verify: before.verify + 1, settle: before.settle + 1 },
      "replay never reaches the facilitator",
    );
    assert.equal(sellerStore.listSettlements(s.orgId).length, 1);

    const audit = x401Store.listAudit(offer.id);
    assert.ok(audit.some((e) => e.outcome === "verified" && e.stage === "checkout"));
    assert.ok(audit.some((e) => e.error_code === "replayed" || e.errorCode === "replayed"));
    assert.equal(JSON.stringify(audit).includes("Holder"), false, "audit holds no personal claims");
  });

  it("a paid request without proof, or with an invalid proof, is refused before verify/settle", async () => {
    const { s, offer } = await x401Offer("paid-no-proof");
    const payment = await paymentFor(offer, await proofFor(offer));
    const before = { ...calls };
    const noProof = await get(offer, { "payment-signature": payment });
    assert.equal(noProof.status, 401);
    assert.equal(await errorCode(noProof), "IDENTITY_PROOF_REQUIRED");
    const wrongAud = await get(offer, {
      "proof-response": await proofFor(offer, "https://elsewhere.invalid/client.json"),
      "payment-signature": payment,
    });
    assert.equal(wrongAud.status, 401);
    assert.equal(
      ((await wrongAud.json()) as { error: { x401Error: string } }).error.x401Error,
      "wrong_audience",
    );
    const garbage = await get(offer, { "proof-response": "!!", "payment-signature": payment });
    assert.equal(garbage.status, 400);
    assert.deepEqual(calls, before, "nothing verified or settled");
    assert.equal(sellerStore.listSettlements(s.orgId).length, 0);
  });

  it("fails closed (503) when the verifier is unavailable, before any payment", async () => {
    const { s, offer } = await x401Offer("verifier-down");
    const proof = await proofFor(offer);
    const payment = await paymentFor(offer, proof);
    const before = { ...calls };
    setX401VerifierForTests(null);
    try {
      const attempts: Record<string, string>[] = [
        {},
        { "proof-response": proof },
        { "proof-response": proof, "payment-signature": payment },
      ];
      for (const headers of attempts) {
        const res = await get(offer, headers);
        assert.equal(res.status, 503);
        assert.equal(await errorCode(res), "IDENTITY_VERIFIER_UNAVAILABLE");
      }
    } finally {
      setX401VerifierForTests(undefined);
    }
    assert.deepEqual(calls, before);
    assert.equal(sellerStore.listSettlements(s.orgId).length, 0);
  });

  it("cannot be set on a non-hosted offer", async () => {
    const s = await signup("external@example.com", "External Co");
    const created = await call(s, "POST", "/v1/seller/offers", {
      slug: "external",
      title: "External",
      hosted: false,
      endpointUrl: "https://seller.example/report",
      priceUsdc: "0.05",
      category: "research",
      description: "Seller-hosted endpoint.",
    });
    assert.equal(created.status, 201, await created.clone().text());
    const { offer } = (await created.json()) as { offer: OfferJson };
    const patched = await call(s, "PATCH", `/v1/seller/offers/${offer.id}`, {
      identityRequirement: "x401",
    });
    assert.equal(patched.status, 400);
  });
});

function buyer(destination: string, name: string, allow: boolean) {
  const org = store.createOrg(name, 1_000_000n);
  const agent = store.createAgent(org.id, `${name} agent`);
  const policy = store.getPolicyTemplate(org.id);
  store.setPolicyTemplate(org.id, {
    ...policy,
    vendorAllowlist: allow ? [destination] : ["https://someone-else.example/api"],
    perTxMaxMicro: 1_000_000n,
    dailyMaxMicro: 1_000_000n,
    hitlAboveMicro: 1_000_000n,
    newCounterpartyCooldownHours: 0,
  });
  if (allow) store.addKnownCounterparty(org.id, destination);
  store.applyEntries(org.id, [
    {
      id: `fund_${org.id}`,
      orgId: org.id,
      memo: "agent stipend",
      createdAt: new Date().toISOString(),
      lines: [
        { accountId: `org:${org.id}:available`, deltaMicro: -500_000n },
        { accountId: `agent:${agent.agentId}:available`, deltaMicro: 500_000n },
      ],
    },
  ]);
  return { org, agent };
}

const payApi = (apiKey: string, destination: string, idempotencyKey: string) =>
  fetch(`${base}/v1/agent/pay_api`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ amountUsdc: "0.05", destination, idempotencyKey }),
  });

const available = (orgId: string, agentId: string) =>
  store.getAccountMap(orgId).get(`dept:${store.getAgentAnyOrg(agentId)?.budgetId}:available`)
    ?.balanceMicro ?? 0n;

describe("identity never authorizes spending", () => {
  it("buyer policy still runs first for an x401 offer", async () => {
    const { offer } = await x401Offer("policy-first");
    const { org, agent } = buyer(offer.endpointUrl, "Denied Buyer", false);
    const before = { ...calls };
    const auditBefore = x401Store.listAudit(offer.id).length;
    const res = await payApi(agent.apiKey, offer.endpointUrl, "x401-policy-1");
    assert.notEqual(res.status, 200, await res.clone().text());
    assert.deepEqual(calls, before);
    assert.equal(available(org.id, agent.agentId), 500_000n, "nothing held");
    assert.equal(
      x401Store.listAudit(offer.id).length,
      auditBefore,
      "policy refused before the checkout was touched",
    );
  });

  it("an allowed ABI agent without a proof gets no payment signed or settled", async () => {
    const { s, offer } = await x401Offer("agent-no-proof");
    const { org, agent } = buyer(offer.endpointUrl, "Allowed Buyer", true);
    const before = { ...calls };
    const res = await payApi(agent.apiKey, offer.endpointUrl, "x401-agent-1");
    assert.notEqual(res.status, 200, await res.clone().text());
    assert.deepEqual(calls, before, "nothing verified or settled");
    assert.equal(sellerStore.listSettlements(s.orgId).length, 0);
    assert.equal(available(org.id, agent.agentId), 500_000n, "any hold is released");
    const audit = x401Store.listAudit(offer.id);
    assert.ok(
      audit.some((e) => (e.caller_agent_id ?? e.callerAgentId) === agent.agentId),
      "challenge bound to the agent",
    );
  });
});
