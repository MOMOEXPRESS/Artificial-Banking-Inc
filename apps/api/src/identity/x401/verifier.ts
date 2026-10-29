/**
 * ABI's x401 Verifier (spec v0.2.0 "Verifier Processing Rules" / "Proof
 * Validation") for the ABI-hosted x402 checkout.
 *
 * What a verified identity means — and does not:
 *   - proves: an allowlisted issuer attested the disclosed claims about the
 *     holder, and the holder key signed this ABI challenge (fresh, single use);
 *   - does NOT prove human delegation to the calling agent, and does NOT
 *     authorize any payment. Payment stays with x402 (402) and buyer policy.
 */
import { randomBytes, createHash } from "node:crypto";
import type { X401AuditEvent, X401ChallengeRow } from "../../store.js";
import type { X401Config } from "./config.js";
import { ecJwkThumbprint, asEcPublicJwk, signEs256 } from "./jws.js";
import { CredentialError, verifySdJwtVcPresentation } from "./sd-jwt-vc.js";
import {
  buildPayload,
  DC_PROTOCOL_SIGNED,
  encodeHeaderObject,
  parseProofResponse,
  vpTokenOf,
  X401WireError,
  type CredentialResult,
} from "./wire.js";

export interface X401ChallengeStore {
  createChallenge(row: Omit<X401ChallengeRow, "consumedAt">): void;
  getChallenge(nonceSha256: string): X401ChallengeRow | undefined;
  consumeChallenge(nonceSha256: string, at: string): boolean;
  sweepChallenges(at: string): number;
  recordAudit(event: X401AuditEvent): void;
}

/** The checkout the proof is for. Caller ids come from ABI auth, never from the client. */
export interface X401Context {
  offerId: string;
  sellerOrgId: string;
  method: string;
  resource: string;
  callerOrgId?: string;
  callerAgentId?: string;
}

export interface VerifiedIdentity {
  issuer: string;
  issuerTrustId: string;
  vct: string;
  holderKeyThumbprint: string;
  verifiedAt: string;
  boundTo: { offerId: string; resource: string; callerOrgId?: string; callerAgentId?: string };
  /** What this credential proves; see the module comment. */
  proves: { issuerAttestedClaims: true; humanDelegation: false; paymentAuthorization: false };
  /** Disclosed claims. Kept in memory for the request only; never logged or stored. */
  claims: Record<string, unknown>;
}

export type VerifyResult =
  | { ok: true; identity: VerifiedIdentity }
  | { ok: false; status: 400 | 401 | 503; code: string; description: string };

const reject = (status: 400 | 401 | 503, code: string, description: string): VerifyResult => ({
  ok: false,
  status,
  code,
  description,
});

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function claimAt(claims: Record<string, unknown>, path: string[]): unknown {
  let node: unknown = claims;
  for (const key of path) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

export class X401Verifier {
  private readonly now: () => Date;
  private readonly fetchImpl: typeof fetch;

  constructor(
    readonly config: X401Config,
    private readonly store: X401ChallengeStore,
    opts: { now?: () => Date; fetchImpl?: typeof fetch } = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Issue a PROOF-REQUEST: a signed OpenID4VP request for the DC API whose
   * nonce is single use and bound server-side to this checkout and caller.
   */
  async challenge(ctx: X401Context): Promise<string> {
    const now = this.now();
    const nonce = randomBytes(32).toString("base64url");
    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + this.config.challengeTtlSeconds;
    this.store.sweepChallenges(now.toISOString());
    this.store.createChallenge({
      nonceSha256: sha256(nonce),
      offerId: ctx.offerId,
      method: ctx.method,
      resource: ctx.resource,
      callerOrgId: ctx.callerOrgId,
      callerAgentId: ctx.callerAgentId,
      clientId: this.config.clientId,
      createdAt: now.toISOString(),
      expiresAt: new Date(exp * 1000).toISOString(),
    });
    const jar = await signEs256(
      { typ: "oauth-authz-req+jwt", kid: await this.signingKid() },
      {
        client_id: this.config.clientId,
        response_type: "vp_token",
        response_mode: "dc_api",
        nonce,
        expected_origins: this.config.expectedOrigins,
        scope: this.config.scope,
        iss: this.config.clientId,
        aud: this.config.requestAudience,
        iat,
        exp,
        jti: randomBytes(16).toString("hex"),
      },
      this.config.signingJwk,
    );
    return encodeHeaderObject(
      buildPayload({
        signedRequestJwt: jar,
        payment: { required: true, scheme_hint: "x402" },
      }) as unknown as Record<string, unknown>,
    );
  }

  async signingKid(): Promise<string> {
    return ecJwkThumbprint(asEcPublicJwk({ ...this.config.signingJwk, d: undefined }));
  }

  /** Public half of the signing key, for the Client ID Metadata Document. */
  async publicJwk(): Promise<Record<string, unknown>> {
    const { kty, crv, x, y } = this.config.signingJwk as Record<string, string>;
    return { kty, crv, x, y, kid: await this.signingKid(), use: "sig", alg: "ES256" };
  }

  /** Dereference a credential_result_uri, only from an allowlisted origin (SSRF guard). */
  private async fetchReference(
    uri: string,
    expiresAt: string | undefined,
  ): Promise<CredentialResult> {
    let u: URL;
    try {
      u = new URL(uri);
    } catch {
      throw new CredentialError("invalid_reference", "credential_result_uri is not a URL");
    }
    if (u.protocol !== "https:" || u.username || u.password) {
      throw new CredentialError("invalid_reference", "credential_result_uri must be https");
    }
    if (!this.config.resultUriOrigins.includes(u.origin)) {
      throw new CredentialError(
        "unsupported_reference",
        "ABI does not dereference result URIs from this origin",
      );
    }
    if (expiresAt !== undefined && !(Date.parse(expiresAt) > this.now().getTime())) {
      throw new CredentialError("invalid_reference", "credential_result_uri has expired");
    }
    let res: Response;
    try {
      res = await this.fetchImpl(u.toString(), {
        method: "GET",
        redirect: "manual",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new CredentialError("verifier_unavailable", "credential result could not be fetched");
    }
    if (res.status !== 200)
      throw new CredentialError("invalid_reference", "credential result is not available");
    const text = await res.text();
    if (text.length > 64 * 1024)
      throw new CredentialError("invalid_reference", "credential result too large");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new CredentialError("invalid_reference", "credential result is not JSON");
    }
    const r = body as Record<string, unknown> | null;
    if (!r || typeof r.protocol !== "string")
      throw new CredentialError("invalid_reference", "not a credential result");
    return { protocol: r.protocol, data: r.data };
  }

  /**
   * Validate a PROOF-RESPONSE for `ctx`. With `consume`, the challenge is spent
   * atomically, so one proof can be used for at most one paid checkout.
   */
  async verify(proofHeader: string, ctx: X401Context, consume: boolean): Promise<VerifyResult> {
    let presentation: string;
    try {
      const parsed = parseProofResponse(proofHeader);
      if (parsed.kind === "token") {
        return reject(
          401,
          "unsupported_token",
          "ABI issues no x401 Verification Tokens; present a Result Artifact.",
        );
      }
      const result =
        parsed.kind === "inline"
          ? parsed.result
          : await this.fetchReference(parsed.uri, parsed.expiresAt);
      if (result.protocol !== DC_PROTOCOL_SIGNED) {
        return reject(401, "unsupported_protocol", "ABI only issues signed OpenID4VP requests.");
      }
      const vp = vpTokenOf(result.data);
      const ids = Object.keys(vp);
      const entry = vp[this.config.credentialId];
      if (
        ids.length !== 1 ||
        !Array.isArray(entry) ||
        entry.length !== 1 ||
        typeof entry[0] !== "string"
      ) {
        return reject(
          401,
          "claims_not_satisfied",
          "vp_token does not answer ABI's credential query.",
        );
      }
      presentation = entry[0];
    } catch (err) {
      if (err instanceof X401WireError) return reject(400, "invalid_response", err.message);
      if (err instanceof CredentialError) {
        return reject(err.code === "verifier_unavailable" ? 503 : 401, err.code, err.message);
      }
      return reject(503, "verifier_unavailable", "The proof could not be processed right now.");
    }

    const now = this.now();
    let vc;
    try {
      vc = await verifySdJwtVcPresentation(presentation, {
        issuers: this.config.issuers,
        audience: this.config.clientId,
        now,
        kbMaxAgeSeconds: this.config.kbMaxAgeSeconds,
        clockSkewSeconds: this.config.clockSkewSeconds,
      });
    } catch (err) {
      if (err instanceof CredentialError) return reject(401, err.code, err.message);
      return reject(401, "invalid_result", "The credential result could not be verified.");
    }
    for (const path of this.config.requiredClaims) {
      if (claimAt(vc.claims, path) === undefined) {
        return reject(
          401,
          "claims_not_satisfied",
          `Required claim ${path.join(".")} was not disclosed.`,
        );
      }
    }
    // The nonce is the only correlation x401 trusts (spec "Result Artifact"):
    // request_id / agent_id in the artifact are ignored.
    const key = sha256(vc.nonce);
    const ch = this.store.getChallenge(key);
    if (!ch || ch.clientId !== this.config.clientId) {
      return reject(401, "invalid_nonce", "The proof does not answer a challenge ABI issued.");
    }
    if (ch.offerId !== ctx.offerId || ch.method !== ctx.method || ch.resource !== ctx.resource) {
      return reject(401, "wrong_resource", "The proof was issued for a different checkout.");
    }
    if (
      (ch.callerOrgId ?? null) !== (ctx.callerOrgId ?? null) ||
      (ch.callerAgentId ?? null) !== (ctx.callerAgentId ?? null)
    ) {
      return reject(401, "agent_binding_mismatch", "The proof was issued to a different caller.");
    }
    if (ch.consumedAt) return reject(401, "replayed", "This proof was already used.");
    if (!(Date.parse(ch.expiresAt) > now.getTime())) {
      return reject(401, "invalid_nonce", "The challenge has expired; request a new one.");
    }
    if (consume && !this.store.consumeChallenge(key, now.toISOString())) {
      return reject(401, "replayed", "This proof was already used.");
    }
    return {
      ok: true,
      identity: {
        issuer: vc.issuer,
        issuerTrustId: vc.issuerTrustId,
        vct: vc.vct,
        holderKeyThumbprint: vc.holderKeyThumbprint,
        verifiedAt: now.toISOString(),
        boundTo: {
          offerId: ctx.offerId,
          resource: ctx.resource,
          callerOrgId: ctx.callerOrgId,
          callerAgentId: ctx.callerAgentId,
        },
        proves: { issuerAttestedClaims: true, humanDelegation: false, paymentAuthorization: false },
        claims: vc.claims,
      },
    };
  }
}
