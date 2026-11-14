import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
const directory = mkdtempSync(join(tmpdir(), "abi-ws-http-"));
process.env.POLICYVAULT_DB = join(directory, "test.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_CHAT_LLM = "0";
const { store, commerceDatabase } = await import("./store.js");
const { app } = await import("./index.js");
const { ensureWorkspaces, viewWorkspace, createWorkspace } = await import("./workspaces.js");
let base = "";
let server: ReturnType<typeof app.listen>;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  rmSync(directory, { recursive: true, force: true });
});
function identity(role: "owner" | "viewer" | "approver" = "owner", orgId?: string) {
  const org = orgId ? store.getOrg(orgId)! : store.createOrg("HTTP Workspace", 0n);
  const user = store.createUser({
    name: "Tester",
    email: `${crypto.randomUUID()}@example.invalid`,
    passwordHash: "not-used",
  });
  if ("conflict" in user) throw Error("fixture conflict");
  store.addMembership(user.id, org.id, role);
  commerceDatabase()
    .prepare("UPDATE users SET email_verified_at=? WHERE id=?")
    .run(new Date().toISOString(), user.id);
  const token = crypto.randomUUID();
  store.createUserSession({ userId: user.id, token, ttlMs: 3600000 });
  ensureWorkspaces(org.id);
  return {
    org,
    user,
    headers: {
      cookie: `abi_session=${token}; abi_csrf=fixture-csrf`,
      "x-abi-csrf": "fixture-csrf",
      "x-abi-org": org.id,
      "content-type": "application/json",
    },
  };
}
async function request(
  path: string,
  headers: Record<string, string>,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    data: (await response.json()) as {
      workspaces: { id: string }[];
      org: { name: string; kind: string };
      partner: { id: string };
      sessionKey: { id: string; token: string };
      sessionKeys: { id: string }[];
      workspace: { id: string };
      verified: boolean;
      capabilities: { reallocate: boolean };
    },
  };
}

test("one key explicitly selects multiple wallets and rotation/revocation apply to all grants", async () => {
  const owner = identity(),
    a = createWorkspace(owner.org.id, "First", crypto.randomUUID()),
    b = createWorkspace(owner.org.id, "Second", crypto.randomUUID()),
    denied = createWorkspace(owner.org.id, "Excluded", crypto.randomUUID());
  const payload = {
    name: "Multi-wallet agent",
    workspaceIds: [a.id, b.id],
    pay: false,
    ttlHours: 24,
    idempotencyKey: crypto.randomUUID(),
  };
  const created = await request("/v1/guardian/wallet-keys", owner.headers, payload);
  assert.equal(created.status, 201);
  const token = created.data.sessionKey.token;
  assert.equal(
    (
      await request("/v1/guardian/wallet-keys", owner.headers, {
        ...payload,
        workspaceIds: [b.id, a.id],
      })
    ).status,
    409,
  );
  for (const wallet of [a, b]) {
    const probe = await request("/v1/agent/context", {
      authorization: `Bearer ${token}`,
      "x-abi-workspace": wallet.id,
    });
    assert.equal(probe.status, 200);
    assert.equal(probe.data.workspace.id, wallet.id);
  }
  for (const wallet of [a, b]) {
    const client = new Client({ name: "wallet-context-test", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: {
          headers: { authorization: `Bearer ${token}`, "x-abi-workspace": wallet.id },
        },
      }),
    );
    try {
      const tools = await client.listTools();
      assert.ok(tools.tools.some((t) => t.name === "abi_connection_context"));
      assert.ok(tools.tools.some((t) => t.name === "abi_list_wallets"));
      assert.ok(!tools.tools.some((t) => t.name === "abi_propose_payment"));
      const context = await client.callTool({ name: "abi_connection_context", arguments: {} });
      assert.notEqual(context.isError, true);
      assert.equal(
        (context.structuredContent as { workspace: { id: string } }).workspace.id,
        wallet.id,
      );
      const list = await client.callTool({ name: "abi_list_wallets", arguments: {} });
      assert.notEqual(list.isError, true);
      const ids = (list.structuredContent as { wallets: { id: string }[] }).wallets.map(
        (w) => w.id,
      );
      assert.deepEqual(ids.sort(), [a.id, b.id].sort());
    } finally {
      await client.close();
    }
  }
  assert.equal(
    (
      await request("/v1/agent/context", {
        authorization: `Bearer ${token}`,
        "x-abi-workspace": denied.id,
      })
    ).status,
    401,
  );
  const foreign = identity(),
    foreignWallet = createWorkspace(foreign.org.id, "Foreign", crypto.randomUUID());
  assert.equal(
    (
      await request("/v1/guardian/wallet-keys", owner.headers, {
        ...payload,
        workspaceIds: [a.id, foreignWallet.id],
        idempotencyKey: crypto.randomUUID(),
      })
    ).status,
    404,
  );
  assert.equal(
    (await request("/v1/guardian/wallet-keys", identity("viewer", owner.org.id).headers, payload))
      .status,
    403,
  );
  const rotated = await request(
    `/v1/guardian/wallet-keys/${created.data.sessionKey.id}/rotate`,
    owner.headers,
    {},
  );
  assert.equal(rotated.status, 200);
  assert.equal(
    (
      await request("/v1/agent/context", {
        authorization: `Bearer ${token}`,
        "x-abi-workspace": b.id,
      })
    ).status,
    401,
  );
  const replacement = rotated.data.sessionKey.token;
  assert.equal(
    (
      await request("/v1/agent/context", {
        authorization: `Bearer ${replacement}`,
        "x-abi-workspace": b.id,
      })
    ).data.workspace.id,
    b.id,
  );
  await request(`/v1/guardian/wallet-keys/${created.data.sessionKey.id}/revoke`, owner.headers, {});
  for (const wallet of [a, b])
    assert.equal(
      (
        await request("/v1/agent/context", {
          authorization: `Bearer ${replacement}`,
          "x-abi-workspace": wallet.id,
        })
      ).status,
      401,
    );
});
test("optional agent administration cannot raise limits or gain access to newly created funds", async () => {
  const owner = identity(),
    wallet = createWorkspace(owner.org.id, "Admin wallet", crypto.randomUUID());
  const make = async (permissions: string[]) =>
    request("/v1/guardian/wallet-keys", owner.headers, {
      name: "Scoped admin",
      workspaceIds: [wallet.id],
      pay: false,
      permissions,
      ttlHours: 24,
      idempotencyKey: crypto.randomUUID(),
    });
  const plain = await make([]);
  const plainHeaders = {
    authorization: `Bearer ${plain.data.sessionKey.token}`,
    "content-type": "application/json",
  };
  assert.equal(
    (await request("/v1/agent/card", plainHeaders, { status: "frozen" }, "PATCH")).status,
    403,
  );
  const admin = await make(["wallets:create", "cards:manage", "keys:manage"]);
  assert.equal(admin.status, 201);
  const headers = {
    authorization: `Bearer ${admin.data.sessionKey.token}`,
    "content-type": "application/json",
  };
  assert.equal(
    (await request("/v1/agent/card", headers, { status: "frozen" }, "PATCH")).status,
    200,
  );
  assert.equal(
    (await request("/v1/agent/card", headers, { status: "active", limitUsdc: "1000" }, "PATCH"))
      .status,
    400,
  );
  assert.equal(
    (await request("/v1/agent/card", headers, { status: "active" }, "PATCH")).status,
    200,
  );
  const created = await request("/v1/agent/wallets", headers, {
    name: "Agent-created",
    idempotencyKey: crypto.randomUUID(),
  });
  assert.equal(created.status, 201);
  assert.equal(viewWorkspace(owner.org.id, created.data.workspace.id).card.limitUsdc, "0");
  assert.equal(
    (
      await request("/v1/agent/context", {
        ...headers,
        "x-abi-workspace": created.data.workspace.id,
      })
    ).status,
    401,
  );
  const rotated = await request("/v1/agent/key/rotate", headers, {});
  assert.equal(rotated.status, 200);
  assert.equal((await request("/v1/agent/context", headers)).status, 401);
  const replaced = { ...headers, authorization: `Bearer ${rotated.data.sessionKey.token}` };
  assert.equal((await request("/v1/agent/key/revoke", replaced, {})).status, 200);
  assert.equal((await request("/v1/agent/context", replaced)).status, 401);
});

test("account workspace selection is membership-checked, private by default and role protected", async () => {
  const owner = identity(),
    travel = createWorkspace(owner.org.id, "Travel", crypto.randomUUID());
  const viewer = identity("viewer", owner.org.id);
  const list = await request("/v1/account/workspaces", viewer.headers);
  assert.equal(list.status, 200);
  assert.equal(
    list.data.workspaces.some((w: { id: string }) => w.id === travel.id),
    false,
  );
  const denied = await request("/v1/guardian/org", {
    ...viewer.headers,
    "x-abi-workspace": travel.id,
  });
  assert.equal(denied.status, 403);
  const secretConnection = await request(
    `/v1/guardian/workspaces/${travel.id}/connections`,
    owner.headers,
    { name: "Private", pay: false, ttlHours: 24, idempotencyKey: crypto.randomUUID() },
  );
  const keysWithoutHeader = await request("/v1/guardian/session-keys", viewer.headers);
  assert.equal(
    JSON.stringify(keysWithoutHeader.data).includes(secretConnection.data.sessionKey.id),
    false,
  );
  const forbiddenKeyWithoutHeader = await request(
    `/v1/guardian/session-keys/${secretConnection.data.sessionKey.id}/replace`,
    viewer.headers,
    {},
  );
  assert.equal(forbiddenKeyWithoutHeader.status, 403);
  const share = await request(`/v1/guardian/workspaces/${travel.id}/members`, owner.headers, {
    userId: viewer.user.id,
    enabled: true,
  });
  assert.equal(share.status, 200);
  const allowed = await request("/v1/guardian/org", {
    ...viewer.headers,
    "x-abi-workspace": travel.id,
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.data.org.name, "Travel");
  const write = await request("/v1/guardian/workspaces", viewer.headers, {
    name: "No",
    idempotencyKey: crypto.randomUUID(),
  });
  assert.equal(write.status, 403);
  const foreign = identity();
  assert.equal(
    (
      await request("/v1/guardian/org", {
        ...owner.headers,
        "x-abi-workspace": createWorkspace(foreign.org.id, "Foreign", crypto.randomUUID()).id,
      })
    ).status,
    404,
  );
});
test("connection keys have one-time secrets, real probes, revocation and immutable workspace scope", async () => {
  const owner = identity(),
    a = createWorkspace(owner.org.id, "A", crypto.randomUUID()),
    b = createWorkspace(owner.org.id, "B", crypto.randomUUID());
  const created = await request(
    `/v1/guardian/workspaces/${a.id}/connections`,
    { ...owner.headers, "x-abi-workspace": a.id },
    { name: "Agent A", pay: false, ttlHours: 24, idempotencyKey: crypto.randomUUID() },
  );
  assert.equal(created.status, 201);
  const token = created.data.sessionKey.token;
  const read = { authorization: `Bearer ${token}`, "x-abi-workspace": b.id };
  const probe = await request("/v1/agent/context", read);
  assert.equal(probe.status, 200);
  assert.equal(probe.data.workspace.id, a.id);
  assert.equal(probe.data.verified, true);
  assert.equal(probe.data.capabilities.reallocate, false);
  assert.ok(
    (viewWorkspace(owner.org.id, a.id).connections[0] as { verifiedAt: string }).verifiedAt,
  );
  const list = await request("/v1/guardian/session-keys", {
    ...owner.headers,
    "x-abi-workspace": a.id,
  });
  assert.equal(list.data.sessionKeys.length, 1);
  assert.equal(JSON.stringify(list.data).includes(token), false);
  const wrong = await request(
    `/v1/guardian/session-keys/${created.data.sessionKey.id}/replace`,
    { ...owner.headers, "x-abi-workspace": b.id },
    {},
  );
  assert.equal(wrong.status, 403);
  const rotated = await request(
    `/v1/guardian/session-keys/${created.data.sessionKey.id}/replace`,
    { ...owner.headers, "x-abi-workspace": a.id },
    {},
  );
  assert.equal(rotated.status, 200);
  assert.equal((await request("/v1/agent/context", read)).status, 401);
  await request(
    `/v1/guardian/session-keys/${created.data.sessionKey.id}/revoke`,
    { ...owner.headers, "x-abi-workspace": a.id },
    {},
  );
  assert.equal(
    (
      await request("/v1/agent/context", {
        authorization: `Bearer ${rotated.data.sessionKey.token}`,
      })
    ).status,
    401,
  );
});
test("workspace seller enablement reuses the buyer identity without granting another owner access", async () => {
  const owner = identity(),
    w = createWorkspace(owner.org.id, "Selling", crypto.randomUUID());
  const headers = { ...owner.headers, "x-abi-workspace": w.id };
  assert.equal(
    (await request(`/v1/guardian/workspaces/${w.id}/seller`, headers, { linkExisting: false }))
      .status,
    200,
  );
  const seller = await request("/v1/partner/auth/me", headers);
  assert.equal(seller.status, 200);
  assert.equal(seller.data.partner.id, owner.user.id);
  assert.equal(seller.data.org.kind, "seller");
  assert.equal((await request("/v1/seller/profile", headers)).status, 200);
  const foreign = identity();
  assert.equal(
    (await request("/v1/partner/auth/me", { ...foreign.headers, "x-abi-workspace": w.id })).status,
    401,
  );
  const csrf = await request(
    `/v1/guardian/workspaces/${w.id}/connections`,
    { ...headers, "x-abi-csrf": "bad" },
    { name: "Bad", idempotencyKey: crypto.randomUUID() },
  );
  assert.equal(csrf.status, 403);
});

test("external-only sellers require enrolled MFA for payout changes and reject code replay", async () => {
  const owner = identity(),
    w = createWorkspace(owner.org.id, "SSO Seller", crypto.randomUUID());
  commerceDatabase()
    .prepare(
      "INSERT INTO abi_external_identities(subject,user_id,external_only,created_at) VALUES (?,?,1,?)",
    )
    .run(crypto.randomUUID(), owner.user.id, new Date().toISOString());
  const headers = { ...owner.headers, "x-abi-workspace": w.id };
  assert.equal(
    (await request(`/v1/guardian/workspaces/${w.id}/seller`, headers, { linkExisting: false }))
      .status,
    200,
  );
  const a = "0x1111111111111111111111111111111111111111",
    b = "0x2222222222222222222222222222222222222222";
  assert.equal(
    (await request("/v1/seller/profile", headers, { payoutAddress: a }, "PATCH")).status,
    200,
  );
  assert.equal(
    (await request("/v1/seller/profile", headers, { payoutAddress: b }, "PATCH")).status,
    403,
  );
  const { generateSecret, currentCode } = await import("./auth/totp.js");
  const secret = generateSecret();
  store.startMfaEnrolment(owner.user.id, secret);
  store.confirmMfa(owner.user.id, 0);
  assert.equal(
    (await request("/v1/seller/profile", headers, { payoutAddress: b }, "PATCH")).status,
    403,
  );
  const code = currentCode(secret);
  assert.equal(
    (await request("/v1/seller/profile", headers, { payoutAddress: b, code }, "PATCH")).status,
    200,
  );
  assert.equal(
    (await request("/v1/seller/profile", headers, { payoutAddress: a, code }, "PATCH")).status,
    403,
  );
});
