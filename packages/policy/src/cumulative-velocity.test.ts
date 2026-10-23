import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MoneyIntent } from "@policyvault/common";
import {
  evaluatePolicy,
  listPolicyTemplateCatalog,
  policyTemplateById,
  templateSoloSwarm,
} from "./index.js";

function rules(extra: Record<string, unknown> = {}) {
  return {
    ...templateSoloSwarm(),
    knownCounterparties: ["api.openai.com"],
    spentLast24hMicro: 0n,
    paysLastMinute: 0,
    agentFrozen: false,
    orgFrozen: false,
    ...extra,
  };
}

const pay: MoneyIntent = {
  agentId: "agt_1",
  orgId: "org_1",
  idempotencyKey: "k",
  tool: "pay_api",
  destination: "api.openai.com",
  amountMicro: 5_000_000n,
};

describe("cumulative and velocity caps", () => {
  it("every built-in template ships monthly and hourly defaults that nest above daily / per-minute", () => {
    for (const { id } of listPolicyTemplateCatalog()) {
      const t = policyTemplateById(id);
      assert.ok(t.monthlyMaxMicro !== undefined && t.monthlyMaxMicro >= t.dailyMaxMicro, id);
      assert.ok(t.maxPaysPerHour !== undefined && t.maxPaysPerHour >= t.maxPaysPerMinute, id);
    }
  });

  it("denies past the rolling 30-day cap with the numbers that bound", () => {
    const d = evaluatePolicy(pay, rules({ spentLast30dMicro: 498_000_000n }));
    assert.equal(d.outcome, "deny");
    assert.deepEqual(d.ruleIds, ["monthly_max"]);
    assert.deepEqual(d.limits, {
      ruleId: "monthly_max",
      unit: "usdc",
      attempted: 5_000_000n,
      cap: 500_000_000n,
      used: 498_000_000n,
      remaining: 2_000_000n,
      window: "30d",
    });
  });

  it("allows under the monthly cap", () => {
    assert.equal(evaluatePolicy(pay, rules({ spentLast30dMicro: 100_000_000n })).outcome, "allow");
  });

  it("denies once the hourly payment count is reached", () => {
    const d = evaluatePolicy(pay, rules({ paysLastHour: 60 }));
    assert.equal(d.outcome, "deny");
    assert.deepEqual(d.ruleIds, ["velocity_hourly"]);
    assert.equal(d.limits?.unit, "count");
    assert.equal(d.limits?.cap, 60n);
    assert.equal(d.limits?.remaining, 0n);
    assert.equal(evaluatePolicy(pay, rules({ paysLastHour: 59 })).outcome, "allow");
  });

  it("omitting the fields disables the caps (back-compat for stored policies)", () => {
    const r = rules({ spentLast30dMicro: 10_000_000_000n, paysLastHour: 10_000 });
    delete (r as { monthlyMaxMicro?: bigint }).monthlyMaxMicro;
    delete (r as { maxPaysPerHour?: number }).maxPaysPerHour;
    assert.equal(evaluatePolicy(pay, r).outcome, "allow");
  });
});
