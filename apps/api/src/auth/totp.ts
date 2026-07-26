/**
 * TOTP (RFC 6238) — second factor for sign-in and step-up on large approvals.
 *
 * Implemented directly on node:crypto rather than pulling a dependency: the
 * algorithm is thirty lines, and an auth primitive is a poor place to inherit
 * someone else's supply chain.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DIGITS = 6;
const PERIOD_SEC = 30;
/** Accept the adjacent steps so a slightly-wrong device clock still works. */
const DRIFT_STEPS = 1;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateSecret(): string {
  const bytes = randomBytes(20); // 160 bits, per RFC 4226
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += B32[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function codeForStep(secret: string, step: number): string {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** Current code — used by tests and by enrolment confirmation. */
export function currentCode(secret: string, atMs = Date.now()): string {
  return codeForStep(secret, Math.floor(atMs / 1000 / PERIOD_SEC));
}

/**
 * Verify a submitted code.
 *
 * Returns the matched step so callers can persist it and refuse replay — a
 * code stays valid for its whole window, and without this a shoulder-surfed
 * code works again inside the same 30 seconds.
 */
export function verifyCode(
  secret: string,
  code: string,
  opts: { atMs?: number; lastUsedStep?: number } = {},
): { ok: true; step: number } | { ok: false } {
  const submitted = code.replace(/\D/g, "");
  if (submitted.length !== DIGITS) return { ok: false };
  const now = Math.floor((opts.atMs ?? Date.now()) / 1000 / PERIOD_SEC);

  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift++) {
    const step = now + drift;
    if (opts.lastUsedStep !== undefined && step <= opts.lastUsedStep) continue;
    const expected = codeForStep(secret, step);
    const a = Buffer.from(expected);
    const b = Buffer.from(submitted);
    if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true, step };
  }
  return { ok: false };
}

/** `otpauth://` URI for authenticator apps / QR codes. */
export function otpauthUri(secret: string, account: string, issuer = "Artificial Banking"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Recovery codes for a lost device. Single-use, hashed at rest by the caller.
 * Without these, losing a phone means losing the organization.
 */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString("hex"); // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
