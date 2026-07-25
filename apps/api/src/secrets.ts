/**
 * A13 — secrets at rest. Plaintext keys are revealed once on create/rotate;
 * SQLite stores only `h1:<sha256(pepper || raw)>`. Auth hashes the bearer and compares.
 */
import { createHash } from "node:crypto";

const HASH_PREFIX = "h1:";

export function keyPepper(): string {
  return process.env.ABI_KEY_PEPPER ?? process.env.POLICYVAULT_KEY_PEPPER ?? "abi-dev-pepper-change-me";
}

function digestWithPepper(pepper: string, raw: string): string {
  return createHash("sha256").update(pepper).update("\0").update(raw).digest("hex");
}

export function hashSecret(raw: string): string {
  return `${HASH_PREFIX}${digestWithPepper(keyPepper(), raw)}`;
}

/** True when the DB column already holds a hash (or a revoked marker). */
export function isHashedSecret(stored: string): boolean {
  return stored.startsWith(HASH_PREFIX) || stored.startsWith("revoked_");
}

/**
 * Resolve a presented bearer secret against a stored column value.
 * Supports one-shot migration: plaintext rows still match until rehashed.
 * Also accepts hashes produced under known legacy peppers (Vercel embed default).
 */
export function secretMatches(presented: string, stored: string): boolean {
  if (!presented || !stored) return false;
  if (stored.startsWith("revoked_")) return false;
  if (stored.startsWith(HASH_PREFIX)) {
    return lookupHashes(presented).includes(stored);
  }
  return presented === stored;
}

/** Current pepper hash (for writes / primary lookup). */
export function lookupHash(presented: string): string {
  return hashSecret(presented);
}

/**
 * All hashes that might match a presented secret under current + legacy peppers.
 * Prevents permanent 401 when ABI_KEY_PEPPER differs across local vs Vercel embed.
 */
export function lookupHashes(presented: string): string[] {
  const peppers = new Set<string>();
  peppers.add(keyPepper());
  const legacy = process.env.ABI_KEY_PEPPER_LEGACY?.trim();
  if (legacy) peppers.add(legacy);
  // Historical embed / API defaults — keep verifying against both forever.
  peppers.add("abi-vercel-demo-pepper");
  peppers.add("abi-dev-pepper-change-me");
  return [...peppers].map((p) => `${HASH_PREFIX}${digestWithPepper(p, presented)}`);
}
