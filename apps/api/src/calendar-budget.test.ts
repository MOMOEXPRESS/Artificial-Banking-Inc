import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluatePolicy } from "@policyvault/policy";
const dir = mkdtempSync(join(tmpdir(), "abi-calendar-cap-"));
process.env.POLICYVAULT_DB = join(dir, "test.db");
process.env.ABI_KEY_PEPPER = "calendar-budget-fixture";
const { store } = await import("./store.js");
const { rulesFor } = await import("./engine.js");
after(() => rmSync(dir, { recursive: true, force: true }));
test("workspace period cap sums all agents, isolates tenants and resets at the UTC boundary", () => {
  const realNow = Date.now;
  let stamp = Date.parse("2026-11-08T22:00:00Z");
  Date.now = () => stamp;
  try {
    const org = store.createOrg("Shared cap", 0n),
      other = store.createOrg("Other tenant", 0n),
      budget = store.createDepartment(org.id, "Shared budget"),
      a = store.createAgent(org.id, "First", budget.id),
      b = store.createAgent(org.id, "Second", budget.id),
      c = store.createAgent(other.id, "Other");
    store.recordPay(a.agentId, 2_000_000n, org.id);
    store.recordPay(b.agentId, 3_000_000n, org.id);
    store.recordPay(c.agentId, 50_000_000n, other.id);
    store.setPolicyTemplate(org.id, {
      ...store.getPolicyTemplate(org.id),
      budgetWindow: {
        period: "week",
        scope: "workspace",
        totalMaxMicro: 10_000_000n,
        label: "Shared",
        allowRecurringPurchases: false,
      },
    });
    const rules = rulesFor(a.agentId, org.id, "merchant.example");
    assert.equal(rules.windowSpentMicro, 5_000_000n);
    const decision = evaluatePolicy(
      {
        agentId: a.agentId,
        orgId: org.id,
        tool: "pay_api",
        amountMicro: 6_000_000n,
        destination: "merchant.example",
        idempotencyKey: "cap-test",
      },
      {
        ...rules,
        perTxMaxMicro: 10_000_000n,
        dailyMaxMicro: 100_000_000n,
        walletBalanceMicro: 100_000_000n,
      },
    );
    assert.ok(decision.ruleIds.includes("budget_window_exhausted"), decision.ruleIds.join(","));
    stamp = Date.parse("2026-11-09T00:00:00Z");
    assert.equal(rulesFor(a.agentId, org.id).windowSpentMicro, 0n);
  } finally {
    Date.now = realNow;
  }
});
