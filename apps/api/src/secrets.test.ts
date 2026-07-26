import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { hashSecret, isHashedSecret, keyPepper, secretMatches } from "./secrets.js";

const ORIGINAL_ENV = process.env.NODE_ENV;
const ORIGINAL_PEPPER = process.env.ABI_KEY_PEPPER;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_ENV;
  if (ORIGINAL_PEPPER === undefined) delete process.env.ABI_KEY_PEPPER;
  else process.env.ABI_KEY_PEPPER = ORIGINAL_PEPPER;
});

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

  it("still matches legacy plaintext rows outside production", () => {
    process.env.NODE_ENV = "development";
    assert.equal(secretMatches("pv_agent_old", "pv_agent_old"), true);
    assert.equal(isHashedSecret("pv_agent_old"), false);
    assert.equal(isHashedSecret(hashSecret("x")), true);
  });

  it("refuses the plaintext comparison path in production", () => {
    // The boot-time migration rehashes legacy rows, so this branch should never
    // fire in production. Leaving it enabled there would be a permanent
    // downgrade path from hashed to plaintext credential comparison.
    process.env.NODE_ENV = "production";
    process.env.ABI_KEY_PEPPER = "test-pepper";
    assert.equal(secretMatches("pv_agent_old", "pv_agent_old"), false);
    // Hashed comparison still works.
    assert.equal(secretMatches("pv_agent_old", hashSecret("pv_agent_old")), true);
  });

  it("refuses to boot production without a configured pepper", () => {
    // The built-in fallback is a literal in a public repository, so silently
    // accepting it would mean real credentials salted with a known value.
    process.env.NODE_ENV = "production";
    delete process.env.ABI_KEY_PEPPER;
    delete process.env.POLICYVAULT_KEY_PEPPER;
    assert.throws(() => keyPepper(), /ABI_KEY_PEPPER is required in production/);

    process.env.ABI_KEY_PEPPER = "a-real-production-pepper";
    assert.equal(keyPepper(), "a-real-production-pepper");
  });

  it("falls back to the dev pepper outside production", () => {
    process.env.NODE_ENV = "development";
    delete process.env.ABI_KEY_PEPPER;
    delete process.env.POLICYVAULT_KEY_PEPPER;
    assert.equal(typeof keyPepper(), "string");
  });
});
