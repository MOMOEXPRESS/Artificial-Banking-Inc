import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "abi-seller-features-"));
process.env.POLICYVAULT_DB = join(dir, "seller-features.db");
process.env.ABI_KEY_PEPPER = "seller-features-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.ABI_ALLOW_UNVERIFIED_SIGNUP = "1";

const { store, sellerStore } = await import("./store.js");
const { app } = await import("./index.js");
const { ingestSellerPayment, evaluateSellerAccess } = await import("./seller-ingest.js");
let server: ReturnType<typeof app.listen>;
let base: string;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

const PAYOUT = "0x1111111111111111111111111111111111111111";
type Session = { cookies: string; csrf: string; orgId: string };
type OfferJson = {
  id: string;
  slug: string;
  version: string;
  status: string;
  directoryListed: boolean;
  sandboxEnabled: boolean;
  sunsetAt: string | null;
  successorOfferId: string | null;
};

async function signup(email: string, companyName: string): Promise<Session> {
  const res = await fetch(`${base}/v1/partner/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      name: "Seller",
      password: "Seller-Features-Pass-1!",
      companyName,
      website: "https://seller.example",
    }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const csrf = cookies
    .split("; ")
    .find((c) => c.startsWith("abi_partner_csrf="))!
    .slice("abi_partner_csrf=".length);
  const body = (await res.json()) as { org: { id: string } };
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

async function publishedOffer(s: Session, slug: string, endpointUrl: string): Promise<OfferJson> {
  await call(s, "PATCH", "/v1/seller/profile", { payoutAddress: PAYOUT });
  const res = await call(s, "POST", "/v1/seller/offers", {
    slug,
    title: `Offer ${slug}`,
    endpointUrl,
    priceUsdc: "0.25",
  });
  assert.equal(res.status, 201, await res.clone().text());
  const { offer } = (await res.json()) as { offer: OfferJson };
  store.updateOffer(s.orgId, offer.id, { status: "verified" });
  // What a passing verify leaves behind: challenge checked, origin proven.
  store.setOfferIntegration(offer.id, {
    lastVerifiedAt: new Date().toISOString(),
    ownershipVerifiedAt: new Date().toISOString(),
    ownershipOrigin: new URL(endpointUrl).origin,
  });
  const pub = await call(s, "POST", `/v1/seller/offers/${offer.id}/publish`);
  assert.equal(pub.status, 200, await pub.clone().text());
  return ((await pub.json()) as { offer: OfferJson }).offer;
}

async function directoryIds(): Promise<string[]> {
  const res = await fetch(`${base}/v1/directory/offers`);
  assert.equal(res.status, 200);
  return ((await res.json()) as { offers: { id: string }[] }).offers.map((o) => o.id);
}

describe("seller features", () => {
  it("lists published offers in the directory by default and hides them on opt-out", async () => {
    const s = await signup("dir@example.com", "Directory Co");
    const offer = await publishedOffer(s, "dir-weather", "https://dir.example/weather");
    assert.equal(offer.directoryListed, true);
    assert.equal(offer.sandboxEnabled, true);
    assert.equal(offer.version, "v1");
    assert.ok((await directoryIds()).includes(offer.id));

    const optOut = await call(s, "PATCH", `/v1/seller/offers/${offer.id}`, {
      directoryListed: false,
    });
    assert.equal(optOut.status, 200);
    assert.equal(((await optOut.json()) as { offer: OfferJson }).offer.directoryListed, false);
    assert.ok(!(await directoryIds()).includes(offer.id));

    await call(s, "PATCH", `/v1/seller/offers/${offer.id}`, { directoryListed: true });
    assert.ok((await directoryIds()).includes(offer.id));

    const draft = await call(s, "POST", "/v1/seller/offers", {
      slug: "dir-draft",
      title: "Draft",
      endpointUrl: "https://dir.example/draft",
      priceUsdc: "1",
    });
    const draftId = ((await draft.json()) as { offer: OfferJson }).offer.id;
    assert.ok(!(await directoryIds()).includes(draftId), "drafts never list");
  });

  it("ingests buyer pays into settlements, analytics, webhooks, and threshold alerts", async () => {
    const s = await signup("usage@example.com", "Usage Co");
    const offer = await publishedOffer(s, "usage-quotes", "https://usage.example/quotes");
    const hook = await call(s, "POST", "/v1/seller/webhooks", { url: "abi://demo-inbox" });
    assert.equal(hook.status, 201);
    assert.match(((await hook.json()) as { secret: string }).secret, /^pv_whsec_/);
    const alert = await call(s, "POST", "/v1/seller/alerts", {
      offerId: offer.id,
      thresholdCalls: 2,
    });
    assert.equal(alert.status, 201);

    for (const [i, agentId] of ["agent_a", "agent_a", "agent_b"].entries()) {
      const matched = ingestSellerPayment({
        destination: "https://usage.example/quotes/",
        amountMicro: 250_000n,
        buyerOrgId: "org_buyer_1",
        agentId,
        txHash: `0xabc${i}`,
      });
      assert.equal(matched, 1);
    }
    ingestSellerPayment({
      destination: "https://usage.example/quotes",
      amountMicro: 250_000n,
      buyerOrgId: "org_buyer_1",
      agentId: "agent_b",
      txHash: "0xabc2",
    });

    const analytics = await call(s, "GET", "/v1/seller/analytics?days=7");
    assert.equal(analytics.status, 200);
    const a = (await analytics.json()) as {
      totals: { paidCalls: number; revenueUsdc: string; uniqueBuyers: number };
      offers: {
        offerId: string;
        calls: { paid: number };
        topAgents: { id: string; calls: number }[];
      }[];
    };
    assert.equal(a.totals.paidCalls, 3);
    assert.equal(a.totals.revenueUsdc, "0.75");
    assert.equal(a.totals.uniqueBuyers, 1);
    const row = a.offers.find((o) => o.offerId === offer.id)!;
    assert.equal(row.calls.paid, 3);
    assert.deepEqual(row.topAgents[0], { id: "agent_a", calls: 2 });

    const events = store.listDeliveries(s.orgId).map((d) => d.event);
    assert.equal(events.filter((e) => e === "seller.payment.received").length, 3);
    assert.equal(
      events.filter((e) => e === "seller.usage.threshold").length,
      1,
      "fires once per day",
    );

    const payouts = (await (await call(s, "GET", "/v1/seller/payouts")).json()) as {
      settledUsdc: string;
      settlementCount: number;
      payoutAddress: string;
    };
    assert.equal(payouts.settledUsdc, "0.75");
    assert.equal(payouts.settlementCount, 3);
    assert.equal(payouts.payoutAddress, PAYOUT);
  });

  it("generates idempotent invoices per period", async () => {
    const s = await signup("invoice@example.com", "Invoice Co");
    await publishedOffer(s, "inv-data", "https://invoice.example/data");
    ingestSellerPayment({
      destination: "https://invoice.example/data",
      amountMicro: 1_000_000n,
      buyerOrgId: "org_buyer_2",
    });
    const window = {
      periodStart: new Date(Date.now() - 86_400_000).toISOString(),
      periodEnd: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const first = await call(s, "POST", "/v1/seller/invoices/generate", window);
    assert.equal(first.status, 201);
    const inv = (await first.json()) as {
      created: boolean;
      invoice: { id: string; totalUsdc: string };
    };
    assert.equal(inv.invoice.totalUsdc, "1");
    const again = await call(s, "POST", "/v1/seller/invoices/generate", window);
    assert.equal(again.status, 200);
    const inv2 = (await again.json()) as { created: boolean; invoice: { id: string } };
    assert.equal(inv2.created, false);
    assert.equal(inv2.invoice.id, inv.invoice.id);
    const list = (await (await call(s, "GET", "/v1/seller/invoices")).json()) as {
      invoices: unknown[];
    };
    assert.equal(list.invoices.length, 1);
  });

  it("enforces per-buyer deny and per-agent rate limits", async () => {
    const s = await signup("policy@example.com", "Policy Co");
    const offer = await publishedOffer(s, "pol-api", "https://policy.example/api");
    const okOrg = store.createOrg("Policy Buyer OK", 0n);
    const fast = store.createAgent(okOrg.id, "Fast agent");
    const blockedOrg = store.createOrg("Policy Buyer Blocked", 0n);
    const blockedAgent = store.createAgent(blockedOrg.id, "Blocked agent");
    const bad = await call(s, "POST", "/v1/seller/policies", { effect: "allow" });
    assert.equal(bad.status, 400, "allow without a rate or a named buyer is rejected");
    const deny = await call(s, "POST", "/v1/seller/policies", {
      buyerOrgId: blockedOrg.id,
      effect: "deny",
    });
    assert.equal(deny.status, 201);
    await call(s, "POST", "/v1/seller/policies", {
      offerId: offer.id,
      agentId: fast.agentId,
      ratePerMinute: 2,
    });

    const row = sellerStore.getOfferAnyOrg(offer.id)!;
    assert.equal(evaluateSellerAccess(row, blockedOrg.id, "agent_x").allowed, false);
    assert.equal(evaluateSellerAccess(row, okOrg.id, fast.agentId).allowed, true);

    const tryAs = (key?: string, body?: unknown) =>
      fetch(`${base}/v1/sandbox/offers/${offer.id}/try`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(body ?? {}),
      });
    for (let i = 0; i < 4; i += 1) {
      assert.equal((await tryAs(fast.apiKey)).status, 200, "sandbox tries spend no paid budget");
    }
    assert.equal(evaluateSellerAccess(row, okOrg.id, fast.agentId).allowed, true);
    for (let i = 0; i < 2; i += 1) {
      sellerStore.recordUsage({
        sellerOrgId: s.orgId,
        offerId: offer.id,
        buyerOrgId: okOrg.id,
        agentId: fast.agentId,
        mode: "paid",
      });
    }
    assert.equal(
      (await tryAs(fast.apiKey)).status,
      429,
      "the sandbox still shows a limit real purchases hit",
    );
    assert.equal((await tryAs(blockedAgent.apiKey)).status, 403);
    assert.equal(
      (await tryAs(undefined, { buyerOrgId: blockedOrg.id })).status,
      200,
      "self-declared ids in the body are ignored",
    );

    const policies = (await (await call(s, "GET", "/v1/seller/policies")).json()) as {
      policies: { id: string }[];
    };
    assert.equal(policies.policies.length, 2);
    const del = await call(s, "DELETE", `/v1/seller/policies/${policies.policies[0].id}`);
    assert.equal(del.status, 200);
    assert.equal(evaluateSellerAccess(row, blockedOrg.id, "agent_x").allowed, true);
  });

  it("serves a simulated sandbox that can be turned off", async () => {
    const s = await signup("sandbox@example.com", "Sandbox Co");
    const offer = await publishedOffer(s, "sbx-api", "https://sandbox.example/api");
    const t = await fetch(`${base}/v1/sandbox/offers/${offer.id}/try`, { method: "POST" });
    assert.equal(t.status, 200);
    const body = (await t.json()) as {
      sandbox: boolean;
      challenge: { httpStatus: number; payTo: string; priceUsdc: string };
      unlock: { simulated: boolean };
    };
    assert.equal(body.sandbox, true);
    assert.equal(body.challenge.httpStatus, 402);
    assert.equal(body.challenge.payTo, PAYOUT);
    assert.equal(body.challenge.priceUsdc, "0.25");
    assert.equal(body.unlock.simulated, true);
    assert.equal(sellerStore.payoutSummary(s.orgId).count, 0, "sandbox moves no money");

    await call(s, "PATCH", `/v1/seller/offers/${offer.id}`, { sandboxEnabled: false });
    const off = await fetch(`${base}/v1/sandbox/offers/${offer.id}/try`, { method: "POST" });
    assert.equal(off.status, 403);
    const missing = await fetch(`${base}/v1/sandbox/offers/offer_nope/try`, { method: "POST" });
    assert.equal(missing.status, 404);
  });

  it("caps sandbox tries per address without touching paid limits", async () => {
    const s = await signup("sandbox-flood@example.com", "Sandbox Flood Co");
    const offer = await publishedOffer(s, "sbx-flood", "https://flood.example/api");
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      statuses.push(
        (await fetch(`${base}/v1/sandbox/offers/${offer.id}/try`, { method: "POST" })).status,
      );
    }
    assert.deepEqual(statuses.slice(0, 20), new Array(20).fill(200));
    assert.equal(statuses[20], 429);
  });

  it("versions offers and deprecates with notice and a successor", async () => {
    const s = await signup("version@example.com", "Version Co");
    await call(s, "POST", "/v1/seller/webhooks", { url: "abi://demo-inbox" });
    const v1 = await publishedOffer(s, "ver-api", "https://version.example/v1");
    const v2res = await call(s, "POST", `/v1/seller/offers/${v1.id}/versions`, {
      slug: "ver-api-v2",
      endpointUrl: "https://version.example/v2",
    });
    assert.equal(v2res.status, 201, await v2res.clone().text());
    const v2 = ((await v2res.json()) as { offer: { id: string; version: string; status: string } })
      .offer;
    assert.equal(v2.version, "v2");
    assert.equal(v2.status, "draft");

    const tooSoon = await call(s, "POST", `/v1/seller/offers/${v1.id}/deprecate`, {
      sunsetAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    assert.equal(tooSoon.status, 400);

    const sunsetAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const dep = await call(s, "POST", `/v1/seller/offers/${v1.id}/deprecate`, {
      sunsetAt,
      successorOfferId: v2.id,
    });
    assert.equal(dep.status, 200);
    const depBody = (await dep.json()) as {
      offer: { sunsetAt: string; successorOfferId: string; deprecatedAt: string };
    };
    assert.equal(depBody.offer.successorOfferId, v2.id);
    assert.ok(depBody.offer.deprecatedAt);

    const dirRes = await fetch(`${base}/v1/directory/offers`);
    const listed = (
      (await dirRes.json()) as {
        offers: { id: string; sunsetAt: string | null; successorOfferId: string | null }[];
      }
    ).offers.find((o) => o.id === v1.id);
    assert.ok(listed, "deprecated offers stay listed until sunset");
    assert.equal(listed!.successorOfferId, v2.id);

    sellerStore.deprecateOffer({
      sellerOrgId: s.orgId,
      offerId: v1.id,
      sunsetAt: new Date(Date.now() - 1000).toISOString(),
    });
    assert.ok(!(await directoryIds()).includes(v1.id), "past sunset drops out of the directory");

    const events = store.listDeliveries(s.orgId).map((d) => d.event);
    assert.ok(events.includes("seller.offer.deprecated"));
  });

  it("requires a partner session for seller feature routes", async () => {
    for (const path of [
      "/v1/seller/analytics",
      "/v1/seller/policies",
      "/v1/seller/invoices",
      "/v1/seller/webhooks",
    ]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 401, path);
    }
  });
});
