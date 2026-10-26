import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { hashPassword } from "./auth/password.js";

const dir = mkdtempSync(join(tmpdir(), "abi-seller-phase0-"));
process.env.POLICYVAULT_DB = join(dir, "seller.db");
process.env.ABI_KEY_PEPPER = "seller-test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.ABI_ALLOW_UNVERIFIED_SIGNUP = "1";

const { store } = await import("./store.js");
const { app } = await import("./index.js");
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

const PASSWORD = "Seller-Test-Pass-1!";

function cookieHeader(res: Response): string {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

function cookieValue(cookies: string, name: string): string | undefined {
  return cookies
    .split("; ")
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

type PartnerSession = { cookies: string; csrf: string; orgId: string };
type SignupBody = { partner: { email: string }; org: { id: string; name: string; kind: string } };

async function partnerSignup(
  email: string,
  extra: Record<string, string> = {},
): Promise<PartnerSession & { body: SignupBody }> {
  const res = await fetch(`${base}/v1/partner/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      name: "Partner Tester",
      password: PASSWORD,
      companyName: "Seller Desk",
      website: "https://seller.example",
      description: "Gets paid by agents",
      ...extra,
    }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  const cookies = cookieHeader(res);
  const csrf = cookieValue(cookies, "abi_partner_csrf");
  assert.ok(csrf);
  assert.ok(cookieValue(cookies, "abi_partner_session"));
  assert.equal(cookieValue(cookies, "abi_session"), undefined);
  const body = (await res.json()) as SignupBody;
  return { cookies, csrf: csrf!, orgId: body.org.id, body };
}

function partnerHeaders(s: PartnerSession, mutate = false): Record<string, string> {
  return mutate
    ? { cookie: s.cookies, "x-abi-csrf": s.csrf, "content-type": "application/json" }
    : { cookie: s.cookies };
}

describe("seller partnership — separate partner accounts", () => {
  it("partner sign-up creates the seller org from company details", async () => {
    const s = await partnerSignup("partner-signup@example.com");
    assert.equal(s.body.org.kind, "seller");
    assert.equal(s.body.org.name, "Seller Desk");
    assert.equal(store.getOrg(s.orgId)?.kind, "seller");

    const profile = await fetch(`${base}/v1/seller/profile`, { headers: partnerHeaders(s) });
    assert.equal(profile.status, 200);
    const p = (await profile.json()) as { profile: Record<string, string> };
    assert.equal(p.profile.displayName, "Seller Desk");
    assert.equal(p.profile.website, "https://seller.example");
    assert.equal(p.profile.status, "draft");

    const me = await fetch(`${base}/v1/partner/auth/me`, { headers: partnerHeaders(s) });
    assert.equal(me.status, 200);
    const meBody = (await me.json()) as { partner: { email: string }; org: { id: string } };
    assert.equal(meBody.partner.email, "partner-signup@example.com");
    assert.equal(meBody.org.id, s.orgId);

    const dup = await fetch(`${base}/v1/partner/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "partner-signup@example.com",
        name: "Again",
        password: PASSWORD,
        companyName: "Other",
      }),
    });
    assert.equal(dup.status, 409);
  });

  it("verifies partner email before sign-in when unverified sign-up is off", async () => {
    process.env.ABI_ALLOW_UNVERIFIED_SIGNUP = "0";
    try {
      const email = "partner-verify@example.com";
      const res = await fetch(`${base}/v1/partner/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          name: "Verify Me",
          password: PASSWORD,
          companyName: "Verify Co",
        }),
      });
      assert.equal(res.status, 201);
      assert.equal(cookieValue(cookieHeader(res), "abi_partner_session"), undefined);
      const body = (await res.json()) as {
        verificationRequired: boolean;
        devVerificationToken?: string;
        org: { kind: string };
      };
      assert.equal(body.verificationRequired, true);
      assert.equal(body.org.kind, "seller");
      assert.ok(body.devVerificationToken);

      const early = await fetch(`${base}/v1/partner/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD }),
      });
      assert.equal(early.status, 403);
      assert.equal(
        ((await early.json()) as { error: { code: string } }).error.code,
        "EMAIL_NOT_VERIFIED",
      );

      const verify = await fetch(`${base}/v1/partner/auth/email/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: body.devVerificationToken }),
      });
      assert.equal(verify.status, 200);
      const cookies = cookieHeader(verify);
      assert.ok(cookieValue(cookies, "abi_partner_session"));
      const profile = await fetch(`${base}/v1/seller/profile`, { headers: { cookie: cookies } });
      assert.equal(profile.status, 200);

      const reuse = await fetch(`${base}/v1/partner/auth/email/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: body.devVerificationToken }),
      });
      assert.equal(reuse.status, 400);

      const login = await fetch(`${base}/v1/partner/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD }),
      });
      assert.equal(login.status, 200);
    } finally {
      process.env.ABI_ALLOW_UNVERIFIED_SIGNUP = "1";
    }
  });

  it("partner and buyer accounts are separate realms, even with the same email", async () => {
    const email = "same-person@example.com";
    const buyer = store.createAccountWithOrg({
      email,
      name: "Buyer Person",
      orgName: "Buyer Desk",
      passwordHash: await hashPassword("Buyer-Only-Pass-9!"),
      verificationToken: "verify-same",
      verificationTtlMs: 60_000,
      markEmailVerified: true,
      ledgerMode: "sandbox",
    });
    assert.equal(buyer.status, "created");

    const s = await partnerSignup(email, { companyName: "Same Person Seller" });

    // Buyer password does not open the partner realm, and vice versa.
    const wrong = await fetch(`${base}/v1/partner/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "Buyer-Only-Pass-9!" }),
    });
    assert.equal(wrong.status, 401);
    const buyerWithPartnerPw = await fetch(`${base}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    assert.equal(buyerWithPartnerPw.status, 401);

    // A partner session is not a buyer session.
    const buyerMe = await fetch(`${base}/v1/auth/me`, { headers: partnerHeaders(s) });
    assert.equal(buyerMe.status, 401);

    // A buyer session cannot reach seller APIs, and its orgs list has no seller org.
    const buyerLogin = await fetch(`${base}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "Buyer-Only-Pass-9!" }),
    });
    assert.equal(buyerLogin.status, 200);
    const buyerBody = (await buyerLogin.json()) as { orgs: { kind: string }[] };
    assert.ok(buyerBody.orgs.every((o) => o.kind === "buyer"));
    const buyerCookies = cookieHeader(buyerLogin);
    const sellerAsBuyer = await fetch(`${base}/v1/seller/profile`, {
      headers: { cookie: buyerCookies },
    });
    assert.equal(sellerAsBuyer.status, 401);

    const login = await fetch(`${base}/v1/partner/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    assert.equal(login.status, 200);
    const loginBody = (await login.json()) as { org: { id: string; name: string } };
    assert.equal(loginBody.org.id, s.orgId);
    assert.equal(loginBody.org.name, "Same Person Seller");
  });

  it("seller APIs require a partner session and CSRF on mutations", async () => {
    const anon = await fetch(`${base}/v1/seller/profile`);
    assert.equal(anon.status, 401);

    const s = await partnerSignup("partner-csrf@example.com");
    const noCsrf = await fetch(`${base}/v1/seller/profile`, {
      method: "PATCH",
      headers: { cookie: s.cookies, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Nope" }),
    });
    assert.equal(noCsrf.status, 403);

    const logout = await fetch(`${base}/v1/partner/auth/logout`, {
      method: "POST",
      headers: partnerHeaders(s, true),
    });
    assert.equal(logout.status, 200);
    const after = await fetch(`${base}/v1/seller/profile`, { headers: partnerHeaders(s) });
    assert.equal(after.status, 401);
  });

  it("serves the buyer directory publicly (empty until an offer is published)", async () => {
    const res = await fetch(`${base}/v1/directory/offers`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { offers: unknown[] };
    assert.deepEqual(body.offers, []);
  });

  it("supports profile, catalog offers, snippet, publish gate, and activity", async () => {
    const s = await partnerSignup("partner-catalog@example.com", { companyName: "Catalog Seller" });

    const patched = await fetch(`${base}/v1/seller/profile`, {
      method: "PATCH",
      headers: partnerHeaders(s, true),
      body: JSON.stringify({
        displayName: "Catalog Seller Live",
        payoutAddress: "0x0000000000000000000000000000000000000001",
      }),
    });
    assert.equal(patched.status, 200);
    const patchedBody = (await patched.json()) as { profile: { status: string } };
    assert.equal(patchedBody.profile.status, "ready");
    assert.equal(store.getOrg(s.orgId)?.name, "Catalog Seller Live");

    const created = await fetch(`${base}/v1/seller/offers`, {
      method: "POST",
      headers: partnerHeaders(s, true),
      body: JSON.stringify({
        slug: "market-report",
        title: "Market report",
        endpointUrl: "https://seller.example/report",
        priceUsdc: "0.25",
        network: "base-sepolia",
      }),
    });
    assert.equal(created.status, 201);
    const offerBody = (await created.json()) as {
      offer: { id: string; status: string; priceUsdc: string };
    };
    assert.equal(offerBody.offer.status, "draft");
    assert.equal(offerBody.offer.priceUsdc, "0.25");

    const snippet = await fetch(`${base}/v1/seller/offers/${offerBody.offer.id}/snippet`, {
      headers: partnerHeaders(s),
    });
    assert.equal(snippet.status, 200);
    const snippetBody = (await snippet.json()) as { snippet: string; version: string };
    assert.equal(snippetBody.version, "v0");
    assert.match(snippetBody.snippet, /paymentMiddleware|x402/i);

    const publishTooSoon = await fetch(`${base}/v1/seller/offers/${offerBody.offer.id}/publish`, {
      method: "POST",
      headers: partnerHeaders(s, true),
      body: "{}",
    });
    assert.equal(publishTooSoon.status, 400);

    const activity = await fetch(`${base}/v1/seller/activity`, { headers: partnerHeaders(s) });
    assert.equal(activity.status, 200);
    const activityBody = (await activity.json()) as { settlements: unknown[] };
    assert.deepEqual(activityBody.settlements, []);
  });

  it("refuses seller workspace on a buyer org via organization-profile", async () => {
    const org = store.createOrg("Workspace Gate Co", 0n);
    assert.equal(org.kind, "buyer");
    const res = await fetch(`${base}/v1/guardian/organization-profile`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${org.guardianKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Workspace Gate Co", workspace: "seller" }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "SELLER_ORG_REQUIRED");
  });
});
