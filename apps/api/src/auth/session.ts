/**
 * Session cookies for the console.
 *
 * The guardian key previously lived in browser `localStorage`, never expired,
 * and could not be rotated — so any XSS meant permanent, total organization
 * compromise. Sessions are now httpOnly cookies: JavaScript cannot read them,
 * they expire, and they can be revoked server-side.
 *
 * Cookies are parsed by hand rather than adding `cookie-parser`: it is fifteen
 * lines, and the dependency surface on an auth path is worth avoiding.
 */
import { randomBytes } from "node:crypto";
import type express from "express";

export const SESSION_COOKIE = "abi_session";
export const SESSION_TTL_MS = Number(process.env.ABI_SESSION_TTL_HOURS ?? 12) * 3600_000;

/** CSRF companion: readable by JS so the client can echo it in a header. */
export const CSRF_COOKIE = "abi_csrf";
export const CSRF_HEADER = "x-abi-csrf";

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

export function parseCookies(req: express.Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function secure(): boolean {
  return process.env.NODE_ENV === "production";
}

function serialize(
  name: string,
  value: string,
  opts: { maxAgeMs: number; httpOnly: boolean },
): string {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    // Lax rather than Strict: the console is a same-site SPA, and Strict breaks
    // returning to the app from an emailed invitation link.
    "SameSite=Lax",
    `Max-Age=${Math.floor(opts.maxAgeMs / 1000)}`,
  ];
  if (opts.httpOnly) bits.push("HttpOnly");
  if (secure()) bits.push("Secure");
  return bits.join("; ");
}

export function setSessionCookies(res: express.Response, sessionToken: string, csrfToken: string) {
  res.append("Set-Cookie", serialize(SESSION_COOKIE, sessionToken, {
    maxAgeMs: SESSION_TTL_MS,
    httpOnly: true,
  }));
  res.append("Set-Cookie", serialize(CSRF_COOKIE, csrfToken, {
    maxAgeMs: SESSION_TTL_MS,
    // Deliberately readable: the client must echo it back in a header, which
    // a cross-site attacker cannot do.
    httpOnly: false,
  }));
}

export function clearSessionCookies(res: express.Response) {
  for (const name of [SESSION_COOKIE, CSRF_COOKIE]) {
    res.append(
      "Set-Cookie",
      `${name}=; Path=/; SameSite=Lax; Max-Age=0${secure() ? "; Secure" : ""}${
        name === SESSION_COOKIE ? "; HttpOnly" : ""
      }`,
    );
  }
}

/**
 * Double-submit CSRF check for cookie-authenticated mutations.
 *
 * Bearer-authenticated callers are exempt: a token that must be attached
 * deliberately is not sent automatically by a browser, so there is nothing to
 * forge. Only ambient cookie credentials need this.
 */
export function csrfProblem(req: express.Request): string | null {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  const cookies = parseCookies(req);
  const cookieToken = cookies[CSRF_COOKIE];
  const headerToken = req.header(CSRF_HEADER);
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return "Missing or mismatched CSRF token.";
  }
  return null;
}
