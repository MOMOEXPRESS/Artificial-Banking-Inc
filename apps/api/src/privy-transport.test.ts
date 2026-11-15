import assert from "node:assert/strict";
import { test } from "node:test";
import { privyFetch } from "./privy-transport.js";
test("Privy uses Workers-compatible manual redirects and never follows credentials to another origin", async () => {
  let calls = 0;
  const fake: typeof fetch = async (_input, init) => {
    calls++;
    assert.equal(init?.redirect, "manual");
    return new Response(null, {
      status: 302,
      headers: { location: "https://another.example.invalid" },
    });
  };
  await assert.rejects(
    privyFetch(
      "https://api.privy.io/v1/wallets",
      { headers: { authorization: "Basic local-fixture" } },
      fake,
    ),
    /unexpected redirect/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    privyFetch("https://another.example.invalid/v1/wallets", {}, fake),
    /origin is not allowed/,
  );
  assert.equal(calls, 1);
  const response = await privyFetch("https://api.privy.io/v1/wallets", {}, async (_input, init) => {
    assert.equal(init?.redirect, "manual");
    return Response.json({ ok: true });
  });
  assert.equal(response.status, 200);
});
