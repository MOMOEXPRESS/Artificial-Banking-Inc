/**
 * A13 — secrets at rest. Plaintext keys are revealed once on create/rotate;
 * SQLite stores only `h1:<sha256(pepper || raw)>`. Auth hashes the bearer and compares.
 */
import { createHash, createHmac } from "node:crypto";

const HASH_PREFIX = "h1:";

/** Publicly-known fallback. Usable in development, refused in production. */
const DEV_PEPPER = "abi-dev-pepper-change-me";

/**
 * Free-hosting demo fallback.
 *
 * A Render free instance cannot preserve SQLite across restarts, so a deployment
 * with demo bootstrap explicitly enabled is already disposable. Reuse the
 * existing server-only signup token as input keying material and derive
 * purpose-separated secrets with HMAC. This keeps the YC demo operable without
 * committing secrets or requiring a paid disk. Explicit ABI_KEY_PEPPER and
 * ABI_KEK values always take precedence.
 */
export function demoDerivedSecret(purpose: "key-pepper" | "key-encryption"): string | undefined {
  if (process.env.POLICYVAULT_ALLOW_BOOTSTRAP !== "1") return undefined;
  const signupToken = process.env.ABI_SIGNUP_TOKEN?.trim();
  if (!signupToken) return undefined;
  return createHmac("sha256", signupToken)
    .update(`abi-free-demo:${purpose}:v1`)
    .digest("base64");
}

/**
 * Salt for API-key hashing.
 *
 * The fallback is a literal committed to a public repository, so it provides no
 * secrecy at all. Production must supply its own — and must fail loudly rather
 * than silently accept the default, which is how a "temporary" dev value ends
 * up protecting real credentials.
 */
export function keyPepper(): string {
  const configured = process.env.ABI_KEY_PEPPER?.trim() || process.env.POLICYVAULT_KEY_PEPPER?.trim();
  if (configured) return configured;
  const demoFallback = demoDerivedSecret("key-pepper");
  if (demoFallback) return demoFallback;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ABI_KEY_PEPPER is required in production. Set it to 32+ random bytes and restart; " +
        "the built-in development value is public and provides no protection.",
    );
  }
  return DEV_PEPPER;
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
 *
 * The plaintext branch exists only for one-shot migration of rows written
 * before hashing landed; `migrateSecretsAtRest()` rehashes them at boot, so it
 * should never fire in practice. It is refused outright in production rather
 * than left as a permanent downgrade path.
 */
export function secretMatches(presented: string, stored: string): boolean {
  if (!presented || !stored) return false;
  if (stored.startsWith("revoked_")) return false;
  if (stored.startsWith(HASH_PREFIX)) return hashSecret(presented) === stored;
  if (process.env.NODE_ENV === "production") return false;
  return presented === stored;
}

export function lookupHash(presented: string): string {
  return hashSecret(presented);
}
