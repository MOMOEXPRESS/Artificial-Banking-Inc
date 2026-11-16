/**
 * Session TTL parsing.
 *
 * `ABI_SESSION_TTL_HOURS` is set on a hosting dashboard, where an empty or
 * mistyped value is one click away. Before the fallback, `""` produced a 0ms
 * TTL (login 200ed, then every call 401ed — sessions were born expired) and
 * `"abc"` produced NaN (login 500ed serialising the expiry date).
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const ORIGINAL = process.env.ABI_SESSION_TTL_HOURS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ABI_SESSION_TTL_HOURS;
  else process.env.ABI_SESSION_TTL_HOURS = ORIGINAL;
});

const { resolveSessionTtlMs, SESSION_TTL_MS } = await import("./session.js");

describe("resolveSessionTtlMs", () => {
  it("defaults to 12h when unset", () => {
    delete process.env.ABI_SESSION_TTL_HOURS;
    assert.equal(resolveSessionTtlMs(), 12 * 3600_000);
  });

  it("honours a valid value", () => {
    process.env.ABI_SESSION_TTL_HOURS = "2";
    assert.equal(resolveSessionTtlMs(), 2 * 3600_000);
  });

  it("falls back to 12h on empty, garbage, zero, or negative values", () => {
    for (const bad of ["", "abc", "0", "-3", "Infinity"]) {
      process.env.ABI_SESSION_TTL_HOURS = bad;
      assert.equal(resolveSessionTtlMs(), 12 * 3600_000, `expected fallback for ${JSON.stringify(bad)}`);
    }
  });

  it("exports a positive finite TTL", () => {
    assert.ok(Number.isFinite(SESSION_TTL_MS) && SESSION_TTL_MS > 0);
  });
});
