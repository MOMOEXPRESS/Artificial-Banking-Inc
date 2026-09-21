import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  assertAuthRuntimeReady,
  decryptSecret,
  encryptSecret,
} from "./key-encryption.js";
import { demoDerivedSecret, keyPepper } from "../secrets.js";

const KEYS = [
  "NODE_ENV",
  "POLICYVAULT_ALLOW_BOOTSTRAP",
  "ABI_SIGNUP_TOKEN",
  "ABI_KEY_PEPPER",
  "POLICYVAULT_KEY_PEPPER",
  "ABI_KEK",
] as const;

const original = new Map(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("free demo runtime secrets", () => {
  it("derives purpose-separated production secrets from the existing signup token", () => {
    process.env.NODE_ENV = "production";
    process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "1";
    process.env.ABI_SIGNUP_TOKEN = "test-only-signup-token-with-enough-entropy";
    delete process.env.ABI_KEY_PEPPER;
    delete process.env.POLICYVAULT_KEY_PEPPER;
    delete process.env.ABI_KEK;

    const pepper = demoDerivedSecret("key-pepper");
    const encryptionKey = demoDerivedSecret("key-encryption");
    assert.ok(pepper);
    assert.ok(encryptionKey);
    assert.notEqual(pepper, encryptionKey);
    assert.equal(keyPepper(), pepper);
    assert.doesNotThrow(() => assertAuthRuntimeReady());

    const ciphertext = encryptSecret("vault-private-key", "org_test");
    assert.equal(decryptSecret(ciphertext, "org_test"), "vault-private-key");
  });

  it("keeps normal production fail-closed when demo bootstrap is not enabled", () => {
    process.env.NODE_ENV = "production";
    process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";
    process.env.ABI_SIGNUP_TOKEN = "present-but-not-authorized-for-fallback";
    delete process.env.ABI_KEY_PEPPER;
    delete process.env.POLICYVAULT_KEY_PEPPER;
    delete process.env.ABI_KEK;

    assert.throws(() => keyPepper(), /ABI_KEY_PEPPER is required in production/);
    assert.throws(() => assertAuthRuntimeReady(), /ABI_KEY_PEPPER is required in production/);
  });

  it("prefers explicitly configured production secrets", () => {
    process.env.NODE_ENV = "production";
    process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "1";
    process.env.ABI_SIGNUP_TOKEN = "fallback-input";
    process.env.ABI_KEY_PEPPER = "explicit-pepper";
    process.env.ABI_KEK = "explicit-kek";

    assert.equal(keyPepper(), "explicit-pepper");
    assert.doesNotThrow(() => assertAuthRuntimeReady());
  });
});
