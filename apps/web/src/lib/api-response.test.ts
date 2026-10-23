import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRecord, okJson, sessionRejected } from "./api-response";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("okJson", () => {
  it("returns the payload for 2xx", async () => {
    assert.deepEqual(await okJson(json(200, { org: { id: "o1" } })), { org: { id: "o1" } });
    assert.deepEqual(await okJson(json(202, { outcome: "review" })), { outcome: "review" });
  });

  it("returns null for a 429 error body instead of storing it as data", async () => {
    // Regression: `{ error }` saved as `org` crashed the header on `org.org.name`.
    const body = { error: { code: "RATE_LIMITED", message: "Over 120 requests/minute" } };
    assert.equal(await okJson(json(429, body)), null);
    assert.equal(await okJson(json(502, body)), null);
    assert.equal(await okJson(json(401, body)), null);
  });

  it("returns null for a non-JSON success body", async () => {
    assert.equal(await okJson(new Response("<html>waking up</html>", { status: 200 })), null);
  });
});

describe("sessionRejected", () => {
  it("only signs out on an explicit 401", () => {
    assert.equal(sessionRejected(401), true);
    for (const s of [403, 429, 500, 502, 503, 504]) assert.equal(sessionRejected(s), false);
  });
});

describe("isRecord", () => {
  it("distinguishes objects from arrays and null", () => {
    assert.equal(isRecord({}), true);
    assert.equal(isRecord([]), false);
    assert.equal(isRecord(null), false);
  });
});
