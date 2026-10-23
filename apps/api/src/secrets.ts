/**
 * A13 — secrets at rest. Plaintext keys are revealed once on create/rotate;
 * SQLite stores only `h1:<sha256(pepper || raw)>`. Auth hashes the bearer and compares.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const HASH_PREFIX = "h1:";

/** Publicly-known fallback. Usable in development, refused in production. */
const DEV_PEPPER = "abi-dev-pepper-change-me";

type DemoPurpose = "key-pepper" | "key-encryption";

type DiskSecrets = {
  "key-pepper"?: string;
  "key-encryption"?: string;
};

/**
 * Path for auto-generated demo secrets. Prefer the SQLite directory so a
 * Render/Fly disk that keeps the DB also keeps the pepper/KEK across restarts
 * without deriving either from ABI_SIGNUP_TOKEN (which would let one leaked
 * signup token decrypt every vault key).
 */
export function demoSecretsPath(): string {
  const configured = process.env.ABI_DEMO_SECRETS_PATH?.trim();
  if (configured) return configured;
  const dbPath = process.env.POLICYVAULT_DB?.trim();
  if (dbPath) return join(dirname(dbPath), "abi-demo-secrets.json");
  return join(process.cwd(), "apps/api/data/abi-demo-secrets.json");
}

function readDiskSecrets(): DiskSecrets {
  const path = demoSecretsPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as DiskSecrets;
  } catch {
    return {};
  }
}

function writeDiskSecrets(secrets: DiskSecrets): void {
  const path = demoSecretsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Free-hosting demo fallback.
 *
 * Previously both the pepper and the vault KEK were HMAC-derived from
 * `ABI_SIGNUP_TOKEN`, so one leaked signup token decrypted every wallet key.
 * Demo mode now loads or generates independent random secrets on disk under
 * the database directory (no card, no KMS). Explicit `ABI_KEY_PEPPER` /
 * `ABI_KEK` always win. Production without bootstrap still fail-closes.
 *
 * Real KMS/HSM envelope encryption remains deferred (paid); see SECURITY.md.
 */
export function demoDerivedSecret(purpose: DemoPurpose): string | undefined {
  if (process.env.POLICYVAULT_ALLOW_BOOTSTRAP !== "1") return undefined;
  // Cloudflare Workers: no durable local disk for abi-demo-secrets.json and no
  // silent derive-from-signup-token. Require ABI_KEY_PEPPER / ABI_KEK secrets.
  if (process.env.ABI_RUNTIME === "cloudflare-workers") {
    return undefined;
  }

  // Legacy escape hatch: only when explicitly opted in. Default path never
  // derives cryptography from the signup token.
  if (process.env.ABI_DEMO_DERIVE_FROM_SIGNUP_TOKEN === "1") {
    const signupToken = process.env.ABI_SIGNUP_TOKEN?.trim();
    if (!signupToken) return undefined;
    return createHmac("sha256", signupToken)
      .update(`abi-free-demo:${purpose}:v1`)
      .digest("base64");
  }

  const existing = readDiskSecrets();
  const cached = existing[purpose];
  if (cached) return cached;

  const generated = randomBytes(32).toString("base64");
  const next: DiskSecrets = { ...existing, [purpose]: generated };
  writeDiskSecrets(next);
  return generated;
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
  const configured =
    process.env.ABI_KEY_PEPPER?.trim() || process.env.POLICYVAULT_KEY_PEPPER?.trim();
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
