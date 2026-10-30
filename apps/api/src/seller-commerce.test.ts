/**
 * Buyer → seller commerce through the ABI-hosted x402 route: a seller lists a
 * hosted offer, a buyer agent pays it through /v1/agent/pay_api, and the sale
 * shows up once on both sides. The facilitator is the only stand-in (it would
 * otherwise broadcast on Base Sepolia); everything else is the production path.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

const dir = mkdtempSync(join(tmpdir(), "abi-seller-commerce-"));
process.env.POLICYVAULT_DB = join(dir, "commerce.db");
process.env.ABI_KEY_PEPPER = "seller-commerce-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.ABI_ALLOW_UNVERIFIED_SIGNUP = "1";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";
process.env.ABI_PUBLIC_API_URL = "https://api.abi.test";

const { store, sellerStore, reloadDbFromDisk } = await import("./store.js");
const { app } = await import("./index.js");
const { setHostedFacilitator } = await import("./seller-x402.js");
const { currentCode } = await import("./auth/totp.js");
const { runSellerStatements } = await import("./jobs/seller-statements.js");

const PAYOUT = "0x2222222222222222222222222222222222222222";
const PAYOUT_2 = "0x3333333333333333333333333333333333333333";
const PASSWORD = "Seller-Commerce-Pass-1!";

const facilitatorCalls: { verify: number; settle: number } = { verify: 0, settle: 0 };
let txCounter = 0;
let settleThrows = false;
setHostedFacilitator({
  async verify(payload: PaymentPayload, req: PaymentRequirements) {
    facilitatorCalls.verify += 1;
    const auth = (payload.payload as { authorization?: { to?: string; value?: string } })
      .authorization;
    const ok = auth?.to?.toLowerCase() === req.payTo.toLowerCase() && auth?.value === req.amount;
    return ok
      ? { isValid: true, payer: "0x4444444444444444444444444444444444444444" }
      : {
          isValid: false,
          invalidReason: "authorization does not match requirement",
        };
  },
  async settle(_payload: PaymentPayload, req: PaymentRequirements) {
    facilitatorCalls.settle += 1;
    if (settleThrows) throw new Error("facilitator settle timed out");
    txCounter += 1;
    return {
      success: true,
      transaction: `0x${txCounter.toString(16).padStart(64, "0")}`,
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
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

type Session = { cookies: string; csrf: string; orgId: string };

function sessionFrom(res: Response, orgId: string): Session {
  const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const csrf = cookies
    .split("; ")
    .find((c) => c.startsWith("abi_partner_csrf="))!
    .slice("abi_partner_csrf=".length);
  return { cookies, csrf, orgId };
}

async function signup(email: string, companyName: string): Promise<Session> {
  const res = await fetch(`${base}/v1/partner/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, name: "Seller", password: PASSWORD, companyName }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  const body = (await res.json()) as { org: { id: string } };
  return sessionFrom(res, body.org.id);
}

async function login(email: string, extra: Record<string, string> = {}, password = PASSWORD) {
  return fetch(`${base}/v1/partner/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, ...extra }),
  });
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

type OfferJson = {
  id: string;
  endpointUrl: string;
  status: string;
  hosted: boolean;
  accessMode: string;
};

async function hostedOffer(s: Session, slug: string, content: string): Promise<OfferJson> {
  await call(s, "PATCH", "/v1/seller/profile", { payoutAddress: PAYOUT });
  const created = await call(s, "POST", "/v1/seller/offers", {
    slug,
    title: `Report ${slug}`,
    hosted: true,
    priceUsdc: "0.05",
    category: "research",
    description: "A daily market brief.",
    hostedContent: content,
  });
  assert.equal(created.status, 201, await created.clone().text());
  const { offer } = (await created.json()) as { offer: OfferJson };
  assert.equal(offer.hosted, true);
  assert.equal(offer.endpointUrl, `https://api.abi.test/v1/x402/offers/${offer.id}`);
  const verify = await call(s, "POST", `/v1/seller/offers/${offer.id}/verify`);
  assert.equal(verify.status, 200, await verify.clone().text());
  const pub = await call(s, "POST", `/v1/seller/offers/${offer.id}/publish`);
  assert.equal(pub.status, 200, await pub.clone().text());
  return ((await pub.json()) as { offer: OfferJson }).offer;
}

function buyerFor(destination: string, name: string) {
  const org = store.createOrg(name, 1_000_000n);
  const agent = store.createAgent(org.id, `${name} agent`);
  const policy = store.getPolicyTemplate(org.id);
  store.setPolicyTemplate(org.id, {
    ...policy,
    vendorAllowlist: [destination],
    perTxMaxMicro: 1_000_000n,
    dailyMaxMicro: 1_000_000n,
    hitlAboveMicro: 1_000_000n,
    newCounterpartyCooldownHours: 0,
  });
  store.addKnownCounterparty(org.id, destination);
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

function payApi(apiKey: string, destination: string, idempotencyKey: string) {
  return fetch(`${base}/v1/agent/pay_api`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ amountUsdc: "0.05", destination, idempotencyKey }),
  });
}

function agentAvailable(orgId: string, agentId: string): bigint {
  const budgetId = store.getAgentAnyOrg(agentId)?.budgetId;
  return store.getAccountMap(orgId).get(`dept:${budgetId}:available`)?.balanceMicro ?? 0n;
}

describe("buyer to seller through the hosted x402 route", () => {
  it("answers an unpaid GET with a real x402 V2 challenge for the seller's wallet", async () => {
    const s = await signup("challenge@example.com", "Challenge Co");
    const offer = await hostedOffer(s, "challenge-brief", '{"brief":"secret"}');
    const res = await fetch(`${base}/v1/x402/offers/${offer.id}`);
    assert.equal(res.status, 402);
    const header = res.headers.get("payment-required");
    assert.ok(header);
    const required = decodePaymentRequiredHeader(header!);
    assert.equal(required.x402Version, 2);
    assert.equal(required.accepts[0].payTo, PAYOUT);
    assert.equal(required.accepts[0].amount, "50000");
    assert.equal(required.accepts[0].network, "eip155:84532");
    assert.doesNotMatch(await res.text(), /secret/, "content stays behind the paywall");
    assert.equal(
      (await fetch(`${base}/v1/x402/offers/${offer.id}`, { method: "HEAD" })).status,
      405,
    );
  });

  it("completes a purchase once, on both sides, with the buyer's identity", async () => {
    const s = await signup("hosted@example.com", "Hosted Data Co");
    const offer = await hostedOffer(s, "hosted-brief", '{"brief":"Rates held at 4.25%"}');
    const { org, agent } = buyerFor(offer.endpointUrl, "Buyer Desk");
    const before = { ...facilitatorCalls };

    const res = await payApi(agent.apiKey, offer.endpointUrl, "hosted-buy-1");
    const body = (await res.json()) as {
      rail: string;
      txHash: string;
      amountUsdc: string;
      resource: { content: { brief: string }; seller: { name: string } };
    };
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.rail, "x402-v2");
    assert.equal(body.amountUsdc, "0.05");
    assert.equal(body.resource.content.brief, "Rates held at 4.25%");
    assert.equal(body.resource.seller.name, "Hosted Data Co");
    assert.equal(facilitatorCalls.verify - before.verify, 1);
    assert.equal(facilitatorCalls.settle - before.settle, 1);

    const sales = sellerStore.listSettlements(s.orgId);
    assert.equal(sales.length, 1, "the resource server and the engine record one sale");
    assert.equal(sales[0].buyerOrgId, org.id);
    assert.equal(sales[0].txHash, body.txHash);
    const usage = sellerStore.listUsage(s.orgId, new Date(0).toISOString());
    assert.equal(usage.filter((u) => u.mode === "paid").length, 1);
    assert.equal(usage[0].agentId, agent.agentId);
    assert.equal(agentAvailable(org.id, agent.agentId), 450_000n);
    assert.equal(store.reconcileOrgUncached(org.id).ok, true);

    const replay = await payApi(agent.apiKey, offer.endpointUrl, "hosted-buy-1");
    assert.equal(replay.status, 200);
    assert.equal(sellerStore.listSettlements(s.orgId).length, 1, "replays do not resell");

    const activity = (await (await call(s, "GET", "/v1/seller/activity")).json()) as {
      settlements: { buyerName: string; explorerUrl: string }[];
    };
    assert.equal(activity.settlements[0].buyerName, "Buyer Desk");
    assert.equal(
      activity.settlements[0].explorerUrl,
      `https://sepolia.basescan.org/tx/${body.txHash}`,
    );
  });

  it("refuses before holding or signing when the seller blocks the buyer or pauses", async () => {
    const s = await signup("gate@example.com", "Gate Co");
    const offer = await hostedOffer(s, "gate-brief", "gated");
    const { org, agent } = buyerFor(offer.endpointUrl, "Blocked Buyer");
    const deny = await call(s, "POST", "/v1/seller/policies", {
      buyerOrgId: org.id,
      effect: "deny",
      note: "Chargeback history",
    });
    assert.equal(deny.status, 201);
    const before = { ...facilitatorCalls };
    const denied = await payApi(agent.apiKey, offer.endpointUrl, "commerce-gate-1");
    assert.equal(denied.status, 403);
    assert.equal(
      ((await denied.json()) as { error: { code: string } }).error.code,
      "SELLER_DENIED",
    );
    assert.equal(agentAvailable(org.id, agent.agentId), 500_000n, "nothing held");
    assert.deepEqual(facilitatorCalls, before, "nothing signed or settled");
    const denials = sellerStore
      .listUsage(s.orgId, new Date(0).toISOString())
      .filter((u) => u.mode === "denied");
    assert.equal(denials.length, 1);

    const policies = (await (await call(s, "GET", "/v1/seller/policies")).json()) as {
      policies: { id: string }[];
    };
    await call(s, "DELETE", `/v1/seller/policies/${policies.policies[0].id}`);
    await call(s, "PATCH", `/v1/seller/offers/${offer.id}`, { status: "paused" });
    const paused = await payApi(agent.apiKey, offer.endpointUrl, "commerce-gate-2");
    assert.equal(paused.status, 409);
    assert.equal(agentAvailable(org.id, agent.agentId), 500_000n);

    const resumed = await call(s, "POST", `/v1/seller/offers/${offer.id}/publish`);
    assert.equal(resumed.status, 200);
    assert.equal((await payApi(agent.apiKey, offer.endpointUrl, "commerce-gate-3")).status, 200);
  });

  it("admits only named customers on an allowlist offer", async () => {
    const s = await signup("enterprise@example.com", "Enterprise Co");
    const offer = await hostedOffer(s, "enterprise-feed", "feed");
    await call(s, "PATCH", `/v1/seller/offers/${offer.id}`, { accessMode: "allowlist" });
    const { org, agent } = buyerFor(offer.endpointUrl, "Prospect");
    const refused = await payApi(agent.apiKey, offer.endpointUrl, "commerce-ent-1");
    assert.equal(refused.status, 403);
    assert.equal(
      ((await refused.json()) as { error: { code: string } }).error.code,
      "SELLER_ALLOWLIST",
    );
    const allow = await call(s, "POST", "/v1/seller/policies", {
      offerId: offer.id,
      buyerOrgId: org.id,
      effect: "allow",
      note: "Signed MSA",
    });
    assert.equal(allow.status, 201, await allow.clone().text());
    assert.equal((await payApi(agent.apiKey, offer.endpointUrl, "commerce-ent-2")).status, 200);
  });

  it("puts an offer back in draft when price changes, and one URL pays one seller", async () => {
    const s = await signup("terms@example.com", "Terms Co");
    const offer = await hostedOffer(s, "terms-brief", "terms");
    const patched = await call(s, "PATCH", `/v1/seller/offers/${offer.id}`, { priceUsdc: "0.10" });
    assert.equal(((await patched.json()) as { offer: OfferJson }).offer.status, "draft");
    assert.equal((await call(s, "POST", `/v1/seller/offers/${offer.id}/publish`)).status, 400);
    assert.equal(
      (await call(s, "PATCH", `/v1/seller/offers/${offer.id}`, { status: "published" })).status,
      400,
      "publishing is not a PATCH",
    );

    const a = await signup("claim-a@example.com", "Claim A");
    const b = await signup("claim-b@example.com", "Claim B");
    for (const seller of [a, b]) {
      await call(seller, "PATCH", "/v1/seller/profile", { payoutAddress: PAYOUT });
      const created = await call(seller, "POST", "/v1/seller/offers", {
        slug: `claim-${seller.orgId.slice(-6)}`,
        title: "Claimed",
        endpointUrl: "https://claimed.example/api",
        priceUsdc: "1",
      });
      const { offer: o } = (await created.json()) as { offer: OfferJson };
      store.updateOffer(seller.orgId, o.id, { status: "verified" });
      // Both proved the origin (e.g. a shared host serving both tokens).
      store.setOfferIntegration(o.id, {
        lastVerifiedAt: new Date().toISOString(),
        ownershipVerifiedAt: new Date().toISOString(),
        ownershipOrigin: "https://claimed.example",
      });
      const pub = await call(seller, "POST", `/v1/seller/offers/${o.id}/publish`);
      assert.equal(pub.status, seller === a ? 200 : 409);
    }
  });

  it("never lets an unverified listing pause or take over someone else's URL", async () => {
    const victim = await signup("victim@example.com", "Victim Co");
    const offer = await hostedOffer(victim, "victim-brief", "victim content");
    const { agent } = buyerFor(offer.endpointUrl, "Victim Buyer");

    const attacker = await signup("squatter@example.com", "Squatter Co");
    await call(attacker, "PATCH", "/v1/seller/profile", { payoutAddress: PAYOUT_2 });
    const created = await call(attacker, "POST", "/v1/seller/offers", {
      slug: "squat",
      title: "Squat",
      endpointUrl: offer.endpointUrl,
      priceUsdc: "0.05",
    });
    assert.equal(created.status, 201, await created.clone().text());
    const { offer: squat } = (await created.json()) as { offer: OfferJson };
    const pause = await call(attacker, "PATCH", `/v1/seller/offers/${squat.id}`, {
      status: "paused",
    });
    assert.equal(pause.status, 400);
    assert.equal(((await pause.json()) as { error: { code: string } }).error.code, "NOT_VERIFIED");

    // Even a paused row without a passing verify (an older build allowed it) owns nothing.
    store.updateOffer(attacker.orgId, squat.id, { status: "paused" });
    assert.equal(sellerStore.resolveOfferForPay(offer.endpointUrl)?.id, offer.id);
    assert.deepEqual(sellerStore.endpointClaims(offer.endpointUrl, victim.orgId), []);
    assert.equal((await payApi(agent.apiKey, offer.endpointUrl, "commerce-squat-1")).status, 200);
  });

  it("reports an unknown outcome, not 'nothing charged', when settle throws", async () => {
    const s = await signup("settle-timeout@example.com", "Settle Timeout Co");
    const offer = await hostedOffer(s, "timeout-brief", "timeout");
    const { agent } = buyerFor(offer.endpointUrl, "Timeout Buyer");
    settleThrows = true;
    try {
      const res = await payApi(agent.apiKey, offer.endpointUrl, "commerce-timeout-1");
      const text = await res.text();
      assert.notEqual(res.status, 200, text);
      assert.doesNotMatch(text, /Nothing was charged/);
    } finally {
      settleThrows = false;
    }
    const open = sellerStore.listUnresolvedSettles().filter((r) => r.offerId === offer.id);
    assert.equal(open.length, 1);
    assert.match(open[0].nonce, /^0x[0-9a-f]{64}$/i);
  });

  it("itemizes statements per offer with a CSV of on-chain settlements", async () => {
    const s = await signup("statement@example.com", "Statement Co");
    const offer = await hostedOffer(s, "statement-brief", "statement");
    const { agent } = buyerFor(offer.endpointUrl, "Statement Buyer");
    for (const key of ["commerce-st-1", "commerce-st-2"]) {
      assert.equal((await payApi(agent.apiKey, offer.endpointUrl, key)).status, 200);
    }
    const window = {
      periodStart: new Date(Date.now() - 86_400_000).toISOString(),
      periodEnd: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const gen = await call(s, "POST", "/v1/seller/invoices/generate", window);
    assert.equal(gen.status, 201);
    const { invoice } = (await gen.json()) as {
      invoice: { id: string; number: string; totalUsdc: string; lines: { calls: number }[] };
    };
    assert.match(invoice.number, /^ABI-\d{6}-[A-Z0-9]{4}-001$/);
    assert.equal(invoice.totalUsdc, "0.1");
    assert.equal(invoice.lines[0].calls, 2);
    const detail = (await (await call(s, "GET", `/v1/seller/invoices/${invoice.id}`)).json()) as {
      settlements: { txHash: string; buyerName: string }[];
    };
    assert.equal(detail.settlements.length, 2);
    assert.equal(detail.settlements[0].buyerName, "Statement Buyer");
    const csv = await call(s, "GET", `/v1/seller/invoices/${invoice.id}/csv`);
    assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
    const text = await csv.text();
    assert.equal(text.trim().split("\n").length, 3);
    assert.match(text, /sepolia\.basescan\.org\/tx\/0x/);

    const payouts = (await (await call(s, "GET", "/v1/seller/payouts")).json()) as {
      currentPeriod: { settledUsdc: string };
      recent: unknown[];
    };
    assert.equal(payouts.currentPeriod.settledUsdc, "0.1");
    assert.equal(payouts.recent.length, 2);

    const nextMonth = new Date();
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 2);
    const first = await runSellerStatements(nextMonth);
    assert.ok(first.generated >= 1);
    const again = await runSellerStatements(nextMonth);
    assert.equal(again.generated, 0, "one statement per seller per month");
  });

  it("asks for the password before redirecting payouts and keeps a history", async () => {
    const s = await signup("payout@example.com", "Payout Co");
    await call(s, "PATCH", "/v1/seller/profile", { payoutAddress: PAYOUT });
    const noPw = await call(s, "PATCH", "/v1/seller/profile", { payoutAddress: PAYOUT_2 });
    assert.equal(noPw.status, 403);
    const ok = await call(s, "PATCH", "/v1/seller/profile", {
      payoutAddress: PAYOUT_2,
      currentPassword: PASSWORD,
    });
    assert.equal(ok.status, 200);
    const history = (await (await call(s, "GET", "/v1/seller/profile/payout-history")).json()) as {
      changes: { newAddress: string }[];
    };
    assert.equal(history.changes[0].newAddress, PAYOUT_2);
    assert.equal(history.changes.length, 2);
    const events = store.listDeliveries(s.orgId).map((d) => d.event);
    assert.equal(
      events.filter((e) => e === "seller.payout_address.changed").length,
      0,
      "no hook yet",
    );
  });

  it("pins the payee at connect and refuses pays after the seller redirects payouts", async () => {
    const s = await signup("pinned@example.com", "Pinned Co");
    const offer = await hostedOffer(s, "pinned-brief", "pinned");
    const { org, agent } = buyerFor("https://unrelated.example/api", "Pinned Buyer");
    const asGuardian = (method: string, path: string, body?: unknown) =>
      fetch(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${org.guardianKey}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    // Two connects land without either one dropping the other's URL.
    const [first, second] = await Promise.all([
      asGuardian("POST", "/v1/guardian/connections", { offerId: offer.id }),
      asGuardian("POST", "/v1/guardian/connections", { offerId: offer.id }),
    ]);
    assert.equal(first.status, 200, await first.clone().text());
    assert.equal(second.status, 200);
    const allow = store.getPolicyTemplate(org.id).vendorAllowlist;
    assert.ok(allow.includes("https://unrelated.example/api"), "other entries survive");
    assert.equal(allow.filter((u) => u === offer.endpointUrl).length, 1);
    assert.equal(
      ((await first.json()) as { connection: { payTo: string } }).connection.payTo,
      PAYOUT,
    );
    assert.equal((await payApi(agent.apiKey, offer.endpointUrl, "commerce-pin-1")).status, 200);

    const enroll = (await (await call(s, "POST", "/v1/partner/auth/mfa/enroll")).json()) as {
      secret: string;
    };
    const confirm = await call(s, "POST", "/v1/partner/auth/mfa/confirm", {
      code: currentCode(enroll.secret),
    });
    const { recoveryCodes } = (await confirm.json()) as { recoveryCodes: string[] };
    const pwOnly = await call(s, "PATCH", "/v1/seller/profile", {
      payoutAddress: PAYOUT_2,
      currentPassword: PASSWORD,
    });
    assert.equal(pwOnly.status, 403);
    assert.equal(((await pwOnly.json()) as { error: { code: string } }).error.code, "MFA_REQUIRED");
    const disable = await call(s, "POST", "/v1/partner/auth/mfa/disable", { password: PASSWORD });
    assert.equal(disable.status, 403, "a password alone cannot turn MFA off");
    const moved = await call(s, "PATCH", "/v1/seller/profile", {
      payoutAddress: PAYOUT_2,
      currentPassword: PASSWORD,
      recoveryCode: recoveryCodes[0],
    });
    assert.equal(moved.status, 200, await moved.clone().text());

    const refused = await payApi(agent.apiKey, offer.endpointUrl, "commerce-pin-2");
    assert.equal(refused.status, 409);
    const err = ((await refused.json()) as { error: { code: string; pinnedPayTo: string } }).error;
    assert.equal(err.code, "PAYEE_CHANGED");
    assert.equal(err.pinnedPayTo, PAYOUT);
    assert.equal(
      sellerStore.listBuyerConnections(s.orgId).find((c) => c.buyerOrgId === org.id)?.pinnedPayTo,
      PAYOUT,
    );

    const reconfirm = await asGuardian("POST", "/v1/guardian/connections", { offerId: offer.id });
    assert.equal(reconfirm.status, 200);
    assert.equal((await payApi(agent.apiKey, offer.endpointUrl, "commerce-pin-3")).status, 200);

    const gone = await asGuardian("DELETE", `/v1/guardian/connections/${offer.id}`);
    assert.equal(gone.status, 200);
    assert.deepEqual(store.getPolicyTemplate(org.id).vendorAllowlist, [
      "https://unrelated.example/api",
    ]);
  });

  it("runs a sandbox dry run with the caller's real identity", async () => {
    const s = await signup("sandbox2@example.com", "Sandbox Two");
    const offer = await hostedOffer(s, "sandbox-brief", "sbx");
    const { org, agent } = buyerFor(offer.endpointUrl, "Sandbox Buyer");
    const asAgent = await fetch(`${base}/v1/sandbox/offers/${offer.id}/try`, {
      method: "POST",
      headers: { authorization: `Bearer ${agent.apiKey}` },
    });
    const body = (await asAgent.json()) as {
      caller: { buyerOrgId: string };
      challenge: { paymentRequired: string };
    };
    assert.equal(body.caller.buyerOrgId, org.id);
    assert.ok(decodePaymentRequiredHeader(body.challenge.paymentRequired).accepts[0]);
    const self = await call(s, "POST", `/v1/sandbox/offers/${offer.id}/try`);
    assert.equal(((await self.json()) as { recorded: boolean }).recorded, false);
    const sandboxCalls = sellerStore
      .listUsage(s.orgId, new Date(0).toISOString())
      .filter((u) => u.mode === "sandbox");
    assert.equal(sandboxCalls.length, 1);
  });
});

describe("partner account security", () => {
  it("enforces two-factor sign-in, rotates sessions on password change, and signs out everywhere", async () => {
    const email = "secure@example.com";
    const s = await signup(email, "Secure Co");
    const enroll = (await (await call(s, "POST", "/v1/partner/auth/mfa/enroll")).json()) as {
      secret: string;
      otpauthUri: string;
    };
    assert.match(enroll.otpauthUri, /^otpauth:\/\/totp\//);
    const confirm = await call(s, "POST", "/v1/partner/auth/mfa/confirm", {
      code: currentCode(enroll.secret),
    });
    assert.equal(confirm.status, 200);
    const { recoveryCodes } = (await confirm.json()) as { recoveryCodes: string[] };
    assert.equal(recoveryCodes.length, 10);

    const noCode = await login(email);
    assert.equal(noCode.status, 401);
    assert.equal(((await noCode.json()) as { error: { code: string } }).error.code, "MFA_REQUIRED");
    const wrong = await login(email, { code: "000000" });
    assert.equal(wrong.status, 401);
    const second = await login(email, { recoveryCode: recoveryCodes[0] });
    assert.equal(second.status, 200);
    const s2 = sessionFrom(second, s.orgId);
    assert.equal(
      (await login(email, { recoveryCode: recoveryCodes[0] })).status,
      401,
      "single use",
    );

    const sessions = (await (await call(s, "GET", "/v1/partner/auth/sessions")).json()) as {
      sessions: { id: string; current: boolean }[];
    };
    assert.equal(sessions.sessions.length, 2);
    assert.equal(sessions.sessions.filter((x) => x.current).length, 1);

    const badChange = await call(s, "POST", "/v1/partner/auth/change-password", {
      currentPassword: "nope",
      newPassword: "Another-Strong-Pass-2!",
    });
    assert.equal(badChange.status, 403);
    const change = await call(s, "POST", "/v1/partner/auth/change-password", {
      currentPassword: PASSWORD,
      newPassword: "Another-Strong-Pass-2!",
    });
    assert.equal(change.status, 200);
    assert.equal(
      (await call(s2, "GET", "/v1/seller/profile")).status,
      401,
      "other session revoked",
    );
    assert.equal((await call(s, "GET", "/v1/seller/profile")).status, 200, "this session kept");

    const account = (await (await call(s, "GET", "/v1/partner/account")).json()) as {
      security: { mfaEnabled: boolean; recoveryCodesLeft: number };
    };
    assert.equal(account.security.mfaEnabled, true);
    assert.equal(account.security.recoveryCodesLeft, 9);

    const out = await call(s, "POST", "/v1/partner/auth/logout-all");
    assert.equal(out.status, 200);
    assert.equal((await call(s, "GET", "/v1/seller/profile")).status, 401);
  });

  it("resets a forgotten password with a single-use link", async () => {
    const email = "reset@example.com";
    await signup(email, "Reset Co");
    const req = await fetch(`${base}/v1/partner/auth/password-reset/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const { devResetToken } = (await req.json()) as { devResetToken?: string };
    assert.ok(devResetToken, "dev token is returned when email is not configured");
    const confirm = (token: string) =>
      fetch(`${base}/v1/partner/auth/password-reset/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword: "Reset-Strong-Pass-3!" }),
      });
    assert.equal((await confirm(devResetToken!)).status, 200);
    assert.equal((await confirm(devResetToken!)).status, 400);
    assert.equal((await login(email)).status, 401);
    assert.equal((await login(email, {}, "Reset-Strong-Pass-3!")).status, 200);
  });

  it("serves and backfills checks saved before they carried a problems list", async () => {
    const s = await signup("legacy-check@example.com", "Legacy Check Co");
    const offer = await hostedOffer(s, "legacy-brief", "old");
    const legacy = {
      httpStatus: 402,
      paymentHeader: "x",
      bodyPreview: "",
      expectedPayTo: PAYOUT,
      expectedNetwork: "base-sepolia",
      expectedPriceUsdc: "0.05",
    };
    store.setOfferIntegration(offer.id, { lastChallengeJson: JSON.stringify(legacy) });

    const listed = (await (await call(s, "GET", "/v1/seller/offers")).json()) as {
      offers: { id: string; integration: { lastChallenge: { problems: unknown } } }[];
    };
    const view = listed.offers.find((o) => o.id === offer.id)!;
    assert.deepEqual(view.integration.lastChallenge.problems, []);

    reloadDbFromDisk();
    const stored = JSON.parse(store.getOfferIntegration(offer.id)!.lastChallengeJson!);
    assert.deepEqual(stored.problems, []);
    assert.equal(stored.expectedPayTo, PAYOUT, "the rest of the check is kept");
  });

  it("repoints hosted offers saved with a localhost URL at the public API base", async () => {
    const s = await signup("legacy-url@example.com", "Legacy Url Co");
    const offer = await hostedOffer(s, "legacy-url-brief", "old url");
    store.updateOffer(s.orgId, offer.id, {
      endpointUrl: `http://localhost:4000/v1/x402/offers/${offer.id}`,
    });
    reloadDbFromDisk();
    assert.equal(
      sellerStore.getOfferAnyOrg(offer.id)?.endpointUrl,
      `https://api.abi.test/v1/x402/offers/${offer.id}`,
    );
  });

  it("closes the account and takes every offer off sale", async () => {
    const s = await signup("close@example.com", "Close Co");
    const offer = await hostedOffer(s, "close-brief", "bye");
    const wrong = await call(s, "POST", "/v1/partner/account/close", {
      password: PASSWORD,
      confirm: "Wrong",
    });
    assert.equal(wrong.status, 400);
    const closed = await call(s, "POST", "/v1/partner/account/close", {
      password: PASSWORD,
      confirm: "Close Co",
    });
    assert.equal(closed.status, 200);
    assert.equal(sellerStore.getOfferAnyOrg(offer.id)?.status, "paused");
    assert.equal((await login("close@example.com")).status, 401);
  });
});
