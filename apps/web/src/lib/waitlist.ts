/**
 * Waitlist form logic, kept free of React so it can be unit-tested.
 * The API answers the same way for new and repeat joins (no enumeration).
 */

export type WaitlistSource = "landing" | "waitlist-page";

export type WaitlistResult =
  | { kind: "joined"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "rate_limited"; message: string }
  | { kind: "error"; message: string };

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** Client-side check mirroring the API (the API is the authority). */
export function looksLikeEmail(raw: string): boolean {
  const email = raw.trim().toLowerCase();
  return email.length >= 6 && email.length <= 254 && EMAIL_RE.test(email) && !email.includes("..");
}

/**
 * Where the visitor came from: an explicit `?ref=` (e.g. `/waitlist?ref=hn`)
 * wins over `document.referrer`. Same-site referrers are dropped.
 */
export function waitlistReferrer(search: string, documentReferrer: string, host: string): string {
  const ref = new URLSearchParams(search).get("ref")?.trim();
  if (ref) return `ref:${ref.slice(0, 64)}`;
  if (!documentReferrer) return "";
  try {
    const u = new URL(documentReferrer);
    if (u.host === host) return "";
    return `${u.origin}${u.pathname}`.slice(0, 512);
  } catch {
    return "";
  }
}

export function waitlistPayload(args: {
  email: string;
  source: WaitlistSource;
  referrer: string;
  honeypot: string;
}): Record<string, string> {
  return {
    email: args.email.trim(),
    source: args.source,
    ...(args.referrer && { referrer: args.referrer }),
    // Always sent, empty for humans. Bots that fill every field get a quiet no-op.
    website: args.honeypot,
  };
}

export function parseWaitlistResponse(status: number, body: unknown): WaitlistResult {
  const b = (body ?? {}) as { ok?: boolean; message?: string; error?: { message?: string } };
  if (status === 200 && b.ok) {
    return { kind: "joined", message: b.message || "You're on the list." };
  }
  if (status === 400) {
    return { kind: "invalid", message: b.error?.message || "Enter a valid email address." };
  }
  if (status === 429) {
    return { kind: "rate_limited", message: "Too many attempts from here. Try again in an hour." };
  }
  return { kind: "error", message: "Something went wrong. Please try again in a minute." };
}
