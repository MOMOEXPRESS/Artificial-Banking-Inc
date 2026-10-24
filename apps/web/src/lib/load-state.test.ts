import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeFailure,
  describeThrown,
  fetchWithTimeout,
  shortPath,
  shouldShowLoadError,
  summarizeFailures,
} from "./load-state";

describe("fetchWithTimeout", () => {
  it("aborts a request that never answers and names it a timeout", async () => {
    const hang: typeof fetch = (_i, init) =>
      new Promise((_r, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    await assert.rejects(
      fetchWithTimeout("/abi-api/v1/guardian/burn", {}, 20, hang),
      (e: Error) => {
        assert.equal(e.name, "TimeoutError");
        return true;
      },
    );
  });

  it("passes a fast response straight through", async () => {
    const ok: typeof fetch = async () => new Response("{}", { status: 200 });
    const res = await fetchWithTimeout("/x", {}, 1000, ok);
    assert.equal(res.status, 200);
  });
});

describe("failure descriptions", () => {
  it("reads the API error code from a 429 body", async () => {
    const res = new Response(JSON.stringify({ error: { code: "RATE_LIMITED" } }), { status: 429 });
    const f = await describeFailure("/abi-api/v1/guardian/burn", res);
    assert.equal(f.reason, "RATE_LIMITED");
    assert.equal(f.status, 429);
    // The caller can still read the body.
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "RATE_LIMITED");
  });

  it("falls back to the status for a non-JSON error page", async () => {
    const f = await describeFailure("/p", new Response("<html>", { status: 504 }));
    assert.equal(f.reason, "HTTP 504");
  });

  it("labels timeouts and network errors", () => {
    const t = new Error("x");
    t.name = "TimeoutError";
    assert.equal(describeThrown("/p", t).reason, "timeout");
    assert.equal(describeThrown("/p", new TypeError("fetch failed")).reason, "network");
  });

  it("summarizes without query strings or proxy prefix", () => {
    assert.equal(shortPath("/abi-api/v1/guardian/activity?limit=80"), "/v1/guardian/activity");
    assert.equal(
      summarizeFailures([
        { path: "/v1/guardian/burn", status: 429, reason: "RATE_LIMITED", at: 0 },
        { path: "/v1/guardian/anomalies", status: 0, reason: "timeout", at: 0 },
      ]),
      "burn (RATE_LIMITED), anomalies (timeout)",
    );
  });
});

describe("shouldShowLoadError", () => {
  it("never once loaded", () => {
    assert.equal(shouldShowLoadError({ failures: 9, startedAt: 0, loaded: true }), false);
  });
  it("shows after the first failure by default", () => {
    assert.equal(shouldShowLoadError({ failures: 1, startedAt: Date.now(), loaded: false }), true);
  });
  it("waits for N failures when asked, unless the wait is long", () => {
    const now = 100_000;
    assert.equal(
      shouldShowLoadError({ failures: 1, startedAt: now - 1000, loaded: false }, now, {
        minFailures: 2,
      }),
      false,
    );
    assert.equal(
      shouldShowLoadError({ failures: 1, startedAt: now - 20_000, loaded: false }, now, {
        minFailures: 2,
      }),
      true,
    );
  });
  it("keeps waiting while nothing has failed", () => {
    assert.equal(shouldShowLoadError({ failures: 0, startedAt: 0, loaded: false }, 99_999), false);
  });
});
