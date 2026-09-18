/**
 * Session TTL env parsing — empty / garbage / non-positive values must not
 * mint instantly-expired sessions or produce NaN expiry dates.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sessionTtlMsFromEnv } from "./session.js";

describe("sessionTtlMsFromEnv", () => {
  it("defaults to 12 hours when unset", () => {
    assert.equal(sessionTtlMsFromEnv(undefined), 12 * 3600_000);
  });

  it("honours a positive numeric value", () => {
    assert.equal(sessionTtlMsFromEnv("24"), 24 * 3600_000);
  });

  it("falls back on empty, garbage, zero and negative values", () => {
    for (const raw of ["", "  ", "abc", "0", "-1", "NaN"]) {
      assert.equal(sessionTtlMsFromEnv(raw), 12 * 3600_000, `raw=${JSON.stringify(raw)}`);
    }
  });
});
