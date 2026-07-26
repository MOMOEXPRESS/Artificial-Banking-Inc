/**
 * Password hashing.
 *
 * scrypt from node:crypto — memory-hard, in the standard library, no new
 * dependency to audit. Argon2id would be marginally preferable but needs a
 * native module, and the cost/benefit does not justify it at this size.
 *
 * Stored format: `s2:<N>:<r>:<p>:<saltHex>:<hashHex>`. Parameters travel with
 * the hash so they can be raised later without invalidating existing rows.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

/** ~100ms on commodity hardware; raise N as machines get faster. */
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;
const PREFIX = "s2";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN, {
    ...PARAMS,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    PREFIX,
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join(":");
}

/**
 * Constant-time verification. Returns false rather than throwing on a
 * malformed stored value — a corrupt row must not become an auth bypass or a
 * 500 that leaks which accounts exist.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split(":");
    if (parts.length !== 6 || parts[0] !== PREFIX) return false;
    const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
    const N = Number(nRaw);
    const r = Number(rRaw);
    const p = Number(pRaw);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    // Refuse absurd parameters from a tampered row rather than allocating GBs.
    if (N > 1 << 20 || r > 32 || p > 16) return false;

    const salt = Buffer.from(saltHex!, "hex");
    const expected = Buffer.from(hashHex!, "hex");
    if (salt.length === 0 || expected.length === 0) return false;

    const derived = await scrypt(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Minimum viable password policy. Length dominates composition rules for
 * offline-attack resistance, so require length and reject the handful of
 * strings that show up in every credential-stuffing list.
 */
const OBVIOUS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "qwertyuiop",
  "letmein1",
  "iloveyou",
  "admin123",
  "changeme",
]);

export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "Password must be at least 12 characters.";
  if (password.length > 200) return "Password must be at most 200 characters.";
  if (OBVIOUS.has(password.toLowerCase())) return "That password is too common.";
  return null;
}
