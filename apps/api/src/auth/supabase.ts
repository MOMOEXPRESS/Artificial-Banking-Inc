import type express from "express";
import { z } from "zod";
import { commerceDatabase, store } from "../store.js";
import { parseCookies, SESSION_COOKIE } from "./session.js";
const identitySchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  email: z.string().email().max(200),
  emailConfirmed: z.literal(true),
  name: z.string().max(80),
  aal: z.enum(["aal1", "aal2"]),
  amr: z.array(z.object({ method: z.string(), timestamp: z.number() }).passthrough()),
});
export type SupabaseIdentity = z.infer<typeof identitySchema>;
export class IdentityError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function verifySupabaseIdentity(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<SupabaseIdentity> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new IdentityError(503, "SSO_UNAVAILABLE", "Social sign-in is not configured yet.");
  if (!/^[A-Za-z0-9_.-]{40,16000}$/.test(token) || token.startsWith("pv_"))
    throw new IdentityError(401, "UNAUTHORIZED", "Sign in again.");
  let response: Response;
  try {
    response = await fetcher(`${url}/functions/v1/abi-user-data`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: '{"tool":"identity"}',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new IdentityError(
      503,
      "IDENTITY_UNAVAILABLE",
      "The identity service is temporarily unavailable. Try again.",
    );
  }
  if (response.status === 429 || response.status >= 500)
    throw new IdentityError(
      503,
      "IDENTITY_UNAVAILABLE",
      "The identity service is temporarily unavailable. Try again.",
    );
  if (!response.ok)
    throw new IdentityError(401, "UNAUTHORIZED", "The sign-in session is invalid or expired.");
  try {
    return z.object({ identity: identitySchema }).parse(await response.json()).identity;
  } catch {
    throw new IdentityError(
      503,
      "IDENTITY_UNAVAILABLE",
      "The identity response could not be verified. Try again.",
    );
  }
}
export function isExternalOnly(userId: string) {
  return !!(
    commerceDatabase()
      .prepare("SELECT external_only FROM abi_external_identities WHERE user_id=?")
      .get(userId) as { external_only: number } | undefined
  )?.external_only;
}
export function externalSessionGuard(fetcher: typeof fetch = fetch): express.RequestHandler {
  return (req, res, next) => {
    if (
      [
        "/health",
        "/ready",
        "/metrics",
        "/v1/auth/logout",
        "/v1/auth/login",
        "/v1/auth/signup",
        "/v1/auth/supabase/exchange",
      ].includes(req.path) ||
      req.header("authorization")?.match(/^Bearer pv_/)
    )
      return next();
    const cookie = parseCookies(req)[SESSION_COOKIE];
    const local = cookie ? store.getUserBySessionToken(cookie) : undefined;
    if (!local) return next();
    const binding = commerceDatabase()
      .prepare("SELECT * FROM abi_external_sessions WHERE session_id=?")
      .get(local.sessionId) as { subject: string; provider_session_id: string } | undefined;
    if (!binding) return next();
    const token = req.header("x-abi-supabase-token");
    if (!token)
      return res.status(401).json({
        error: {
          code: "SSO_SESSION_REQUIRED",
          message: "Sign in again to refresh your identity session.",
        },
      });
    void verifySupabaseIdentity(token, fetcher)
      .then((identity) => {
        if (identity.id !== binding.subject || identity.sessionId !== binding.provider_session_id)
          return res.status(401).json({ error: { code: "SSO_SESSION_MISMATCH" } });
        next();
      })
      .catch((e) => {
        if (e instanceof IdentityError)
          return res.status(e.status).json({ error: { code: e.code, message: e.message } });
        next(e);
      });
  };
}
