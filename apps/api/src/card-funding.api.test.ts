import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { before, after, it } from "node:test";
const dir = mkdtempSync(join(tmpdir(), "abi-funding-http-"));
process.env.POLICYVAULT_DB = join(dir, "test.db");
process.env.ABI_KEY_PEPPER = "funding-http-test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.ABI_CARD_FUNDING_ENABLED = "0";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_fixture_only";
const { store } = await import("./store.js");
const { app } = await import("./index.js");
let base = "",
  server: ReturnType<typeof app.listen>;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});
const call = (path: string, key: string, method = "GET", body?: unknown) =>
  fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
it("billing HTTP routes enforce authentication, owner permissions and provider readiness", async () => {
  assert.equal((await call("/v1/guardian/billing", "invalid")).status, 401);
  const org = store.createOrg("Funding HTTP", 0n),
    viewer = store.createGuardian(org.id, "Viewer", "viewer");
  const read = await call("/v1/guardian/billing", org.guardianKey);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("cache-control"), "no-store");
  const summary = (await read.json()) as {
    cardFundingAvailable: boolean;
    creditCents: number;
    settlementCredit: boolean;
  };
  assert.equal(summary.cardFundingAvailable, false);
  assert.equal(summary.creditCents, 0);
  assert.equal(summary.settlementCredit, false);
  assert.equal(
    (
      await call("/v1/guardian/billing/checkout", viewer.guardianKey, "POST", {
        requestKey: "fixture_request",
        amountCents: 1000,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/v1/guardian/billing/checkout", org.guardianKey, "POST", {
        requestKey: "fixture_request",
        amountCents: 1000,
      })
    ).status,
    503,
  );
});
it("webhook HTTP parser verifies the exact raw body and rejects modified bytes", async () => {
  const body = JSON.stringify({
      id: "evt_http_fixture",
      type: "unknown.fixture",
      data: { object: {} },
    }),
    t = String(Math.floor(Date.now() / 1000));
  const signature = `t=${t},v1=${createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET!)
    .update(t + "." + body)
    .digest("hex")}`;
  const send = (value: string) =>
    fetch(base + "/v1/billing/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body: value,
    });
  assert.equal((await send(body + " ")).status, 400);
  assert.equal((await send(body)).status, 200);
  assert.equal(((await (await send(body)).json()) as { duplicate: boolean }).duplicate, true);
});
it("session replacement HTTP route isolates tenants and rejects viewer mutation", async () => {
  const org = store.createOrg("Key HTTP", 0n),
    other = store.createOrg("Other HTTP", 0n),
    viewer = store.createGuardian(org.id, "Viewer", "viewer"),
    a = store.createAgent(org.id, "Shopper");
  const key = store.createSessionKey({ orgId: org.id, agentId: a.agentId, scopes: ["read"] }),
    path = `/v1/guardian/session-keys/${key.id}/replace`;
  assert.equal((await call(path, other.guardianKey, "POST", {})).status, 404);
  assert.equal((await call(path, viewer.guardianKey, "POST", {})).status, 403);
  const replaced = await call(path, org.guardianKey, "POST", {});
  assert.equal(replaced.status, 200);
  assert.equal(replaced.headers.get("cache-control"), "no-store");
  const value = (await replaced.json()) as { sessionKey: { token: string } };
  assert.ok(store.getSessionByToken(value.sessionKey.token));
  assert.equal(store.getSessionByToken(key.token!), undefined);
});
