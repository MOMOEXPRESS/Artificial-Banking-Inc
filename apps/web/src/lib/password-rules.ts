/**
 * Client-side mirror of the API's password rules (apps/api/src/auth/password.ts),
 * so the reset and change-password forms can explain a problem before submit.
 * The API stays the authority and re-checks everything.
 */

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 200;

/** A short, non-exhaustive list; the server holds the full one. */
const OBVIOUS = new Set([
  "password",
  "password1",
  "password123",
  "password1234",
  "123456789012",
  "qwertyuiopas",
  "letmein12345",
  "changeme1234",
]);

export const PASSWORD_RULES_HINT = `At least ${PASSWORD_MIN} characters, not a common password.`;

export function newPasswordProblem(next: string, confirm: string): string | null {
  if (!next) return "Enter a new password.";
  if (next.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (next.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  if (OBVIOUS.has(next.toLowerCase())) return "That password is too common.";
  if (next !== confirm) return "New password and confirmation differ.";
  return null;
}
