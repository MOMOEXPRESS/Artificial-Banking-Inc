import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toChallengeCheck } from "./seller-catalog";

describe("toChallengeCheck", () => {
  it("gives checks saved by older builds an empty problems list", () => {
    const check = toChallengeCheck({
      httpStatus: 402,
      expectedPayTo: "0x11",
      expectedNetwork: "base-sepolia",
      expectedPriceUsdc: "0.25",
    });
    assert.deepEqual(check?.problems, []);
    assert.equal(check?.offered, undefined);
    assert.equal(check?.httpStatus, 402);
  });

  it("keeps a current check as it is", () => {
    const check = toChallengeCheck({ httpStatus: 402, problems: ["wrong payee"], offered: [] });
    assert.deepEqual(check?.problems, ["wrong payee"]);
    assert.deepEqual(check?.offered, []);
  });

  it("returns null for missing or malformed values", () => {
    assert.equal(toChallengeCheck(null), null);
    assert.equal(toChallengeCheck("not json"), null);
    assert.equal(toChallengeCheck([1, 2]), null);
  });
});
