/**
 * Server-side x401 verifier configuration. Everything is read from the
 * environment (Worker vars/secrets); nothing comes from the request.
 *
 * Off by default. An offer that requires x401 while this is off or invalid is
 * refused with 503 before any challenge or payment (fail closed).
 */
import { X509Certificate } from "node:crypto";
import { parseAnchors, PROOF_ISSUERS } from "./trust.js";
import type { TrustedIssuer } from "./sd-jwt-vc.js";

export type ProofEnvironment = "sandbox" | "production";

/**
 * Proof OID4VP scopes (@proof.com/proof-vc-server 0.7.0 README "Scopes"): each
 * maps to a pre-defined DCQL query, the vp_token credential id it answers
 * under, and the claims it discloses.
 */
export const PROOF_SCOPES: Record<string, { credentialId: string; claims: string[][] }> = {
  "urn:proof:params:scope:verifiable-credentials:basic": {
    credentialId: "proof_id_default",
    claims: [["given_name"], ["family_name"], ["age_equal_or_over", "18"]],
  },
  "urn:proof:params:scope:verifiable-credentials:nationality:us": {
    credentialId: "proof_id_nationality_us",
    claims: [
      ["age_equal_or_over", "18"],
      ["is_national", "us"],
    ],
  },
};

export interface X401Config {
  environment: ProofEnvironment;
  /** OpenID4VP client_id: the https URL of ABI's Client ID Metadata Document. */
  clientId: string;
  clientName: string;
  /** P-256 private JWK that signs ABI's request objects. Secret. */
  signingJwk: Record<string, unknown>;
  scope: string;
  credentialId: string;
  requiredClaims: string[][];
  expectedOrigins: string[];
  /** JAR `aud` (the wallet's authorization server issuer). */
  requestAudience: string;
  issuers: TrustedIssuer[];
  challengeTtlSeconds: number;
  kbMaxAgeSeconds: number;
  clockSkewSeconds: number;
  /** Origins ABI will dereference a credential_result_uri from. Empty = by-reference refused. */
  resultUriOrigins: string[];
}

export type X401ConfigResult = { ok: true; config: X401Config } | { ok: false; reason: string };

function intIn(
  raw: string | undefined,
  dflt: number,
  min: number,
  max: number,
  name: string,
): number {
  if (raw === undefined || raw.trim() === "") return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`${name} must be an integer ${min}-${max}`);
  return n;
}

function httpsUrl(raw: string, name: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${name} must be a URL`);
  }
  if (u.protocol !== "https:" || u.username || u.password || u.hash) {
    throw new Error(`${name} must be an https URL without credentials or fragment`);
  }
  return u;
}

function parseIssuers(raw: string | undefined): TrustedIssuer[] {
  if (!raw?.trim()) throw new Error("X401_TRUSTED_ISSUERS is not set");
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    throw new Error("X401_TRUSTED_ISSUERS must be JSON");
  }
  if (!Array.isArray(list) || list.length === 0 || list.length > 10) {
    throw new Error("X401_TRUSTED_ISSUERS must be a non-empty array");
  }
  return list.map((entry, i) => {
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" && /^[a-z0-9_.-]{1,40}$/.test(e.id) ? e.id : undefined;
    if (!id) throw new Error(`X401_TRUSTED_ISSUERS[${i}].id is invalid`);
    if (typeof e.issuer !== "string")
      throw new Error(`X401_TRUSTED_ISSUERS[${i}].issuer is missing`);
    httpsUrl(e.issuer, `X401_TRUSTED_ISSUERS[${i}].issuer`);
    const pems = Array.isArray(e.anchorsPem) ? e.anchorsPem : [];
    if (pems.length === 0 || !pems.every((p) => typeof p === "string")) {
      throw new Error(`X401_TRUSTED_ISSUERS[${i}].anchorsPem must list PEM certificates`);
    }
    const vcts = Array.isArray(e.vcts)
      ? e.vcts.filter((v): v is string => typeof v === "string")
      : [];
    if (vcts.length === 0) throw new Error(`X401_TRUSTED_ISSUERS[${i}].vcts must not be empty`);
    let anchors: X509Certificate[];
    try {
      anchors = parseAnchors(pems as string[]);
    } catch (err) {
      throw new Error(
        `X401_TRUSTED_ISSUERS[${i}] anchor: ${err instanceof Error ? err.message : "invalid"}`,
      );
    }
    return { id, issuer: e.issuer, anchors, vcts };
  });
}

/** Read and validate the x401 config. Never throws; never echoes secret values. */
export function loadX401Config(env: NodeJS.ProcessEnv = process.env): X401ConfigResult {
  if (env.X401_ENABLED !== "1") return { ok: false, reason: "x401 verification is not enabled" };
  try {
    const environment = (env.X401_ENVIRONMENT?.trim() || "sandbox") as ProofEnvironment;
    if (environment !== "sandbox" && environment !== "production") {
      throw new Error("X401_ENVIRONMENT must be sandbox or production");
    }
    const clientId = env.X401_CLIENT_ID?.trim() ?? "";
    const clientUrl = httpsUrl(clientId, "X401_CLIENT_ID");
    if (clientUrl.pathname === "/") throw new Error("X401_CLIENT_ID must have a path");
    let signingJwk: Record<string, unknown>;
    try {
      signingJwk = JSON.parse(env.X401_SIGNING_JWK ?? "") as Record<string, unknown>;
    } catch {
      throw new Error("X401_SIGNING_JWK must be a JSON private JWK");
    }
    if (
      signingJwk?.kty !== "EC" ||
      signingJwk.crv !== "P-256" ||
      typeof signingJwk.d !== "string"
    ) {
      throw new Error("X401_SIGNING_JWK must be a P-256 private JWK");
    }
    const scope = env.X401_SCOPE?.trim() || "urn:proof:params:scope:verifiable-credentials:basic";
    const scopeDef = PROOF_SCOPES[scope];
    if (!scopeDef) throw new Error("X401_SCOPE is not a supported Proof scope");
    const base = PROOF_ISSUERS[environment];
    const expectedOrigins = (
      env.X401_EXPECTED_ORIGINS?.trim() || `${base}/.well-known/agents-trust-list`
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    expectedOrigins.forEach((o) => httpsUrl(o, "X401_EXPECTED_ORIGINS"));
    const resultUriOrigins = (env.X401_RESULT_URI_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((o) => httpsUrl(o, "X401_RESULT_URI_ORIGINS").origin);
    return {
      ok: true,
      config: {
        environment,
        clientId,
        clientName: env.X401_CLIENT_NAME?.trim() || "ABI",
        signingJwk,
        scope,
        credentialId: scopeDef.credentialId,
        requiredClaims: scopeDef.claims,
        expectedOrigins,
        // Proof's signed request objects use the wallet's OID4VP issuer as `aud`
        // (@proof.com/proof-vc-server secured_request.js, authorizationServerIssuer).
        requestAudience:
          env.X401_REQUEST_AUDIENCE?.trim() || `${base}/verifiable-credentials/v1/presentation`,
        issuers: parseIssuers(env.X401_TRUSTED_ISSUERS),
        challengeTtlSeconds: intIn(
          env.X401_CHALLENGE_TTL_SECONDS,
          300,
          60,
          900,
          "X401_CHALLENGE_TTL_SECONDS",
        ),
        kbMaxAgeSeconds: intIn(
          env.X401_KB_MAX_AGE_SECONDS,
          300,
          30,
          900,
          "X401_KB_MAX_AGE_SECONDS",
        ),
        clockSkewSeconds: intIn(env.X401_CLOCK_SKEW_SECONDS, 60, 0, 300, "X401_CLOCK_SKEW_SECONDS"),
        resultUriOrigins,
      },
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "invalid x401 configuration" };
  }
}
