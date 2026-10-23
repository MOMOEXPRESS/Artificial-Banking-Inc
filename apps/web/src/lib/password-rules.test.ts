import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { newPasswordProblem } from "./password-rules";

describe("newPasswordProblem", () => {
  it("accepts a long, matching password", () => {
    assert.equal(newPasswordProblem("brand-new-password-9", "brand-new-password-9"), null);
  });
  it("rejects empty, short, long, common and mismatched", () => {
    assert.match(newPasswordProblem("", "")!, /Enter/);
    assert.match(newPasswordProblem("short", "short")!, /12/);
    assert.match(newPasswordProblem("x".repeat(201), "x".repeat(201))!, /200/);
    assert.match(newPasswordProblem("Password1234", "Password1234")!, /common/);
    assert.match(newPasswordProblem("brand-new-password-9", "brand-new-password-8")!, /differ/);
  });
});
