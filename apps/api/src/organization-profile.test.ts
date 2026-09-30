import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "abi-org-profile-"));
process.env.POLICYVAULT_DB = join(dir, "profile.db");
process.env.ABI_KEY_PEPPER = "profile-test-pepper";
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

it("saves a validated profile without changing its treasury mode", async () => {
  const org = store.createOrg("Before", 0n);
  const url = `${base}/v1/guardian/organization-profile`;
  const headers = {
    authorization: `Bearer ${org.guardianKey}`,
    "content-type": "application/json",
  };
  const bad = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      displayName: "After",
      website: "http://example.com",
    }),
  });
  assert.equal(bad.status, 400);
  assert.equal(store.getOrg(org.id)?.name, "Before");

  const saved = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      displayName: "After",
      legalName: "After Ltd",
      website: "https://example.com",
      workspace: "both",
      defaultCurrencyDisplay: "EUR",
      plan: "enterprise",
      environment: "sandbox",
    }),
  });
  assert.equal(saved.status, 200);
  const read = await fetch(url, { headers });
  const data = (await read.json()) as { environment: string; profile: Record<string, unknown> };
  assert.equal(data.environment, "live");
  assert.equal(data.profile.displayName, "After");
  assert.equal(data.profile.workspace, "both");
  assert.equal(data.profile.defaultCurrencyDisplay, "EUR");
  assert.equal(data.profile.plan, undefined);
  assert.equal(store.getOrg(org.id)?.name, "After");
});
