import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeHitlCategories } from "@policyvault/common";

describe("normalizeHitlCategories", () => {
  it("maps legacy UI labels onto IntentTool ids", () => {
    assert.deepEqual(normalizeHitlCategories(["pay_api", "pay_address", "x402", "escrow"]), [
      "pay_api",
      "pay",
      "escrow_lock",
    ]);
  });

  it("drops unknowns and dedupes", () => {
    assert.deepEqual(normalizeHitlCategories(["withdraw", "nope", "withdraw", "pay"]), [
      "withdraw",
      "pay",
    ]);
  });

  it("tolerates non-arrays", () => {
    assert.deepEqual(normalizeHitlCategories(undefined), []);
    assert.deepEqual(normalizeHitlCategories(null), []);
  });
});
