import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_SCENARIOS, demoQuote } from "./marketplace-demo-data";

test("hiking gift combines two sellers and shipping within the owner budget", () => {
  const s = DEMO_SCENARIOS.find(s => s.id === "hiking")!;
  const q = demoQuote(s.products, s.budget, s.approvalAbove);
  assert.equal(q.total, 8600);
  assert.equal(q.valid, true);
  assert.equal(new Set(q.items.map(p => p.seller)).size, 2);
  assert.equal(q.needsApproval, false);
});
test("headphone purchase waits for owner approval", () => {
  const q = demoQuote(["headphones"], 16000, 10000);
  assert.equal(q.valid, true);
  assert.equal(q.needsApproval, true);
});
test("digital checkout has no shipping while unavailable or over-budget items block checkout", () => {
  assert.equal(demoQuote(["software"], 3000, 10000).shipping, 0);
  assert.equal(demoQuote(["desk"], 10000, 10000).valid, false);
  assert.equal(demoQuote(["headphones"], 10000, 10000).valid, false);
  assert.equal(demoQuote([], 10000, 10000).valid, false);
});
