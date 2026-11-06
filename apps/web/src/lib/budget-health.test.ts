import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { budgetCapUsdc, budgetRefreshNote } from "./budget-health";

describe("budgetCapUsdc", () => {
  it("prefers the org value, falls back to the policy, and is null when neither loaded", () => {
    assert.equal(budgetCapUsdc("50", "40"), "50");
    assert.equal(budgetCapUsdc(undefined, "40"), "40");
    assert.equal(budgetCapUsdc(null, undefined), null);
    assert.equal(budgetCapUsdc("not-a-number", "25"), "25");
  });
});

describe("budgetRefreshNote", () => {
  it("names what failed and when the shown figures are from", () => {
    const note = budgetRefreshNote(
      {
        failures: [{ path: "/abi-api/v1/guardian/org", status: 502, reason: "HTTP 502", at: 0 }],
        lastOkAt: 1,
      },
      () => "21:04",
    );
    assert.equal(note, "Couldn't refresh: org (HTTP 502). Showing figures from 21:04.");
  });
});
