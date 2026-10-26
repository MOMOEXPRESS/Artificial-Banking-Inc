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

function cookieHeader(res: Response): string {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

async function signInUser(email: string) {
  const password = "Seller-Test-Pass-1!";
  const passwordHash = await hashPassword(password);
  const created = store.createAccountWithOrg({
    email,
    name: "Seller Tester",
    orgName: "Buyer Desk",
    passwordHash,
    verificationToken: `verify-${email}`,
    verificationTtlMs: 60_000,
    markEmailVerified: true,
    ledgerMode: "sandbox",
  });
  assert.equal(created.status, "created");
  if (created.status !== "created") throw new Error("expected created");

  const login = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200);
  const cookies = cookieHeader(login);
  const csrf = cookies
    .split("; ")
    .find((c) => c.startsWith("abi_csrf="))
    ?.slice("abi_csrf=".length);
  assert.ok(csrf);
  const body = (await login.json()) as {
    orgs: { id: string; kind: string; name: string }[];
  };
  assert.equal(body.orgs[0]?.kind, "buyer");
  return {
    cookies,
    csrf: csrf!,
    buyerOrgId: body.orgs[0]!.id,
    userId: created.status === "created" ? created.user.id : "",
  };
}

describe("seller partnership phase 0", () => {
  it("creates a separate seller org and profile without reusing the buyer float", async () => {
    const session = await signInUser("seller-phase0@example.com");
    const create = await fetch(`${base}/v1/seller/orgs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookies,
        "x-abi-csrf": session.csrf,
      },
      body: JSON.stringify({ name: "Seller Desk" }),
    });
    assert.equal(create.status, 201);
    const created = (await create.json()) as {
      org: { id: string; kind: string; name: string };
      profile: { displayName: string; status: string; payoutAddress: string };
    };
    assert.equal(created.org.kind, "seller");
    assert.equal(created.org.name, "Seller Desk");
    assert.notEqual(created.org.id, session.buyerOrgId);
    assert.equal(created.profile.status, "draft");
    assert.equal(created.profile.payoutAddress, "");

    const buyer = store.getOrg(session.buyerOrgId);
    const seller = store.getOrg(created.org.id);
    assert.equal(buyer?.kind, "buyer");
    assert.equal(seller?.kind, "seller");

    const me = await fetch(`${base}/v1/auth/me`, {
      headers: { cookie: session.cookies },
    });
    const meBody = (await me.json()) as { orgs: { id: string; kind: string }[] };
    assert.equal(meBody.orgs.length, 2);
    assert.ok(meBody.orgs.some((o) => o.kind === "buyer"));
    assert.ok(meBody.orgs.some((o) => o.kind === "seller"));

    const profileGet = await fetch(`${base}/v1/seller/profile`, {
      headers: {
        cookie: session.cookies,
        "x-abi-org": created.org.id,
      },
    });
    assert.equal(profileGet.status, 200);

    const onBuyer = await fetch(`${base}/v1/seller/profile`, {
      headers: {
        cookie: session.cookies,
        "x-abi-org": session.buyerOrgId,
      },
    });
    assert.equal(onBuyer.status, 403);
    const onBuyerBody = (await onBuyer.json()) as { error: { code: string } };
    assert.equal(onBuyerBody.error.code, "SELLER_ORG_REQUIRED");

    const patched = await fetch(`${base}/v1/seller/profile`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: session.cookies,
        "x-abi-org": created.org.id,
        "x-abi-csrf": session.csrf,
      },
      body: JSON.stringify({
        displayName: "Seller Desk Live",
        payoutAddress: "0x0000000000000000000000000000000000000001",
        network: "base-sepolia",
        website: "https://seller.example",
        description: "Gets paid by agents",
      }),
    });
    assert.equal(patched.status, 200);
    const patchedBody = (await patched.json()) as {
      profile: { status: string; payoutAddress: string; displayName: string };
    };
    assert.equal(patchedBody.profile.status, "ready");
    assert.equal(
      patchedBody.profile.payoutAddress.toLowerCase(),
      "0x0000000000000000000000000000000000000001",
    );
    assert.equal(patchedBody.profile.displayName, "Seller Desk Live");
    assert.equal(store.getOrg(created.org.id)?.name, "Seller Desk Live");
  });

  it("exposes an empty early directory stub", async () => {
    const res = await fetch(`${base}/v1/directory/offers`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { offers: unknown[] };
    assert.deepEqual(body.offers, []);
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
      body: JSON.stringify({
        displayName: "Workspace Gate Co",
        workspace: "seller",
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "SELLER_ORG_REQUIRED");
  });
});
