import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveBudgetWindow,
  evaluatePolicy,
  templateSoloSwarm,
  type PolicyRules,
} from "./index.js";
const at = Date.parse("2026-11-08T22:40:00Z");
test("calendar periods resolve UTC day, Monday week and month boundaries", () => {
  for (const [period, start, end] of [
    ["day", "2026-11-08T00:00:00Z", "2026-11-09T00:00:00Z"],
    ["week", "2026-11-02T00:00:00Z", "2026-11-09T00:00:00Z"],
    ["month", "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"],
  ] as const) {
    const w = resolveBudgetWindow({ period }, at);
    assert.equal(w.startsAtMs, Date.parse(start));
    assert.equal(w.endsAtMs, Date.parse(end) - 1);
  }
});
test("period rollover resets the window while explicit activation and expiry remain binding", () => {
  const activated = at - 1000,
    expiry = at + 1000,
    w = { period: "month" as const, startsAtMs: activated, endsAtMs: expiry };
  assert.deepEqual(resolveBudgetWindow(w, at), { ...w, startsAtMs: activated, endsAtMs: expiry });
  const next = resolveBudgetWindow({ period: "month" }, Date.parse("2027-01-01T00:00:00Z"));
  assert.equal(next.startsAtMs, Date.parse("2027-01-01T00:00:00Z"));
  assert.equal(next.endsAtMs, Date.parse("2027-02-01T00:00:00Z") - 1);
});
test("recurring opt-out is enforced independently of single-purchase authorization", () => {
  const rules = {
    ...templateSoloSwarm(),
    agentFrozen: false,
    orgFrozen: false,
    spentLast24hMicro: 0n,
    paysLastMinute: 0,
    knownCounterparties: ["merchant.example"],
    walletBalanceMicro: 10_000_000n,
    budgetWindow: { allowRecurringPurchases: false },
    nowMs: at,
  } as PolicyRules;
  const intent = {
    agentId: "a",
    orgId: "o",
    tool: "pay_api" as const,
    amountMicro: 1_000_000n,
    destination: "merchant.example",
    idempotencyKey: "fixture",
  };
  assert.equal(
    evaluatePolicy({ ...intent, recurring: true }, rules).ruleIds[0],
    "recurring_purchases_disabled",
  );
  assert.notEqual(evaluatePolicy(intent, rules).ruleIds[0], "recurring_purchases_disabled");
});
