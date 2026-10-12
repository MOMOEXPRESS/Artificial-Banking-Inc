import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasBudgetOpsSetup } from "./overview-setup";

describe("Overview budget and ops setup", () => {
  it("keeps setup visible until a group is linked to an existing budget", () => {
    assert.equal(hasBudgetOpsSetup([], []), false);
    assert.equal(hasBudgetOpsSetup([{ id: "research", status: "active" }], []), false);
    assert.equal(
      hasBudgetOpsSetup(
        [{ id: "research", status: "active" }],
        [{ budgetId: "finance", status: "active" }],
      ),
      false,
    );
  });

  it("completes setup without requiring funds, an agent or a payment", () => {
    assert.equal(
      hasBudgetOpsSetup(
        [{ id: "research", status: "active" }],
        [{ budgetId: "research", status: "active" }],
      ),
      true,
    );
  });

  it("ignores archived pairs but treats a temporary freeze as configured", () => {
    const budget = [{ id: "research", status: "active" }];
    assert.equal(hasBudgetOpsSetup(budget, [{ budgetId: "research", status: "archived" }]), false);
    assert.equal(
      hasBudgetOpsSetup(
        [{ id: "research", status: "archived" }],
        [{ budgetId: "research", status: "active" }],
      ),
      false,
    );
    assert.equal(hasBudgetOpsSetup(budget, [{ budgetId: "research", status: "frozen" }]), true);
  });
});
