import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
const directory = mkdtempSync(join(tmpdir(), "abi-sso-test-"));
process.env.POLICYVAULT_DB = join(directory, "sso.db");
process.env.ABI_KEY_PEPPER = "sso-test-pepper";
process.env.SUPABASE_URL = "https://identity.example.invalid";
process.env.SUPABASE_PUBLISHABLE_KEY = "public-test-configuration";
const { store, commerceDatabase } = await import("../store.js");
const { registerSupabaseAuth } = await import("../routes/supabase-auth-routes.js");
const { externalSessionGuard, verifySupabaseIdentity, isExternalOnly } =
  await import("./supabase.js");
const { ensureWorkspaces, viewWorkspace } = await import("../workspaces.js");
const { generateSecret } = await import("./totp.js");
const identities = new Map<
  string,
  {
    id: string;
    sessionId: string;
    email: string;
    emailConfirmed: true;
    name: string;
    aal: "aal1";
    amr: { method: string; timestamp: number }[];
  }
>();
let unavailable = false;
const provider: typeof fetch = async (_url, init) => {
  if (unavailable) return new Response("{}", { status: 503 });
  const token = new Headers(init?.headers).get("authorization")?.slice(7) ?? "";
  const identity = identities.get(token);
  return new Response(JSON.stringify({ identity }), {
    status: identity ? 200 : 401,
    headers: { "content-type": "application/json" },
  });
};
const app = express();
app.use(express.json());
app.use(externalSessionGuard(provider));
registerSupabaseAuth(app, provider);
app.get("/probe", (req, res) => {
  const raw = req.headers.cookie?.match(/abi_session=([^;]+)/)?.[1];
  const me = raw ? store.getUserBySessionToken(raw) : null;
  return me ? res.json({ userId: me.user.id }) : res.status(401).json({});
});
let server: ReturnType<typeof app.listen>,
  base = "";
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  rmSync(directory, { recursive: true, force: true });
});
function external(email = `sso-${crypto.randomUUID()}@example.invalid`) {
  const token = `${"a".repeat(50)}.${crypto.randomUUID()}.${"b".repeat(30)}`;
  const identity = {
    id: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    email,
    emailConfirmed: true as const,
    name: "External user",
    aal: "aal1" as const,
    amr: [{ method: "oauth", timestamp: Math.floor(Date.now() / 1000) }],
  };
  identities.set(token, identity);
  return { token, identity };
}
async function exchange(token: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(base + "/v1/auth/supabase/exchange", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  });
}
const jar = (r: Response) =>
  r.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
test("new verified identities require terms and create only empty wallet/card authority", async () => {
  const e = external();
  assert.equal((await exchange(e.token, {})).status, 400);
  const r = await exchange(e.token, { acceptTerms: true });
  assert.equal(r.status, 200);
  const d = (await r.json()) as { user: { id: string }; orgs: { id: string }[] };
  assert.equal(isExternalOnly(d.user.id), true);
  const workspace = ensureWorkspaces(d.orgs[0]!.id)[0]!;
  const view = viewWorkspace(d.orgs[0]!.id, String(workspace.id));
  assert.equal(view.balance.availableUsdc, "0");
  assert.equal(view.card.limitUsdc, "0");
  assert.equal(view.connections.length, 0);
  const cookie = jar(r);
  assert.equal((await fetch(base + "/probe", { headers: { cookie } })).status, 401);
  assert.equal(
    (await fetch(base + "/probe", { headers: { cookie, "x-abi-supabase-token": e.token } })).status,
    200,
  );
  const other = external();
  assert.equal(
    (await fetch(base + "/probe", { headers: { cookie, "x-abi-supabase-token": other.token } }))
      .status,
    401,
  );
  unavailable = true;
  assert.equal(
    (await fetch(base + "/probe", { headers: { cookie, "x-abi-supabase-token": e.token } })).status,
    503,
  );
  unavailable = false;
  assert.equal(
    (await fetch(base + "/probe", { headers: { cookie, "x-abi-supabase-token": e.token } })).status,
    200,
  );
  const next = await exchange(e.token, {});
  assert.equal(((await next.json()) as { user: { id: string } }).user.id, d.user.id);
});
test("matching email cannot claim an existing funded account; linking requires both sessions and CSRF", async () => {
  const e = external();
  const user = store.createUser({
    email: e.identity.email,
    name: "Existing",
    passwordHash: "unused",
  });
  if ("conflict" in user) throw Error();
  const org = store.createOrg("Existing funds", 25_000_000n);
  store.addMembership(user.id, org.id, "owner");
  commerceDatabase()
    .prepare("UPDATE users SET email_verified_at=? WHERE id=?")
    .run(new Date().toISOString(), user.id);
  const legacy = crypto.randomUUID();
  store.createUserSession({ userId: user.id, token: legacy, ttlMs: 3600000 });
  assert.equal((await exchange(e.token, { acceptTerms: true })).status, 409);
  const cookie = `abi_session=${legacy}; abi_csrf=link-csrf`;
  assert.equal((await exchange(e.token, { linkExisting: true }, { cookie })).status, 403);
  const linked = await exchange(
    e.token,
    { linkExisting: true },
    { cookie, "x-abi-csrf": "link-csrf" },
  );
  assert.equal(linked.status, 200);
  assert.equal(((await linked.json()) as { user: { id: string } }).user.id, user.id);
  assert.equal(isExternalOnly(user.id), false);
  const w = ensureWorkspaces(org.id)[0]!;
  assert.equal(viewWorkspace(org.id, String(w.id)).balance.availableUsdc, "25");
});
test("verified social sign-in does not require or consume an enrolled ABI authenticator", async () => {
  const e = external();
  await exchange(e.token, { acceptTerms: true });
  const mapping = commerceDatabase()
    .prepare("SELECT user_id FROM abi_external_identities WHERE subject=?")
    .get(e.identity.id) as { user_id: string };
  const secret = generateSecret();
  store.startMfaEnrolment(mapping.user_id, secret);
  store.confirmMfa(mapping.user_id, 0);
  const signedIn = await exchange(e.token, {});
  assert.equal(signedIn.status, 200);
  assert.equal(store.getMfa(mapping.user_id)?.confirmed, true);
  assert.equal(store.getMfa(mapping.user_id)?.lastStep, 0, "login does not consume TOTP state");
  assert.equal((await exchange("invalid-provider-token", {})).status, 401);
});
test("identity verification fails closed for invalid or malformed upstream results", async () => {
  await assert.rejects(() => verifySupabaseIdentity("invalid", provider));
  const e = external();
  const malformed: typeof fetch = async () => new Response('{"identity":{"id":"wrong"}}');
  await assert.rejects(
    () => verifySupabaseIdentity(e.token, malformed),
    (error: unknown) =>
      !!error && typeof error === "object" && "status" in error && error.status === 503,
  );
});

test("provider rate limits preserve the ABI session as retryable, not unauthorized", async () => {
  const e = external();
  await assert.rejects(
    () => verifySupabaseIdentity(e.token, async () => new Response("{}", { status: 429 })),
    (error: unknown) =>
      !!error && typeof error === "object" && "status" in error && error.status === 503,
  );
});
