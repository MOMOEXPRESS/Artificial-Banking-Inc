import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectSellerSession } from "./seller-session.js";
test("seller outages and malformed bodies never become signed-out states", async () => {
  for (const r of [
    new Response("outage", { status: 503 }),
    new Response("limited", { status: 429 }),
    new Response("blocked", { status: 403 }),
    Response.json({}),
  ])
    assert.equal((await inspectSellerSession(async () => r)).status, "unavailable");
  assert.equal(
    (
      await inspectSellerSession(async () => {
        throw Error("offline");
      })
    ).status,
    "unavailable",
  );
});
test("seller session distinguishes a real 401 from an authenticated response", async () => {
  assert.equal(
    (await inspectSellerSession(async () => new Response("", { status: 401 }))).status,
    "unauthorized",
  );
  const result = await inspectSellerSession(async () =>
    Response.json({
      partner: { id: "p", name: "Seller", email: "seller@example.invalid" },
      org: { id: "seller", name: "Shop", kind: "seller", status: "active" },
    }),
  );
  assert.equal(result.status, "authenticated");
});
