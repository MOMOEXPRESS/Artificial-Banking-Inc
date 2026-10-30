/**
 * GET /v1/directory/offers lists exactly the offers a buyer can pay a verified
 * owner for, and each seller offer says why it is (or is not) live.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "abi-directory-live-"));
process.env.POLICYVAULT_DB = join(dir, "directory.db");
process.env.ABI_KEY_PEPPER = "directory-live-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.ABI_ALLOW_UNVERIFIED_SIGNUP = "1";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";
process.env.ABI_PUBLIC_API_URL = "https://api.abi.test";

const { store } = await import("./store.js");
const { app } = await import("./index.js");

const PAYOUT = "0x2222222222222222222222222222222222222222";
const PASSWORD = "Directory-Live-Pass-1!";

let api: ReturnType<typeof app.listen>;
let base = "";
before(async () => {
  api = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => api.once("listening", resolve));
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});
after(() => {
  api?.close();
  rmSync(dir, { recursive: true, force: true });
});

type Session = { cookies: string; csrf: string; orgId: string };
type Listing = { live: boolean; blockers: { code: string }[] };
type OfferJson = { id: string; status: string; listing: Listing };
type DirectoryOffer = { id: string; title: string; payTo: string; seller: { name: string } };

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

async function offerJson(res: Response): Promise<OfferJson> {
  assert.ok(res.ok, await res.clone().text());
  return ((await res.json()) as { offer: OfferJson }).offer;
}

async function directory(query = ""): Promise<DirectoryOffer[]> {
  const res = await fetch(`${base}/v1/directory/offers${query}`);
  assert.equal(res.status, 200);
  return ((await res.json()) as { offers: DirectoryOffer[] }).offers;
}

const codes = (o: OfferJson) => o.listing.blockers.map((b) => b.code);

describe("directory: live offers publish", () => {
  it("walks a hosted offer from draft to live and back out of the directory", async () => {
    const s = await signup("live-hosted@example.com", "Live Hosted Co");
    const created = await offerJson(
      await call(s, "POST", "/v1/seller/offers", {
        slug: "fx-brief",
        title: "Daily FX brief",
        hosted: true,
        priceUsdc: "0.05",
        category: "finance",
        description: "EUR/USD levels",
        hostedContent: '{"brief":"EUR/USD 1.08"}',
      }),
    );
    assert.equal(created.listing.live, false);
    assert.deepEqual(codes(created), ["PAYOUT_MISSING", "NOT_VERIFIED", "NOT_PUBLISHED"]);

    // Verify refuses until there is a payout wallet; publish refuses until verified.
    assert.equal((await call(s, "POST", `/v1/seller/offers/${created.id}/verify`)).status, 422);
    assert.equal((await call(s, "POST", `/v1/seller/offers/${created.id}/publish`)).status, 400);
    await call(s, "PATCH", "/v1/seller/profile", { payoutAddress: PAYOUT });
    const verified = await offerJson(
      await call(s, "POST", `/v1/seller/offers/${created.id}/verify`),
    );
    assert.equal(verified.status, "verified");
    assert.deepEqual(codes(verified), ["NOT_PUBLISHED"]);
    assert.equal((await directory()).length, 0);

    const live = await offerJson(await call(s, "POST", `/v1/seller/offers/${created.id}/publish`));
    assert.equal(live.status, "published");
    assert.deepEqual(live.listing, { live: true, blockers: [] });
    const listed = await directory();
    assert.deepEqual(
      listed.map((o) => [o.id, o.payTo, o.seller.name]),
      [[created.id, PAYOUT, "Live Hosted Co"]],
    );
    assert.equal((await directory("?category=finance&q=fx")).length, 1);
    assert.equal((await directory("?category=media")).length, 0);
    assert.equal((await directory("?network=base")).length, 0);

    const hidden = await offerJson(
      await call(s, "PATCH", `/v1/seller/offers/${created.id}`, { directoryListed: false }),
    );
    assert.deepEqual(codes(hidden), ["HIDDEN"]);
    assert.equal((await directory()).length, 0);
    await call(s, "PATCH", `/v1/seller/offers/${created.id}`, { directoryListed: true });

    const paused = await offerJson(
      await call(s, "PATCH", `/v1/seller/offers/${created.id}`, { status: "paused" }),
    );
    assert.deepEqual(codes(paused), ["PAUSED"]);
    assert.equal((await directory()).length, 0);
    await call(s, "POST", `/v1/seller/offers/${created.id}/publish`);

    const repriced = await offerJson(
      await call(s, "PATCH", `/v1/seller/offers/${created.id}`, { priceUsdc: "0.07" }),
    );
    assert.equal(repriced.status, "draft");
    assert.deepEqual(codes(repriced), ["NOT_VERIFIED", "NOT_PUBLISHED"]);
    assert.equal((await directory()).length, 0);
    await call(s, "POST", `/v1/seller/offers/${created.id}/verify`);
    await call(s, "POST", `/v1/seller/offers/${created.id}/publish`);
    assert.equal((await directory())[0]?.id, created.id);

    await call(s, "POST", `/v1/seller/offers/${created.id}/archive`);
    assert.equal((await directory()).length, 0);
  });

  it("never lists an own-server offer whose seller has not proven the origin", async () => {
    const s = await signup("unproven@example.com", "Unproven Co");
    await call(s, "PATCH", "/v1/seller/profile", { payoutAddress: PAYOUT });
    const created = await offerJson(
      await call(s, "POST", "/v1/seller/offers", {
        slug: "byo",
        title: "BYO report",
        endpointUrl: "https://byo.example/report",
        priceUsdc: "0.01",
      }),
    );
    assert.ok(codes(created).includes("OWNERSHIP_UNPROVEN"));
    // A row an older build published on payTo alone stays out of the directory.
    store.setOfferIntegration(created.id, { lastVerifiedAt: new Date().toISOString() });
    store.updateOffer(s.orgId, created.id, { status: "published" });
    assert.ok(!(await directory()).some((o) => o.id === created.id));
    const view = await offerJson(await call(s, "PATCH", `/v1/seller/offers/${created.id}`, {}));
    assert.deepEqual(codes(view), ["OWNERSHIP_UNPROVEN"]);

    // Once the origin is proven at the current endpoint, it lists.
    store.setOfferIntegration(created.id, {
      ownershipVerifiedAt: new Date().toISOString(),
      ownershipOrigin: "https://byo.example",
    });
    assert.ok((await directory()).some((o) => o.id === created.id));
  });
});
