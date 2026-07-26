/**
 * Envelope encryption for vault private keys.
 *
 * Until now these were written to the database in plaintext. API keys had been
 * hashed at rest, but the secrets that actually move money had not — so a
 * database read, a backup, or a leaked snapshot handed over every organization's
 * funds. That was the last unaddressed Critical finding from the July 2026
 * audit (C4).
 *
 * This is not a substitute for managed custody (roadmap P4-T1). It removes
 * "plaintext at rest" while ABI still holds keys at all; the KEK lives in the
 * environment, so an attacker with both the database *and* the process
 * environment still wins. Real custody moves the key out of this process
 * entirely.
 *
 * Format: `v1:<ivB64>:<tagB64>:<ciphertextB64>` — AES-256-GCM, fresh 96-bit IV
 * per encryption. The org id is bound in as additional authenticated data, so
 * a ciphertext cannot be moved from one org's row to another's.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "v1:";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

/** Publicly-known development fallback. Refused in production. */
const DEV_KEK = "abi-dev-kek-not-for-production";

export class KeyEncryptionError extends Error {}

/**
 * Resolve the key-encryption key.
 *
 * Accepts any length and derives 32 bytes via SHA-256, so an operator can paste
 * a passphrase or a base64 blob without it silently truncating.
 */
function kek(): Buffer {
  const configured = process.env.ABI_KEK?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new KeyEncryptionError(
        "ABI_KEK is required in production. Generate one with " +
          "`node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"` " +
          "and set it before starting the API. Vault keys cannot be decrypted without it — " +
          "back it up somewhere you will not lose it.",
      );
    }
    return createHash("sha256").update(DEV_KEK).digest();
  }
  return createHash("sha256").update(configured).digest();
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, kek(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/**
 * Decrypt, or pass through a value written before encryption existed.
 *
 * Legacy plaintext is tolerated so an existing database keeps working; the boot
 * migration re-writes those rows encrypted. A ciphertext that fails to
 * authenticate throws rather than returning garbage — silently signing with a
 * corrupted key would be worse than refusing.
 */
export function decryptSecret(stored: string, aad: string): string {
  if (!isEncrypted(stored)) return stored;
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new KeyEncryptionError("Malformed encrypted secret.");
  }
  const [ivB64, tagB64, ctB64] = parts;
  try {
    const decipher = createDecipheriv(ALGO, kek(), Buffer.from(ivB64!, "base64"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tagB64!, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64!, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (e) {
    throw new KeyEncryptionError(
      "Could not decrypt a vault key. This usually means ABI_KEK changed or does not match the " +
        `one used to write it — the key material is not recoverable without it. (${
          e instanceof Error ? e.message : String(e)
        })`,
    );
  }
}
