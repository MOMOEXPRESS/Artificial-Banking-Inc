import assert from "node:assert/strict";
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
