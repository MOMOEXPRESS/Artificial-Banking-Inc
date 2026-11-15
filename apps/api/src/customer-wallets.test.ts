import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
const directory = mkdtempSync(join(tmpdir(), "abi-customer-wallet-"));
process.env.POLICYVAULT_DB = join(directory, "wallet.db");
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_KEY_PEPPER = "customer-wallet-fixture";
process.env.ABI_CHAT_LLM = "0";
process.env.PRIVY_APP_ID = "owned-fixture";
process.env.PRIVY_APP_SECRET = "fixture-secret";
process.env.SUPABASE_URL = "https://fixture.invalid";
process.env.SUPABASE_PUBLISHABLE_KEY = "fixture-public";
const { store, commerceDatabase: db } = await import("./store.js");
const { ensureWorkspaces, createWorkspace } = await import("./workspaces.js");
const {
  provisionCustomerWallet: provision,
  customerWalletStatus: status,
  privyCustomerProvider,
  MAINNET_ASSETS,
} = await import("./customer-wallets.js");
import type { CustomerWalletProvider } from "./customer-wallets.js";
after(() => rmSync(directory, { recursive: true, force: true }));
function fixture() {
  const user = store.createUser({
    email: `${crypto.randomUUID()}@example.invalid`,
    name: "Owner",
    passwordHash: "unused",
  });
  if ("conflict" in user) throw Error();
  const org = store.createOrg("Wallet fixture", 12_000_000n);
  store.addMembership(user.id, org.id, "owner");
  const subject = crypto.randomUUID();
  db()
    .prepare(
      "INSERT INTO abi_external_identities(subject,user_id,external_only,created_at) VALUES (?,?,1,?)",
    )
    .run(subject, user.id, new Date().toISOString());
  const workspace = ensureWorkspaces(org.id)[0]!;
  const jwt = "a".repeat(100);
  const identityFetcher: typeof fetch = async () =>
    Response.json({
      identity: {
        id: subject,
        sessionId: crypto.randomUUID(),
        email: user.email,
        emailConfirmed: true,
        name: user.name,
        aal: "aal1",
        amr: [],
      },
    });
  const signers = new Map<string, ReturnType<typeof privateKeyToAccount>>();
  const wallets = new Map<
    string,
    {
      id: string;
      address: string;
      chain_type: "ethereum";
      external_id: string;
      owner_id: string;
      archived_at: null;
    }
  >();
  let creates = 0,
    lost = false,
    wrongSigner = false,
    fail = false;
  const api: CustomerWalletProvider = {
    async user(id) {
      assert.equal(id, subject);
      if (fail) throw Error("fixture-secret");
      return `privy:${subject}`;
    },
    async get(id) {
      return wallets.get(id) ?? null;
    },
    async create(id, owner, requestKey) {
      assert.equal(owner, `privy:${subject}`);
      assert.match(requestKey, /^[\da-f-]{36}$/);
      let wallet = wallets.get(id);
      if (!wallet) {
        creates++;
        const account = privateKeyToAccount(generatePrivateKey());
        wallet = {
          id: `wallet-${subject}-${creates}`,
          address: account.address,
          chain_type: "ethereum",
          external_id: id,
          owner_id: `quorum-${creates}`,
          archived_at: null,
        };
        signers.set(wallet.id, account);
        wallets.set(id, wallet);
      }
      if (lost) {
        lost = false;
        throw Error("response lost");
      }
      return wallet;
    },
    async prove(id, token, proof) {
      assert.equal(token, jwt);
      assert.equal(proof.domain.chainId, 8453);
      assert.equal("value" in proof.message, false);
      assert.equal("spender" in proof.message, false);
      const account = wrongSigner ? privateKeyToAccount(generatePrivateKey()) : signers.get(id)!;
      return account.signTypedData(proof);
    },
  };
  const run = (id = String(workspace.id), uid = user.id, fetcher = identityFetcher) =>
    provision(org.id, id, uid, jwt, api, fetcher);
  return {
    user,
    org,
    subject,
    workspace,
    run,
    api,
    wallets,
    get creates() {
      return creates;
    },
    lose: () => {
      lost = true;
    },
    wrong: () => {
      wrongSigner = true;
    },
    fail: () => {
      fail = true;
    },
  };
}
test("customer wallet is owner-authorized, durable and distinct per workspace; real deposits remain gated", async () => {
  const f = fixture();
  assert.equal(status(f.org.id, String(f.workspace.id), f.user.id).status, "setup_pending");
  const result = await f.run();
  assert.equal(result.status, "verified");
  assert.equal(result.address, null);
  assert.equal(result.receiveEnabled, false);
  assert.equal(result.spendingEnabled, false);
  await Promise.all([f.run(), f.run()]);
  assert.equal(f.creates, 1);
  const next = createWorkspace(f.org.id, "Travel", crypto.randomUUID());
  await f.run(next.id);
  assert.equal(f.creates, 2);
  const rows = db()
    .prepare("SELECT address,owner_quorum,subject FROM abi_customer_wallets WHERE org_id=?")
    .all(f.org.id) as { address: string; owner_quorum: string; subject: string }[];
  assert.notEqual(rows[0].address, rows[1].address);
  assert.equal(rows[0].subject, f.subject);
  assert.equal(store.getOrg(f.org.id)?.id, f.org.id);
  assert.equal(
    (
      db()
        .prepare("SELECT COUNT(*) AS n FROM abi_privy_test_wallets WHERE org_id=?")
        .get(f.org.id) as { n: number }
    ).n,
    0,
  );
});
test("response loss recovers by external ID without another wallet", async () => {
  const f = fixture();
  f.lose();
  await assert.rejects(f.run(), { code: "WALLET_SETUP_PENDING" });
  assert.equal(f.creates, 1);
  assert.equal((await f.run()).status, "verified");
  assert.equal(f.creates, 1);
});
test("wrong identity, revoked owner and cross-workspace access fail before provider use", async () => {
  const f = fixture(),
    other = fixture();
  await assert.rejects(f.run(String(f.workspace.id), other.user.id), {
    code: "WALLET_OWNER_REQUIRED",
  });
  await assert.rejects(f.run(String(other.workspace.id)), { code: "WORKSPACE_NOT_FOUND" });
  db()
    .prepare("UPDATE memberships SET revoked_at=? WHERE org_id=? AND user_id=?")
    .run(new Date().toISOString(), f.org.id, f.user.id);
  await assert.rejects(f.run(), { code: "WALLET_OWNER_REQUIRED" });
  assert.equal(f.creates, 0);
});
test("changed owner, invalid signature and provider errors invalidate verification without leaking details", async () => {
  const f = fixture();
  await f.run();
  f.wrong();
  await assert.rejects(f.run(), { code: "WALLET_SETUP_PENDING" });
  assert.equal(status(f.org.id, String(f.workspace.id), f.user.id).verifiedAt, null);
  const g = fixture();
  await g.run();
  g.wallets.values().next().value!.owner_id = "different-owner";
  await assert.rejects(g.run(), { code: "WALLET_SETUP_PENDING" });
  const h = fixture();
  await h.run();
  h.fail();
  await assert.rejects(h.run(), (e: Error) => !e.message.includes("fixture-secret"));
  assert.equal(status(h.org.id, String(h.workspace.id), h.user.id).verifiedAt, null);
});
test("app changes cannot silently replace a customer's wallet", async () => {
  const f = fixture();
  await f.run();
  process.env.PRIVY_APP_ID = "different-app";
  try {
    await assert.rejects(f.run(), { code: "WALLET_APP_CHANGED" });
  } finally {
    process.env.PRIVY_APP_ID = "owned-fixture";
  }
  assert.equal(f.creates, 1);
});
test("SDK adapter requests explicit user ownership and never a server-owned fallback", async () => {
  const original = globalThis.fetch;
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    assert.equal(url.origin, "https://api.privy.io");
    const body = JSON.parse(String(init?.body ?? "{}"));
    requests.push({ path: url.pathname, body });
    if (url.pathname === "/v1/users/custom_auth/id") return Response.json({ id: "privy:owner" });
    if (url.pathname === "/v1/wallets") return Response.json({ id: "wallet:owner" });
    throw Error("Unexpected SDK request");
  };
  try {
    const api = privyCustomerProvider();
    assert.equal(await api.user("verified-subject"), "privy:owner");
    await api.create("external-stable", "privy:owner", crypto.randomUUID());
    assert.deepEqual(requests[0].body, { custom_user_id: "verified-subject" });
    assert.deepEqual(requests[1].body.owner, { user_id: "privy:owner" });
    assert.equal(requests[1].body.additional_signers, undefined);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(new Set(MAINNET_ASSETS.map((a) => a.id)).size, 4);
  assert.deepEqual(new Set(MAINNET_ASSETS.map((a) => a.chainId)), new Set([1, 8453]));
});
test("HTTP managed-wallet routes accept ABI sessions, reject API keys/CSRF and retain workspaces during provider failure", async () => {
  const { app } = await import("./index.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  const f = fixture(),
    original = globalThis.fetch;
  db()
    .prepare("UPDATE users SET email_verified_at=? WHERE id=?")
    .run(new Date().toISOString(), f.user.id);
  const session = crypto.randomUUID();
  store.createUserSession({ userId: f.user.id, token: session, ttlMs: 60000 });
  const headers = {
    "content-type": "application/json",
    "x-abi-org": f.org.id,
    cookie: `abi_session=${session}; abi_csrf=wallet-test`,
    "x-abi-csrf": "wallet-test",
  };
  try {
    const path = `${origin}/v1/guardian/workspaces/${f.workspace.id}/wallet`;
    assert.equal((await original(path)).status, 401);
    assert.equal(
      (await original(path, { headers: { authorization: `Bearer ${f.org.guardianKey}` } })).status,
      401,
    );
    const get = await original(path, { headers });
    assert.equal(get.status, 200);
    assert.equal(((await get.json()) as { address: null }).address, null);
    assert.equal(
      (
        await original(path, {
          method: "POST",
          headers: { ...headers, "x-abi-csrf": "wrong" },
          body: "{}",
        })
      ).status,
      403,
    );
    let providerCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "fixture.invalid")
        return Response.json({
          identity: {
            id: f.subject,
            sessionId: crypto.randomUUID(),
            email: f.user.email,
            emailConfirmed: true,
            name: f.user.name,
            aal: "aal1",
            amr: [],
          },
        });
      if (url.hostname === "api.privy.io") {
        providerCalls++;
        return Response.json({ error: "fixture secret must not leak" }, { status: 403 });
      }
      return original(input, init);
    };
    const created = await original(`${origin}/v1/guardian/workspaces`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Automatic wallet", idempotencyKey: crypto.randomUUID() }),
    });
    assert.equal(created.status, 201);
    const body = (await created.json()) as { workspace: { id: string; name: string } };
    assert.equal(body.workspace.name, "Automatic wallet");
    assert.ok(providerCalls > 0);
    const retry = await original(`${origin}/v1/guardian/workspaces/${body.workspace.id}/wallet`, {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(retry.status, 503);
    assert.ok(providerCalls > 0);
    const row = db()
      .prepare("SELECT org_id,wallet_id FROM abi_managed_wallets WHERE workspace_id=?")
      .get(body.workspace.id) as { org_id: string; wallet_id: null };
    assert.equal(row.org_id, f.org.id);
    assert.equal(row.wallet_id, null);
  } finally {
    globalThis.fetch = original;
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
