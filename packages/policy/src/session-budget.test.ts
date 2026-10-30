import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MoneyIntent } from "@policyvault/common";
import { evaluatePolicy, templateSoloSwarm } from "./index.js";

function rules(extra: Record<string, unknown> = {}) {
  return {
    ...templateSoloSwarm(),
    newCounterpartyCooldownHours: 0,
    knownCounterparties: ["api.openai.com"],
    spentLast24hMicro: 0n,
    paysLastMinute: 0,
    agentFrozen: false,
    orgFrozen: false,
    ...extra,
  };
}

const payApi: MoneyIntent = {
  agentId: "agt_1",
  orgId: "org_1",
  idempotencyKey: "k",
  tool: "pay_api",
  destination: "api.openai.com",
  amountMicro: 3_000_000n,
};

describe("x402 session budget", () => {
  it("denies past the session total with the numbers that bound", () => {
    const d = evaluatePolicy(
      payApi,
      rules({ sessionBudgetMicro: 5_000_000n, sessionSpentMicro: 3_000_000n }),
    );
    assert.equal(d.outcome, "deny");
    assert.deepEqual(d.ruleIds, ["session_budget"]);
    assert.equal(d.limits?.cap, 5_000_000n);
    assert.equal(d.limits?.used, 3_000_000n);
    assert.equal(d.limits?.remaining, 2_000_000n);
    assert.equal(d.limits?.window, "session");
  });

  it("allows exactly up to the budget", () => {
    const d = evaluatePolicy(
      { ...payApi, amountMicro: 2_000_000n },
      rules({ sessionBudgetMicro: 5_000_000n, sessionSpentMicro: 3_000_000n }),
    );
    assert.equal(d.outcome, "allow");
  });

  it("a zero budget refuses everything", () => {
    const d = evaluatePolicy(
      { ...payApi, amountMicro: 1n },
      rules({ sessionBudgetMicro: 0n, sessionSpentMicro: 0n }),
    );
    assert.deepEqual(d.ruleIds, ["session_budget"]);
  });

  it("only applies to x402 pay_api, and only when a budget is set", () => {
    assert.equal(evaluatePolicy(payApi, rules()).outcome, "allow");
    const onchain = evaluatePolicy(
      { ...payApi, tool: "pay", destination: "0x1111111111111111111111111111111111111111" },
      rules({
        sessionBudgetMicro: 0n,
        addressAllowlist: ["0x1111111111111111111111111111111111111111"],
        knownCounterparties: ["0x1111111111111111111111111111111111111111"],
      }),
    );
    assert.notDeepEqual(onchain.ruleIds, ["session_budget"]);
  });
});
