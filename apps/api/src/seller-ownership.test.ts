/**
 * Seller endpoint ownership. Matching a 402's payTo proves nothing (the header is
 * public), so an offer on a seller's own server only owns its URL after the
 * seller serves an org-specific token at /.well-known/abi-seller-verification.
 * A non-owner's draft, pause or deny policy must never block ABI buyers.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { PaymentRequired } from "@x402/core/types";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";

const dir = mkdtempSync(join(tmpdir(), "abi-seller-ownership-"));
process.env.POLICYVAULT_DB = join(dir, "ownership.db");
process.env.ABI_KEY_PEPPER = "seller-ownership-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.ABI_ALLOW_UNVERIFIED_SIGNUP = "1";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";
process.env.ABI_ALLOW_LOCAL_TARGETS = "1";

const { store, sellerStore } = await import("./store.js");
const { app } = await import("./index.js");
const { sellerPrePayCheck } = await import("./seller-ingest.js");
const { ownershipToken } = await import("./seller-ownership.js");

/** The real seller's payee. It is public: every unpaid GET returns it. */
const PAY_TO = `0x${"22".repeat(20)}`;
const PASSWORD = "Seller-Ownership-Pass-1!";
const TX = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

/** Lines the real seller serves at its well-known path, per fixture path prefix. */
let wellKnown: string[] = [];
let paidRequests = 0;
let sellerBase = "";
const seller = createServer((req, res) => {
  if (req.url === "/.well-known/abi-seller-verification") {
    res.writeHead(200, { "content-type": "text/plain" }).end(`${wellKnown.join("\n")}\n`);
    return;
  }
  if (req.url !== "/report" && req.url !== "/third-party" && req.url !== "/moved") {
    res.writeHead(404).end();
    return;
  }
  const required: PaymentRequired = {
    x402Version: 2,
    resource: { url: `${sellerBase}${req.url}`, mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        amount: "10000",
        payTo: PAY_TO,
        maxTimeoutSeconds: 120,
        extra: { name: "USDC", version: "2" },
      },
    ],
  };
  if (!req.headers["payment-signature"]) {
    res.writeHead(402, {
      "content-type": "application/json",
      "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required),
    });
    res.end(JSON.stringify(required));
    return;
  }
  paidRequests += 1;
  res.writeHead(200, {
    "content-type": "application/json",
    "PAYMENT-RESPONSE": encodePaymentResponseHeader({
      success: true,
      payer: "0x1111111111111111111111111111111111111111",
      transaction: TX(paidRequests),
      network: "eip155:84532",
    }),
  });
  res.end(JSON.stringify({ report: "paid" }));
});

let api: ReturnType<typeof app.listen>;
let base = "";
before(async () => {
  await new Promise<void>((resolve) => seller.listen(0, "127.0.0.1", resolve));
  sellerBase = `http://127.0.0.1:${(seller.address() as AddressInfo).port}`;
  api = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => api.once("listening", resolve));
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});
after(async () => {
  await Promise.all([
    new Promise<void>((resolve) => seller.close(() => resolve())),
    new Promise<void>((resolve) => api.close(() => resolve())),
  ]);
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

type Ownership = {
  required: boolean;
  verified: boolean;
  origin: string | null;
  wellKnownUrl: string | null;
  record: string | null;
};
type OfferJson = { id: string; status: string; endpointUrl: string; ownership: Ownership };

async function createOffer(s: Session, slug: string, endpointUrl: string): Promise<OfferJson> {
  const pay = await call(s, "PATCH", "/v1/seller/profile", { payoutAddress: PAY_TO });
  assert.equal(pay.status, 200, await pay.clone().text());
  const res = await call(s, "POST", "/v1/seller/offers", {
    slug,
    title: `Offer ${slug}`,
    endpointUrl,
    priceUsdc: "0.01",
    category: "research",
  });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as { offer: OfferJson }).offer;
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
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
    body: JSON.stringify({ amountUsdc: "0.01", destination, idempotencyKey }),
  });
}

async function directoryIds(): Promise<string[]> {
  const res = await fetch(`${base}/v1/directory/offers`);
  assert.equal(res.status, 200);
  return ((await res.json()) as { offers: { id: string }[] }).offers.map((o) => o.id);
}

describe("seller endpoint ownership", () => {
  it("a non-owner cannot verify, pause, publish or gate someone else's x402 URL; buyers still pay", async () => {
    const url = () => `${sellerBase}/third-party`;
    wellKnown = []; // The real seller is not on ABI and serves no ABI token.
    const attacker = await signup("squatter-own@example.com", "Squatter");
    // The attacker copies the public payTo, so the 402 itself "matches".
    const squat = await createOffer(attacker, "squat", url());
    assert.equal(squat.status, "draft");
    assert.equal(squat.ownership.required, true);
    assert.equal(squat.ownership.verified, false);

    const verify = await call(attacker, "POST", `/v1/seller/offers/${squat.id}/verify`);
    assert.equal(verify.status, 422);
    const vBody = (await verify.json()) as {
      error: { code: string };
      offer: OfferJson;
      ownership: { record: string; wellKnownUrl: string };
    };
    assert.equal(vBody.error.code, "OWNERSHIP_UNPROVEN");
    assert.equal(vBody.offer.status, "draft");
    assert.equal(vBody.ownership.wellKnownUrl, `${sellerBase}/.well-known/abi-seller-verification`);

    const pause = await call(attacker, "PATCH", `/v1/seller/offers/${squat.id}`, {
      status: "paused",
    });
    assert.equal(pause.status, 400);
    assert.equal(await errorCode(pause), "NOT_VERIFIED");
    const publish = await call(attacker, "POST", `/v1/seller/offers/${squat.id}/publish`);
    assert.equal(publish.status, 400);

    // A row an older build verified on payTo alone owns nothing either.
    store.setOfferIntegration(squat.id, { lastVerifiedAt: new Date().toISOString() });
    store.updateOffer(attacker.orgId, squat.id, { status: "verified" });
    const legacyPause = await call(attacker, "PATCH", `/v1/seller/offers/${squat.id}`, {
      status: "paused",
    });
    assert.equal(legacyPause.status, 403);
    assert.equal(await errorCode(legacyPause), "OWNERSHIP_UNPROVEN");
    const legacyPublish = await call(attacker, "POST", `/v1/seller/offers/${squat.id}/publish`);
    assert.equal(legacyPublish.status, 400);
    assert.equal(await errorCode(legacyPublish), "OWNERSHIP_UNPROVEN");
    store.updateOffer(attacker.orgId, squat.id, { status: "paused" });
    const deny = await call(attacker, "POST", "/v1/seller/policies", {
      offerId: squat.id,
      effect: "deny",
      note: "blocked by squatter",
    });
    assert.equal(deny.status, 201, await deny.clone().text());

    assert.equal(sellerStore.resolveOfferForPay(url()), undefined);
    assert.equal(sellerStore.isVerifiedOwnerOffer(squat), false);
    assert.deepEqual(sellerStore.endpointClaims(url(), "org_nobody"), []);
    assert.ok(!(await directoryIds()).includes(squat.id));

    const { org, agent } = buyerFor(url(), "Third Party Buyer");
    assert.deepEqual(sellerPrePayCheck(url(), org.id, agent.agentId), { ok: true });
    const paid = await payApi(agent.apiKey, url(), "ownership-third-party-1");
    assert.equal(paid.status, 200, await paid.clone().text());
    assert.equal(sellerStore.listUsage(attacker.orgId, new Date(0).toISOString()).length, 0);
  });

  it("the owner proves the origin, publishes, pauses and edits their own endpoint", async () => {
    const url = `${sellerBase}/report`;
    wellKnown = [];
    const owner = await signup("owner-own@example.com", "Owner Co");
    const offer = await createOffer(owner, "owner-report", url);
    assert.equal(offer.ownership.origin, sellerBase);
    assert.equal(
      offer.ownership.record,
      `abi-seller-verification=${ownershipToken(owner.orgId, sellerBase)}`,
    );
    const snippet = (await (
      await call(owner, "GET", `/v1/seller/offers/${offer.id}/snippet`)
    ).json()) as { snippets: Record<string, string> };
    for (const stack of ["express", "hono", "next"]) {
      assert.ok(snippet.snippets[stack].includes(offer.ownership.record!), stack);
    }
    const first = await call(owner, "POST", `/v1/seller/offers/${offer.id}/verify`);
    assert.equal(first.status, 422);
    assert.equal(await errorCode(first), "OWNERSHIP_UNPROVEN");

    // The owner serves its record, alongside an unrelated org's line.
    wellKnown = ["abi-seller-verification=0000000000000000", offer.ownership.record!];
    const verify = await call(owner, "POST", `/v1/seller/offers/${offer.id}/verify`);
    assert.equal(verify.status, 200, await verify.clone().text());
    const verified = ((await verify.json()) as { offer: OfferJson }).offer;
    assert.equal(verified.status, "verified");
    assert.equal(verified.ownership.verified, true);
    const pub = await call(owner, "POST", `/v1/seller/offers/${offer.id}/publish`);
    assert.equal(pub.status, 200, await pub.clone().text());
    assert.ok((await directoryIds()).includes(offer.id));
    assert.equal(sellerStore.resolveOfferForPay(url)?.id, offer.id);

    // A squatter on the same origin cannot reuse the owner's record: tokens are per org.
    const squatter = await signup("squatter-two@example.com", "Squatter Two");
    assert.notEqual(
      ownershipToken(squatter.orgId, sellerBase),
      ownershipToken(owner.orgId, sellerBase),
    );
    const squat = await createOffer(squatter, "squat-report", url);
    assert.equal(
      (await call(squatter, "POST", `/v1/seller/offers/${squat.id}/verify`)).status,
      422,
    );
    assert.equal(sellerStore.resolveOfferForPay(url)?.id, offer.id);

    const { agent } = buyerFor(url, "Owner Buyer");
    const paid = await payApi(agent.apiKey, url, "ownership-owner-1");
    assert.equal(paid.status, 200, await paid.clone().text());
    const usage = sellerStore.listUsage(owner.orgId, new Date(0).toISOString());
    assert.equal(usage.filter((u) => u.mode === "paid").length, 1);

    // The verified owner's pause does gate buyers: that is the owner's right.
    const pause = await call(owner, "PATCH", `/v1/seller/offers/${offer.id}`, { status: "paused" });
    assert.equal(pause.status, 200, await pause.clone().text());
    const refused = await payApi(agent.apiKey, url, "ownership-owner-2");
    assert.equal(refused.status, 409, await refused.clone().text());
    assert.equal(await errorCode(refused), "OFFER_PAUSED");
    const resumed = await call(owner, "POST", `/v1/seller/offers/${offer.id}/publish`);
    assert.equal(resumed.status, 200);

    // Editing price sends it back to draft until verified again.
    const edit = await call(owner, "PATCH", `/v1/seller/offers/${offer.id}`, { priceUsdc: "0.02" });
    assert.equal(((await edit.json()) as { offer: OfferJson }).offer.status, "draft");
    assert.equal(sellerStore.resolveOfferForPay(url), undefined);
    await call(owner, "PATCH", `/v1/seller/offers/${offer.id}`, { priceUsdc: "0.01" });
    assert.equal((await call(owner, "POST", `/v1/seller/offers/${offer.id}/verify`)).status, 200);
    assert.equal((await call(owner, "POST", `/v1/seller/offers/${offer.id}/publish`)).status, 200);

    // Moving the endpoint drops the origin proof with it.
    const moved = await call(owner, "PATCH", `/v1/seller/offers/${offer.id}`, {
      endpointUrl: "https://elsewhere.example/report",
    });
    const movedOffer = ((await moved.json()) as { offer: OfferJson }).offer;
    assert.equal(movedOffer.status, "draft");
    assert.equal(movedOffer.ownership.verified, false);
    assert.equal(movedOffer.ownership.origin, "https://elsewhere.example");
    assert.equal(store.getOfferIntegration(offer.id)?.ownershipVerifiedAt, undefined);
  });

  it("never lets one seller org read or manage another org's offers", async () => {
    wellKnown = [];
    const a = await signup("cross-a@example.com", "Cross A");
    const b = await signup("cross-b@example.com", "Cross B");
    const offer = await createOffer(a, "cross-a", `${sellerBase}/moved`);
    const attempts: [string, string, unknown?][] = [
      ["PATCH", `/v1/seller/offers/${offer.id}`, { status: "paused" }],
      ["PATCH", `/v1/seller/offers/${offer.id}`, { title: "Hijacked" }],
      ["POST", `/v1/seller/offers/${offer.id}/verify`],
      ["POST", `/v1/seller/offers/${offer.id}/publish`],
      ["POST", `/v1/seller/offers/${offer.id}/archive`],
      ["GET", `/v1/seller/offers/${offer.id}/snippet`],
      ["POST", `/v1/seller/offers/${offer.id}/versions`, { slug: "stolen-v2" }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await call(b, method, path, body);
      assert.equal(res.status, 404, `${method} ${path} -> ${res.status}`);
    }
    const policy = await call(b, "POST", "/v1/seller/policies", {
      offerId: offer.id,
      effect: "deny",
    });
    assert.equal(policy.status, 404);
    const list = (await (await call(b, "GET", "/v1/seller/offers?archived=1")).json()) as {
      offers: OfferJson[];
    };
    assert.deepEqual(list.offers, []);
    const mine = store.getOffer(a.orgId, offer.id)!;
    assert.equal(mine.title, "Offer cross-a");
    assert.equal(mine.status, "draft");
    assert.equal(mine.archivedAt, undefined);
  });
});
