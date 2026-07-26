/**
 * Vault key encryption at rest (audit finding C4).
 *
 * API keys had been hashed since A13, but the secrets that actually move money
 * were written to the database in plaintext — so a database read, a backup, or
 * a leaked snapshot handed over every organization's funds.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-kek-"));
process.env.POLICYVAULT_DB = join(dir, "kek.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_KEK = "test-key-encryption-key";

const { store } = await import("../store.js");
const { decryptSecret, encryptSecret, isEncrypted, KeyEncryptionError } = await import(
  "./key-encryption.js"
);
const Database = (await import("better-sqlite3")).default;

const ORIGINAL_ENV = process.env.NODE_ENV;
const ORIGINAL_KEK = process.env.ABI_KEK;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_ENV;
  process.env.ABI_KEK = ORIGINAL_KEK;
});

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

const SECRET = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips", () => {
    const ct = encryptSecret(SECRET, "org_1");
    assert.notEqual(ct, SECRET);
    assert.ok(isEncrypted(ct));
    assert.equal(decryptSecret(ct, "org_1"), SECRET);
  });

  it("produces a different ciphertext each time", () => {
    // A fixed IV would make identical keys visibly identical in the database.
    assert.notEqual(encryptSecret(SECRET, "org_1"), encryptSecret(SECRET, "org_1"));
  });

  it("refuses a ciphertext moved to a different org", () => {
    // The org id is authenticated data, so a row cannot be copied from one
    // organization to another to steal its signer.
    const ct = encryptSecret(SECRET, "org_1");
    assert.throws(() => decryptSecret(ct, "org_2"), KeyEncryptionError);
  });

  it("refuses a tampered ciphertext rather than returning garbage", () => {
    const ct = encryptSecret(SECRET, "org_1");
    const parts = ct.split(":");
    const flipped = Buffer.from(parts[3]!, "base64");
    flipped[0] = flipped[0]! ^ 0xff;
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${flipped.toString("base64")}`;
    // Signing with a silently-corrupted key would be worse than failing.
    assert.throws(() => decryptSecret(tampered, "org_1"), KeyEncryptionError);
  });

  it("refuses to decrypt under a different KEK", () => {
    const ct = encryptSecret(SECRET, "org_1");
    process.env.ABI_KEK = "a-completely-different-kek";
    assert.throws(() => decryptSecret(ct, "org_1"), KeyEncryptionError);
  });

  it("passes through legacy plaintext so an existing database still opens", () => {
    assert.equal(isEncrypted(SECRET), false);
    assert.equal(decryptSecret(SECRET, "org_1"), SECRET);
  });

  it("refuses to run in production without a configured KEK", () => {
    process.env.NODE_ENV = "production";
    delete process.env.ABI_KEK;
    // The fallback is a literal in a public repository; silently accepting it
    // would mean real keys encrypted under a known value.
    assert.throws(() => encryptSecret(SECRET, "org_1"), KeyEncryptionError);
  });
});

describe("vault keys in the database", () => {
  it("are never stored in plaintext", () => {
    const org = store.createOrg("Encrypted Co", 0n);

    const raw = new Database(process.env.POLICYVAULT_DB!, { readonly: true })
      .prepare("SELECT private_key FROM vaults WHERE org_id = ?")
      .get(org.id) as { private_key: string };

    assert.ok(isEncrypted(raw.private_key), "stored value must be ciphertext");
    assert.ok(!raw.private_key.startsWith("0x"), "must not look like a raw key");
    assert.equal(raw.private_key.includes(store.getVaultPrivateKey(org.id)!), false);
  });

  it("still yield a usable signing key to the custody boundary", () => {
    const org = store.createOrg("Usable Co", 0n);
    const key = store.getVaultPrivateKey(org.id);
    assert.ok(key, "key must decrypt");
    assert.match(key!, /^0x[0-9a-f]{64}$/i, "must be a well-formed EVM private key");
  });

  it("encrypts the archived key when a vault is rotated", () => {
    const org = store.createOrg("Rotating Co", 0n);
    const before = store.getVaultPrivateKey(org.id);
    store.rotateVaultKey(org.id, "test");

    const raw = new Database(process.env.POLICYVAULT_DB!, { readonly: true })
      .prepare("SELECT private_key FROM vault_key_archive WHERE org_id = ?")
      .get(org.id) as { private_key: string };

    // A retired address may still hold funds, so its key is just as sensitive.
    assert.ok(isEncrypted(raw.private_key));
    assert.equal(decryptSecret(raw.private_key, org.id), before);
    assert.notEqual(store.getVaultPrivateKey(org.id), before, "active key must have changed");
  });

  it("upgrades a plaintext key written by an older build", () => {
    const org = store.createOrg("Legacy Co", 0n);
    const key = store.getVaultPrivateKey(org.id)!;

    // Simulate the pre-C4 on-disk shape.
    const write = new Database(process.env.POLICYVAULT_DB!);
    write.prepare("UPDATE vaults SET private_key = ? WHERE org_id = ?").run(key, org.id);
    write.close();

    // Reads keep working while the row is still plaintext...
    assert.equal(store.getVaultPrivateKey(org.id), key);

    // ...and the boot migration rewrites it encrypted.
    store.reloadForTests();
    const raw = new Database(process.env.POLICYVAULT_DB!, { readonly: true })
      .prepare("SELECT private_key FROM vaults WHERE org_id = ?")
      .get(org.id) as { private_key: string };
    assert.ok(isEncrypted(raw.private_key), "migration must encrypt in place");
    assert.equal(store.getVaultPrivateKey(org.id), key, "and must not change the key");
  });
});
