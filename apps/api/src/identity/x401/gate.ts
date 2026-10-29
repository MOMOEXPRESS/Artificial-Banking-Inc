/**
 * The x401 gate at ABI's hosted x402 checkout. Call it before issuing a 402
 * challenge and again, with `paid: true`, before facilitator verify/settle.
 * A failure returns the HTTP response to send; the caller must stop there, so
 * no payment is verified or settled and no paid content is served.
 */
import { createHash } from "node:crypto";
import { x401Store } from "../../store.js";
import { loadX401Config } from "./config.js";
import { X401Verifier, type VerifiedIdentity, type X401Context } from "./verifier.js";
import { encodeErrorObject, PROOF_REQUEST, PROOF_RESPONSE, PROOF_RESULT } from "./wire.js";

export interface GateResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type GateOutcome =
  { ok: true; identity: VerifiedIdentity } | { ok: false; response: GateResponse };

let override: X401Verifier | null | undefined;
let cached: { key: string; verifier: X401Verifier | null; reason: string } | undefined;

/** Tests inject a verifier built from test-only keys and anchors. `undefined` restores env config. */
export function setX401VerifierForTests(v: X401Verifier | null | undefined): void {
  override = v;
}

const CONFIG_KEYS = [
  "X401_ENABLED",
  "X401_ENVIRONMENT",
  "X401_CLIENT_ID",
  "X401_CLIENT_NAME",
  "X401_SIGNING_JWK",
  "X401_SCOPE",
  "X401_EXPECTED_ORIGINS",
  "X401_REQUEST_AUDIENCE",
  "X401_TRUSTED_ISSUERS",
  "X401_CHALLENGE_TTL_SECONDS",
  "X401_KB_MAX_AGE_SECONDS",
  "X401_CLOCK_SKEW_SECONDS",
  "X401_RESULT_URI_ORIGINS",
];

/** The configured verifier, or why there is none. Re-read when the env changes. */
export function currentX401Verifier(): { verifier: X401Verifier | null; reason: string } {
  if (override !== undefined)
    return { verifier: override, reason: "x401 verifier disabled for this test" };
  // Hash, so the cache key never holds the signing key in clear.
  const key = createHash("sha256")
    .update(CONFIG_KEYS.map((k) => `${k}=${process.env[k] ?? ""}`).join("\n"))
    .digest("hex");
  if (cached?.key !== key) {
    const loaded = loadX401Config();
    cached = loaded.ok
      ? { key, verifier: new X401Verifier(loaded.config, x401Store), reason: "" }
      : { key, verifier: null, reason: loaded.reason };
  }
  return { verifier: cached.verifier, reason: cached.reason };
}

function headerValue(getHeader: (name: string) => string | undefined): string | undefined {
  return getHeader(PROOF_RESPONSE.toLowerCase()) ?? getHeader(PROOF_RESPONSE);
}

function audit(
  ctx: X401Context,
  stage: "challenge" | "precheck" | "checkout",
  extra: Record<string, string | undefined>,
): void {
  try {
    x401Store.recordAudit({
      offerId: ctx.offerId,
      sellerOrgId: ctx.sellerOrgId,
      callerOrgId: ctx.callerOrgId,
      callerAgentId: ctx.callerAgentId,
      stage,
      outcome: extra.outcome as "issued" | "verified" | "rejected" | "unavailable",
      errorCode: extra.errorCode,
      issuer: extra.issuer,
      vct: extra.vct,
      holderKeySha256: extra.holderKeySha256,
    });
  } catch (err) {
    console.error("x401 audit write failed:", err instanceof Error ? err.message : "unknown");
  }
}

const json = (
  status: number,
  headers: Record<string, string>,
  code: string,
  message: string,
  extra = {},
): GateResponse => ({
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  body: { error: { code, message, ...extra } },
});

export async function x401CheckoutGate(
  ctx: X401Context,
  getHeader: (name: string) => string | undefined,
  paid: boolean,
): Promise<GateOutcome> {
  const stage = paid ? "checkout" : "precheck";
  const { verifier, reason } = currentX401Verifier();
  if (!verifier) {
    audit(ctx, stage, { outcome: "unavailable", errorCode: "verifier_unavailable" });
    console.error("x401 verifier unavailable:", reason);
    return {
      ok: false,
      response: json(
        503,
        {},
        "IDENTITY_VERIFIER_UNAVAILABLE",
        "This offer requires identity verification, which is not available right now. Nothing was charged.",
      ),
    };
  }
  const proof = headerValue(getHeader);
  try {
    if (!proof) {
      const header = await verifier.challenge(ctx);
      audit(ctx, "challenge", { outcome: "issued" });
      return {
        ok: false,
        response: json(
          401,
          { [PROOF_REQUEST]: header },
          "IDENTITY_PROOF_REQUIRED",
          "This offer requires an x401 identity proof before payment. Fulfil PROOF-REQUEST and retry with PROOF-RESPONSE.",
        ),
      };
    }
    const result = await verifier.verify(proof, ctx, paid);
    if (!result.ok) {
      audit(ctx, stage, {
        outcome: result.status === 503 ? "unavailable" : "rejected",
        errorCode: result.code,
      });
      return {
        ok: false,
        response: json(
          result.status,
          { [PROOF_RESULT]: encodeErrorObject(result.code, result.description) },
          result.status === 503 ? "IDENTITY_VERIFIER_UNAVAILABLE" : "IDENTITY_PROOF_REJECTED",
          `${result.description} Nothing was charged.`,
          { x401Error: result.code },
        ),
      };
    }
    const id = result.identity;
    audit(ctx, stage, {
      outcome: "verified",
      issuer: id.issuer,
      vct: id.vct,
      holderKeySha256: createHash("sha256").update(id.holderKeyThumbprint).digest("hex"),
    });
    return { ok: true, identity: id };
  } catch (err) {
    // Store or crypto runtime failure: fail closed.
    console.error("x401 gate failed:", err instanceof Error ? err.message : "unknown");
    audit(ctx, stage, { outcome: "unavailable", errorCode: "verifier_unavailable" });
    return {
      ok: false,
      response: json(
        503,
        {},
        "IDENTITY_VERIFIER_UNAVAILABLE",
        "Identity verification failed to run. Nothing was charged.",
      ),
    };
  }
}
