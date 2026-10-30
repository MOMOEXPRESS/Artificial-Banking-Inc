import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PollState } from "./bounded-poll";
import { insightsLoadView } from "./insights-load";

const ok = (at = 1): PollState => ({
  status: "ok",
  failures: 0,
  lastOkAt: at,
  lastFailure: null,
  nextAt: null,
});
const bad = (status: "retrying" | "failed", failures: number, nextAt: number | null = null) =>
  ({
    status,
    failures,
    lastOkAt: null,
    lastFailure: { path: "/v1/guardian/burn", status: 500, reason: "HTTP 500", at: 0 },
    nextAt,
  }) as PollState;

describe("insightsLoadView", () => {
  it("stays quiet when everything answers", () => {
    const v = insightsLoadView({ vendors: ok(), burn: ok(), anomalies: ok(), economics: ok() });
    assert.equal(v.show, false);
  });

  it("does not flash a banner for one transient failure", () => {
    const v = insightsLoadView({ vendors: ok(), burn: bad("retrying", 1, 2000) }, 0);
    assert.equal(v.show, false);
  });

  it("names the part and the next attempt while retrying", () => {
    const v = insightsLoadView({ vendors: ok(), burn: bad("retrying", 2, 4000) }, 0);
    assert.equal(v.show, true);
    assert.equal(v.gaveUp, false);
    assert.match(v.hint, /^Forecast didn't answer\. Retrying automatically in about 4s\.$/);
    assert.equal(v.failures.length, 1);
  });

  it("says retries stopped once a part gave up, and never claims it keeps retrying", () => {
    const v = insightsLoadView({ vendors: ok(), burn: bad("failed", 5), economics: bad("failed", 5) });
    assert.equal(v.gaveUp, true);
    assert.match(v.hint, /Forecast and P&L didn't load after 5 attempts/);
    assert.match(v.hint, /automatic retries have stopped/);
    assert.match(v.hint, /Press Retry/);
    assert.doesNotMatch(v.hint, /keeps retrying/);
  });
});
