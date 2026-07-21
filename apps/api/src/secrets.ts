/**
 * A13 — secrets at rest. Plaintext keys are revealed once on create/rotate;
 * SQLite stores only `h1:<sha256(pepper || raw)>`. Auth hashes the bearer and compares.
 */
import { createHash } from "node:crypto";

const HASH_PREFIX = "h1:";

export function keyPepper(): string {
  return process.env.ABI_KEY_PEPPER ?? process.env.POLICYVAULT_KEY_PEPPER ?? "abi-dev-pepper-change-me";
}

export function hashSecret(raw: string): string {
  const digest = createHash("sha256").update(keyPepper()).update("\0").update(raw).digest("hex");
  return `${HASH_PREFIX}${digest}`;
}

/** True when the DB column already holds a hash (or a revoked marker). */
export function isHashedSecret(stored: string): boolean {
  return stored.startsWith(HASH_PREFIX) || stored.startsWith("revoked_");
}

/**
 * Resolve a presented bearer secret against a stored column value.
 * Supports one-shot migration: plaintext rows still match until rehashed.
 */
export function secretMatches(presented: string, stored: string): boolean {
  if (!presented || !stored) return false;
  if (stored.startsWith("revoked_")) return false;
  if (stored.startsWith(HASH_PREFIX)) return hashSecret(presented) === stored;
  return presented === stored;
}

export function lookupHash(presented: string): string {
  return hashSecret(presented);
}
