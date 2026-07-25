import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { hashSecret, isHashedSecret, secretMatches } from "./secrets.js";

describe("A13 secrets", () => {
  it("hashes deterministically with pepper", () => {
    process.env.ABI_KEY_PEPPER = "test-pepper";
    const a = hashSecret("pv_agent_abc");
    const b = hashSecret("pv_agent_abc");
    assert.equal(a, b);
    assert.ok(a.startsWith("h1:"));
    assert.notEqual(a, "pv_agent_abc");
  });

  it("matches presented plaintext against hash", () => {
    process.env.ABI_KEY_PEPPER = "test-pepper";
    const raw = "pv_guardian_xyz";
    const stored = hashSecret(raw);
    assert.equal(secretMatches(raw, stored), true);
    assert.equal(secretMatches("wrong", stored), false);
    assert.equal(secretMatches(raw, "revoked_x"), false);
  });

  it("still matches legacy plaintext rows", () => {
    assert.equal(secretMatches("pv_agent_old", "pv_agent_old"), true);
    assert.equal(isHashedSecret("pv_agent_old"), false);
    assert.equal(isHashedSecret(hashSecret("x")), true);
  });

  it("verifies hashes produced under the historical Vercel embed pepper", () => {
    process.env.ABI_KEY_PEPPER = "abi-dev-pepper-change-me";
    const raw = "pv_guardian_legacycheck";
    const embedHash =
      "h1:" +
      createHash("sha256").update("abi-vercel-demo-pepper").update("\0").update(raw).digest("hex");
    assert.equal(secretMatches(raw, embedHash), true);
  });
});
