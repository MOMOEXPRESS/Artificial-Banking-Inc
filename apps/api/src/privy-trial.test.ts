import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
const directory = mkdtempSync(join(tmpdir(), "abi-privy-trial-"));
process.env.POLICYVAULT_DB = join(directory, "trial.db");
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_KEY_PEPPER = "privy-fixture-only";
process.env.PRIVY_APP_ID = "test-app";
process.env.PRIVY_APP_SECRET = "test-secret";
process.env.CHAIN = "base-sepolia";
process.env.ABI_CHAT_LLM = "0";
const nativeFetch = globalThis.fetch;
const account = privateKeyToAccount(generatePrivateKey());
const wallets = new Map<
  string,
  {
    id: string;
    address: string;
    chain_type: "ethereum";
    external_id: string;
    owner_id: null;
    archived_at: null;
  }
>();
let creates = 0,
  lostResponse = false,
  brokenSignature = false,
  rejectProvider = false;
const signingPayloads: Record<string, unknown>[] = [];
const createKeys: string[] = [];
const provider: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== "https://api.privy.io") return nativeFetch(input, init);
  const headers = new Headers(init?.headers);
  assert.equal(init?.redirect, "error");
  assert.equal(headers.get("privy-app-id"), "test-app");
  assert.equal(
    headers.get("authorization"),
    `Basic ${Buffer.from("test-app:test-secret").toString("base64")}`,
  );
  if (rejectProvider)
    return Response.json({ secret: "must never reach the browser" }, { status: 401 });
  if (init?.method === "GET")
    return wallets.has(url.pathname.split("ext_wal_")[1])
      ? Response.json(wallets.get(url.pathname.split("ext_wal_")[1]))
      : new Response(null, { status: 404 });
  const body = JSON.parse(String(init?.body));
  assert.ok(headers.get("privy-idempotency-key"));
  if (url.pathname === "/v1/wallets") {
    createKeys.push(headers.get("privy-idempotency-key")!);
    let wallet = wallets.get(body.external_id);
    if (!wallet) {
      creates++;
      const signer = privateKeyToAccount(generatePrivateKey());
      wallet = {
        id: `wallet_${creates}`,
        address: signer.address,
        chain_type: "ethereum",
        external_id: body.external_id,
        owner_id: null,
        archived_at: null,
      };
      // Keep an independent key for each workspace, as a real provider would.
      signers.set(wallet.id, signer);
      wallets.set(body.external_id, wallet);
    }
    if (lostResponse) {
      lostResponse = false;
      throw Error("socket lost after create");
    }
    return Response.json(wallet);
  }
  assert.match(url.pathname, /^\/v1\/wallets\/wallet_\d+\/rpc$/);
  assert.equal(body.method, "eth_signTypedData_v4");
  assert.equal(body.caip2, "eip155:84532");
  const data = body.params.typed_data;
  assert.equal(data.domain.chainId, 84532);
  assert.equal(data.primary_type, "ABIConnectionProof");
  assert.equal(data.message.value, undefined);
  signingPayloads.push(data);
  const signer = signers.get(url.pathname.split("/")[3])!;
  const signature = await (brokenSignature ? account : signer).signTypedData({
    domain: data.domain,
    types: data.types,
    primaryType: data.primary_type,
    message: data.message,
  });
  return Response.json({ method: "eth_signTypedData_v4", data: { encoding: "hex", signature } });
};
const signers = new Map<string, ReturnType<typeof privateKeyToAccount>>();
globalThis.fetch = provider;
const { store, commerceDatabase } = await import("./store.js");
const { app } = await import("./index.js");
const { createWorkspace, ensureWorkspaces, viewWorkspace } = await import("./workspaces.js");
let server: ReturnType<typeof app.listen>,
  base = "";
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  globalThis.fetch = nativeFetch;
  server.close();
  rmSync(directory, { recursive: true, force: true });
});
function fixture(role: "owner" | "viewer" = "owner", orgId?: string) {
  const org = orgId ? store.getOrg(orgId)! : store.createOrg("Privy trial", 25_000_000n);
  const user = store.createUser({
    email: `${crypto.randomUUID()}@example.invalid`,
    name: "Tester",
    passwordHash: "unused",
  });
  if ("conflict" in user) throw Error();
  store.addMembership(user.id, org.id, role);
  commerceDatabase()
    .prepare("UPDATE users SET email_verified_at=? WHERE id=?")
    .run(new Date().toISOString(), user.id);
  const token = crypto.randomUUID();
  store.createUserSession({ userId: user.id, token, ttlMs: 3600000 });
  ensureWorkspaces(org.id);
  return {
    org,
    headers: {
      "content-type": "application/json",
      cookie: `abi_session=${token}; abi_csrf=test-csrf`,
      "x-abi-csrf": "test-csrf",
      "x-abi-org": org.id,
    },
  };
}
type TrialResponse = {
  wallet: { address: string; providerWalletId: string; verifiedAt: string | null };
  spendingEnabled: boolean;
  control: string;
  error: { code: string };
};
type TrialHttp = Omit<Response, "json"> & { json: () => Promise<TrialResponse> };
async function request(path: string, headers: Record<string, string>, body?: unknown) {
  return nativeFetch(base + path, {
    headers,
    method: body ? "POST" : "GET",
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) as Promise<TrialHttp>;
}
const path = (id: string) => `/v1/guardian/workspaces/${id}/privy`;
test("a dedicated Privy test wallet is retry-safe and never changes workspace funds", async () => {
  const owner = fixture(),
    a = createWorkspace(owner.org.id, "Travel", crypto.randomUUID()),
    b = createWorkspace(owner.org.id, "Research", crypto.randomUUID());
  const before = viewWorkspace(owner.org.id, a.id),
    start = creates;
  const responses = await Promise.all([
    request(path(a.id), owner.headers, { acknowledgeTestOnly: true }),
    request(path(a.id), owner.headers, { acknowledgeTestOnly: true }),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  const results = await Promise.all(responses.map((r) => r.json()));
  assert.equal(results[0].wallet.providerWalletId, results[1].wallet.providerWalletId);
  assert.equal(creates, start + 1);
  const other = await (
    await request(path(b.id), owner.headers, { acknowledgeTestOnly: true })
  ).json();
  assert.notEqual(other.wallet.address, results[0].wallet.address);
  assert.equal(results[0].spendingEnabled, false);
  assert.equal(results[0].control, "application-controlled-test");
  assert.deepEqual(viewWorkspace(owner.org.id, a.id).balance, before.balance);
  assert.deepEqual(viewWorkspace(owner.org.id, a.id).card, before.card);
  assert.ok(createKeys.every(Boolean));
  const text = JSON.stringify(results);
  assert.ok(!text.includes("test-secret"));
});
test("provider response loss recovers by stable external ID without another wallet", async () => {
  const owner = fixture(),
    w = createWorkspace(owner.org.id, "Recovery", crypto.randomUUID()),
    start = creates;
  lostResponse = true;
  assert.equal(
    (await request(path(w.id), owner.headers, { acknowledgeTestOnly: true })).status,
    200,
  );
  assert.equal(
    (await request(path(w.id), owner.headers, { acknowledgeTestOnly: true })).status,
    200,
  );
  assert.equal(creates, start + 1);
});
test("proof validates the actual workspace signing key and rejects a different key", async () => {
  const owner = fixture(),
    w = createWorkspace(owner.org.id, "Proof", crypto.randomUUID());
  assert.equal((await request(path(w.id) + "/verify", owner.headers, {})).status, 409);
  await request(path(w.id), owner.headers, { acknowledgeTestOnly: true });
  const result = await request(path(w.id) + "/verify", owner.headers, {});
  assert.equal(result.status, 200);
  assert.ok((await result.json()).wallet.verifiedAt);
  assert.equal(signingPayloads.at(-1)?.primary_type, "ABIConnectionProof");
  const failed = createWorkspace(owner.org.id, "Wrong signer", crypto.randomUUID());
  await request(path(failed.id), owner.headers, { acknowledgeTestOnly: true });
  brokenSignature = true;
  try {
    const r = await request(path(failed.id) + "/verify", owner.headers, {});
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, "PRIVY_SIGNATURE_INVALID");
  } finally {
    brokenSignature = false;
  }
  const status = await (await request(path(failed.id), owner.headers)).json();
  assert.equal(status.wallet.verifiedAt, null);
});
test("trial endpoints enforce owner, workspace, CSRF and exact server-owned proof inputs", async () => {
  const owner = fixture(),
    w = createWorkspace(owner.org.id, "Private", crypto.randomUUID()),
    viewer = fixture("viewer", owner.org.id),
    foreign = fixture();
  assert.equal((await request(path(w.id), {})).status, 401);
  assert.equal((await request(path(w.id), viewer.headers)).status, 403);
  assert.equal(
    (await request(path(w.id), foreign.headers, { acknowledgeTestOnly: true })).status,
    404,
  );
  assert.equal(
    (
      await request(
        path(w.id),
        { ...owner.headers, "x-abi-csrf": "wrong" },
        { acknowledgeTestOnly: true },
      )
    ).status,
    403,
  );
  assert.equal((await request(path(w.id), owner.headers, {})).status, 400);
  assert.equal(
    (await request(path(w.id) + "/verify", owner.headers, { method: "eth_sendTransaction" }))
      .status,
    400,
  );
});
test("missing credentials, mainnet selection and app changes cannot silently replace custody", async () => {
  const owner = fixture(),
    w = createWorkspace(owner.org.id, "Config", crypto.randomUUID());
  const secret = process.env.PRIVY_APP_SECRET;
  delete process.env.PRIVY_APP_SECRET;
  assert.equal(
    (await request(path(w.id), owner.headers, { acknowledgeTestOnly: true })).status,
    503,
  );
  process.env.PRIVY_APP_SECRET = secret;
  process.env.CHAIN = "base";
  assert.equal(
    (await request(path(w.id), owner.headers, { acknowledgeTestOnly: true })).status,
    403,
  );
  process.env.CHAIN = "base-sepolia";
  assert.equal(
    (await request(path(w.id), owner.headers, { acknowledgeTestOnly: true })).status,
    200,
  );
  process.env.PRIVY_APP_ID = "different-app";
  assert.equal(
    (await request(path(w.id), owner.headers, { acknowledgeTestOnly: true })).status,
    409,
  );
  process.env.PRIVY_APP_ID = "test-app";
  rejectProvider = true;
  try {
    const r = await request(path(w.id) + "/verify", owner.headers, {});
    assert.equal(r.status, 503);
    assert.ok(!(await r.text()).includes("must never reach the browser"));
  } finally {
    rejectProvider = false;
  }
});
