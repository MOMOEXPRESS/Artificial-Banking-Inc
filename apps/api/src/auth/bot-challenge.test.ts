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
