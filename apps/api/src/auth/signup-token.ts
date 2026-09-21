import { timingSafeEqual } from "node:crypto";
import type express from "express";

/**
 * Gate routes that mint a root credential. Production refuses those routes
 * unless ABI_SIGNUP_TOKEN is configured; callers present it through the
 * server-injected x-abi-signup-token header.
 */
export function signupTokenProblem(req: express.Request): string | null {
  const expected = process.env.ABI_SIGNUP_TOKEN?.trim();
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return "Self-serve organization creation requires ABI_SIGNUP_TOKEN to be configured.";
    }
    return null;
  }
  const presented = req.header("x-abi-signup-token")?.trim();
  if (!presented || !timingSafeEqualStr(presented, expected)) {
    return "Missing or invalid x-abi-signup-token.";
  }
  return null;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
