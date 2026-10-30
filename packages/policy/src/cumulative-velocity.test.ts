import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MoneyIntent } from "@policyvault/common";
import {
  deriveMonthlyMaxMicro,
  evaluatePolicy,
  resolvePolicy,
  withDerivedMonthlyMax,
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
      assert.equal(t.monthlyMaxMicro, t.dailyMaxMicro * 30n, `${id}: monthly = 30 × daily`);
      assert.ok(t.maxPaysPerHour !== undefined && t.maxPaysPerHour >= t.maxPaysPerMinute, id);
    }
  });

  it("denies past the rolling 30-day cap with the numbers that bound", () => {
    // Solo daily $50 → derived monthly $1,500.
    const d = evaluatePolicy(pay, rules({ spentLast30dMicro: 1_498_000_000n }));
    assert.equal(d.outcome, "deny");
    assert.deepEqual(d.ruleIds, ["monthly_max"]);
    assert.deepEqual(d.limits, {
      ruleId: "monthly_max",
      unit: "usdc",
      attempted: 5_000_000n,
      cap: 1_500_000_000n,
      used: 1_498_000_000n,
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

  it("omitting the hourly field disables that cap (back-compat for stored policies)", () => {
    const r = rules({ paysLastHour: 10_000 });
    delete (r as { maxPaysPerHour?: number }).maxPaysPerHour;
    assert.equal(evaluatePolicy(pay, r).outcome, "allow");
  });
});

describe("monthly cap derives from the daily cap (30 × daily)", () => {
  it("derives 30 × daily, always at least the daily cap", () => {
    assert.equal(deriveMonthlyMaxMicro(2_000_000_000n), 60_000_000_000n);
    assert.equal(deriveMonthlyMaxMicro(3_000_000_000n), 90_000_000_000n);
    for (const daily of [1n, 500_000n, 50_000_000n, 3_000_000_000n]) {
      assert.ok(deriveMonthlyMaxMicro(daily) >= daily);
    }
  });

  it("a stale stored $500 monthly never blocks a $2,000 / $3,000 daily", () => {
    for (const daily of [2_000_000_000n, 3_000_000_000n]) {
      const r = rules({
        perTxMaxMicro: daily,
        dailyMaxMicro: daily,
        hitlAboveMicro: daily, // keep the payment in the allow band
        monthlyMaxMicro: 500_000_000n, // old Solo template default
        spentLast24hMicro: 0n,
        spentLast30dMicro: 600_000_000n, // already past the stale $500
      });
      const big = { ...pay, amountMicro: daily - 1n };
      assert.equal(evaluatePolicy(big, r).outcome, "allow", `daily ${daily}`);
    }
  });

  it("still denies past 30 × daily", () => {
    const r = rules({ spentLast30dMicro: deriveMonthlyMaxMicro(50_000_000n) - 1_000_000n });
    const d = evaluatePolicy(pay, r);
    assert.deepEqual(d.ruleIds, ["monthly_max"]);
    assert.equal(d.limits?.cap, 1_500_000_000n);
  });

  it("withDerivedMonthlyMax and resolvePolicy recompute monthly from the winning daily", () => {
    const stale = {
      ...templateSoloSwarm(),
      dailyMaxMicro: 2_000_000_000n,
      monthlyMaxMicro: 500_000_000n,
    };
    assert.equal(withDerivedMonthlyMax(stale).monthlyMaxMicro, 60_000_000_000n);
    assert.equal(resolvePolicy(stale).effective.monthlyMaxMicro, 60_000_000_000n);
    const { effective, provenance } = resolvePolicy(stale, { dailyMaxMicro: 3_000_000_000n });
    assert.equal(effective.monthlyMaxMicro, 90_000_000_000n);
    assert.equal(provenance.monthlyMaxMicro, "agent");
  });
});
