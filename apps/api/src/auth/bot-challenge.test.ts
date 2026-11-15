import assert from "node:assert/strict";
import { after, test } from "node:test";
import { verifyBotChallenge } from "./bot-challenge.js";
const previous = { secret: process.env.TURNSTILE_SECRET, hosts: process.env.TURNSTILE_HOSTNAMES };
process.env.TURNSTILE_SECRET = "unit-test-secret";
process.env.TURNSTILE_HOSTNAMES = "console.example.invalid";
after(() => {
  if (previous.secret === undefined) delete process.env.TURNSTILE_SECRET;
  else process.env.TURNSTILE_SECRET = previous.secret;
  if (previous.hosts === undefined) delete process.env.TURNSTILE_HOSTNAMES;
  else process.env.TURNSTILE_HOSTNAMES = previous.hosts;
});
const fake = (body: unknown, status = 200) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
test("bot verification fails closed on missing tokens, host/action mismatch and provider failures", async () => {
  assert.equal(await verifyBotChallenge(undefined, "buyer_login", fake({ success: true })), false);
  assert.equal(
    await verifyBotChallenge(
      "token",
      "buyer_login",
      fake({ success: true, hostname: "attacker.invalid", action: "buyer_login" }),
    ),
    false,
  );
  assert.equal(
    await verifyBotChallenge(
      "token",
      "buyer_login",
      fake({ success: true, hostname: "console.example.invalid", action: "seller_login" }),
    ),
    false,
  );
  assert.equal(
    await verifyBotChallenge(
      "token",
      "buyer_login",
      fake({ success: true, hostname: "console.example.invalid", action: "buyer_login" }, 503),
    ),
    false,
  );
  assert.equal(
    await verifyBotChallenge("token", "buyer_login", (async () => {
      throw new Error("offline");
    }) as typeof fetch),
    false,
  );
});
test("only a successful provider result for this exact frontend and action passes", async () => {
  assert.equal(
    await verifyBotChallenge(
      "token",
      "buyer_login",
      fake({ success: true, hostname: "console.example.invalid", action: "buyer_login" }),
    ),
    true,
  );
  assert.equal(
    await verifyBotChallenge(
      "replayed",
      "buyer_login",
      fake({ success: false, "error-codes": ["timeout-or-duplicate"] }),
    ),
    false,
  );
});

test("explicit historical production hosts pass; other deployments and local hosts stay blocked", async () => {
  const additional = process.env.TURNSTILE_ADDITIONAL_HOSTNAMES;
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  process.env.TURNSTILE_ADDITIONAL_HOSTNAMES = "historical-production.example.invalid";
  const check = (hostname: string, action = "buyer_login") =>
    verifyBotChallenge("token", "buyer_login", fake({ success: true, hostname, action }));
  try {
    assert.equal(await check("historical-production.example.invalid"), true);
    assert.equal(await check("console.example.invalid"), true);
    assert.equal(await check("another-deployment.example.invalid"), false);
    assert.equal(await check("historical-production.example.invalid.attacker.invalid"), false);
    assert.equal(await check("historical-production.example.invalid", "seller_login"), false);
    process.env.TURNSTILE_ADDITIONAL_HOSTNAMES += ",localhost";
    assert.equal(await check("localhost"), false);
    assert.equal(await check("console.example.invalid"), false);
  } finally {
    if (additional === undefined) delete process.env.TURNSTILE_ADDITIONAL_HOSTNAMES;
    else process.env.TURNSTILE_ADDITIONAL_HOSTNAMES = additional;
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
});
