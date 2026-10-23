import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertAuthRuntimeReady, decryptSecret, encryptSecret } from "./key-encryption.js";
import { demoDerivedSecret, demoSecretsPath, keyPepper } from "../secrets.js";

const KEYS = [
  "NODE_ENV",
  "POLICYVAULT_ALLOW_BOOTSTRAP",
  "ABI_SIGNUP_TOKEN",
  "ABI_KEY_PEPPER",
  "POLICYVAULT_KEY_PEPPER",
  "ABI_KEK",
  "ABI_DEMO_SECRETS_PATH",
  "ABI_DEMO_DERIVE_FROM_SIGNUP_TOKEN",
] as const;

const original = new Map(KEYS.map((key) => [key, process.env[key]]));
let tempDir: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "abi-secrets-"));
  process.env.ABI_DEMO_SECRETS_PATH = join(tempDir, "abi-demo-secrets.json");
});

afterEach(() => {
  for (const key of KEYS) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("free demo runtime secrets", () => {
  it("persists independent random pepper and KEK — not derived from the signup token", () => {
    process.env.NODE_ENV = "production";
    process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "1";
    process.env.ABI_SIGNUP_TOKEN = "test-only-signup-token-with-enough-entropy";
    delete process.env.ABI_KEY_PEPPER;
    delete process.env.POLICYVAULT_KEY_PEPPER;
    delete process.env.ABI_KEK;
    delete process.env.ABI_DEMO_DERIVE_FROM_SIGNUP_TOKEN;

    const pepper = demoDerivedSecret("key-pepper");
    const encryptionKey = demoDerivedSecret("key-encryption");
    assert.ok(pepper);
    assert.ok(encryptionKey);
    assert.notEqual(pepper, encryptionKey);
    // Same path must reload the same material (disk-backed, restart-safe).
    assert.equal(demoDerivedSecret("key-pepper"), pepper);
    assert.equal(demoDerivedSecret("key-encryption"), encryptionKey);
    assert.equal(keyPepper(), pepper);
    assert.match(demoSecretsPath(), /abi-demo-secrets\.json$/);
    assert.doesNotThrow(() => assertAuthRuntimeReady());

    const ciphertext = encryptSecret("vault-private-key", "org_test");
    assert.equal(decryptSecret(ciphertext, "org_test"), "vault-private-key");

    // A second org's ciphertext uses the same KEK but distinct AAD — still round-trips.
    assert.equal(decryptSecret(encryptSecret("other-key", "org_other"), "org_other"), "other-key");
  });

  it("does not derive secrets from ABI_SIGNUP_TOKEN by default", async () => {
    process.env.NODE_ENV = "production";
    process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "1";
    process.env.ABI_SIGNUP_TOKEN = "shared-root-secret";
    delete process.env.ABI_KEY_PEPPER;
    delete process.env.ABI_KEK;
    delete process.env.ABI_DEMO_DERIVE_FROM_SIGNUP_TOKEN;

    const pepper = demoDerivedSecret("key-pepper")!;
    const kek = demoDerivedSecret("key-encryption")!;
    // HMAC(signup, purpose) would be deterministic across machines; random disk
    // secrets must not equal that construction.
    const { createHmac } = await import("node:crypto");
    const legacyPepper = createHmac("sha256", "shared-root-secret")
      .update("abi-free-demo:key-pepper:v1")
      .digest("base64");
    const legacyKek = createHmac("sha256", "shared-root-secret")
      .update("abi-free-demo:key-encryption:v1")
      .digest("base64");
    assert.notEqual(pepper, legacyPepper);
    assert.notEqual(kek, legacyKek);
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
