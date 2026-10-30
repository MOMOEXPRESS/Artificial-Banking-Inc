/**
 * Proof that a seller controls the origin of an x402 endpoint they list.
 *
 * Matching the 402's payTo is not proof: the PAYMENT-REQUIRED header is public,
 * so anyone can copy a payee into their own profile. Before an offer on the
 * seller's own server can go live, pause, gate or be paid through ABI, the
 * seller serves a per-org token at a well-known path on the endpoint's origin:
 *
 *   GET https://seller.example/.well-known/abi-seller-verification
 *   abi-seller-verification=<token>
 *
 * One file may carry several tokens (one per line) when more than one ABI org
 * legitimately sells from the same origin. ABI-hosted offers need no proof.
 */
import { createHash } from "node:crypto";
import { fetchNoRedirect, outboundUrlProblem } from "./outbound-url.js";
import { keyPepper } from "./secrets.js";
import { endpointOrigin } from "./store.js";

export const OWNERSHIP_WELL_KNOWN_PATH = "/.well-known/abi-seller-verification";
export const OWNERSHIP_TOKEN_PREFIX = "abi-seller-verification=";

/** Stable per (seller org, origin); derived, so nothing secret is stored. */
export function ownershipToken(orgId: string, origin: string): string {
  return createHash("sha256")
    .update(keyPepper())
    .update("\0seller-origin\0")
    .update(orgId)
    .update("\0")
    .update(origin.toLowerCase())
    .digest("hex")
    .slice(0, 40);
}

export interface OwnershipInstructions {
  origin: string;
  wellKnownUrl: string;
  /** The exact line to serve (text/plain) at `wellKnownUrl`. */
  record: string;
}

export function ownershipInstructions(
  orgId: string,
  endpointUrl: string,
): OwnershipInstructions | null {
  const origin = endpointOrigin(endpointUrl);
  if (!origin) return null;
  return {
    origin,
    wellKnownUrl: `${origin}${OWNERSHIP_WELL_KNOWN_PATH}`,
    record: `${OWNERSHIP_TOKEN_PREFIX}${ownershipToken(orgId, origin)}`,
  };
}

const VERIFY_USER_AGENT = "ABI-Verify/1.0 (+https://artificial-banking-inc-web.vercel.app)";

export type OwnershipResult =
  | { ok: true; origin: string; instructions: OwnershipInstructions }
  | { ok: false; problem: string; instructions: OwnershipInstructions | null };

/** Fetch the origin's well-known file and look for this org's exact token line. */
export async function proveOriginControl(
  orgId: string,
  endpointUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OwnershipResult> {
  const instructions = ownershipInstructions(orgId, endpointUrl);
  if (!instructions) {
    return { ok: false, problem: "The endpoint URL does not parse.", instructions: null };
  }
  const blocked = outboundUrlProblem(instructions.wellKnownUrl, "Ownership check");
  if (blocked) return { ok: false, problem: blocked, instructions };
  let res: Response;
  try {
    res = await fetchNoRedirect(
      instructions.wellKnownUrl,
      {
        method: "GET",
        signal: AbortSignal.timeout(8_000),
        headers: { accept: "text/plain", "user-agent": VERIFY_USER_AGENT },
      },
      "Ownership check",
      fetchImpl,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    return {
      ok: false,
      problem: `Could not read ${instructions.wellKnownUrl} (${message}).`,
      instructions,
    };
  }
  let body = "";
  try {
    body = (await res.text()).slice(0, 8_000);
  } catch {
    body = "";
  }
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (res.status !== 200 || !lines.includes(instructions.record)) {
    return {
      ok: false,
      problem: `Prove you control ${instructions.origin}: serve the line "${instructions.record}" at ${instructions.wellKnownUrl} (got HTTP ${res.status}${res.status === 200 ? " without your token" : ""}).`,
      instructions,
    };
  }
  return { ok: true, origin: instructions.origin, instructions };
}
