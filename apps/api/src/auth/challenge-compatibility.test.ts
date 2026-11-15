import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
const directory = mkdtempSync(join(tmpdir(), "abi-no-captcha-"));
process.env.POLICYVAULT_DB = join(directory, "test.db");
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_KEY_PEPPER = "no-captcha-fixture";
// Existing credentials must not silently reactivate a removed integration.
process.env.TURNSTILE_SECRET = "inactive-fixture";
process.env.TURNSTILE_SITEKEY = "inactive-fixture";
const { app } = await import("../index.js");
after(() => rmSync(directory, { recursive: true, force: true }));
test("legacy clients see CAPTCHA disabled and auth handlers run without challenge tokens", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  try {
    const config = await fetch(base + "/v1/auth/challenge");
    assert.equal(config.status, 200);
    assert.equal(config.headers.get("cache-control"), "no-store");
    assert.deepEqual(await config.json(), { enabled: false, sitekey: null });
    for (const path of ["/v1/auth/login", "/v1/partner/auth/login"]) {
      const response = await fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "missing@example.invalid", password: "not-a-real-password" }),
      });
      assert.equal(response.status, 401);
      const body = (await response.json()) as { error: { code: string } };
      assert.notEqual(body.error.code, "BOT_VERIFICATION_REQUIRED");
    }
    for (const path of ["/v1/auth/signup", "/v1/partner/auth/signup"]) {
      const response = await fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.notEqual(response.status, 200);
      assert.notEqual(response.status, 201);
      const body = (await response.json()) as { error: { code: string } };
      assert.notEqual(body.error.code, "BOT_VERIFICATION_REQUIRED");
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
