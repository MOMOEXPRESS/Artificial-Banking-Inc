/**
 * SD-JWT VC presentation verification for x401 credential results.
 *
 * Standards: SD-JWT (RFC 9901) for disclosures and the Key Binding JWT,
 * SD-JWT-based Verifiable Credentials (draft-ietf-oauth-sd-jwt-vc) for `vct`,
 * `cnf` and the `dc+sd-jwt` type, OpenID4VP 1.0 for `aud`/`nonce` in the KB-JWT.
 * The concrete profile accepted (typ `dc+sd-jwt`, x5c issuer keys, ECDSA,
 * KB-JWT `aud` = Verifier client_id) is the one Proof documents for its
 * ProofCredentialV1 (@proof.com/proof-vc-server 0.7.0 README "Verify").
 *
 * ABI additionally requires a Key Binding JWT on every presentation: without
 * it there is no nonce, so no replay protection and no binding to the request.
 */
import { createHash, type X509Certificate } from "node:crypto";
import { Buffer } from "node:buffer";
import { asEcPublicJwk, ecJwkThumbprint, isEcAlg, parseCompactJws, verifyEcJws } from "./jws.js";
import { TrustError, verifyX5cChain } from "./trust.js";

export class CredentialError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CredentialError";
  }
}

export interface TrustedIssuer {
  id: string;
  issuer: string;
  anchors: X509Certificate[];
  vcts: string[];
}

export interface SdJwtVcVerifyOptions {
  issuers: TrustedIssuer[];
  /** Expected KB-JWT `aud`: the Verifier's OpenID4VP client_id. */
  audience: string;
  now: Date;
  /** Oldest acceptable KB-JWT `iat`. */
  kbMaxAgeSeconds: number;
  clockSkewSeconds: number;
}

export interface VerifiedSdJwtVc {
  issuer: string;
  issuerTrustId: string;
  vct: string;
  /** Disclosed and always-visible claims after processing. Never logged. */
  claims: Record<string, unknown>;
  /** Nonce signed by the holder in the KB-JWT. */
  nonce: string;
  /** RFC 7638 thumbprint of the holder key (cnf.jwk). */
  holderKeyThumbprint: string;
  expiresAt?: number;
}

const DIGEST = (s: string) => createHash("sha256").update(s, "ascii").digest("base64url");

function fail(code: string, message: string): never {
  throw new CredentialError(code, message);
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

type Disclosure = { name?: string; value: unknown; used: boolean };

function decodeDisclosures(encoded: string[]): Map<string, Disclosure> {
  const map = new Map<string, Disclosure>();
  for (const d of encoded) {
    if (!/^[A-Za-z0-9_-]+$/.test(d)) fail("malformed_credential", "disclosure is not base64url");
    let arr: unknown;
    try {
      arr = JSON.parse(Buffer.from(d, "base64url").toString("utf8"));
    } catch {
      fail("malformed_credential", "disclosure is not JSON");
    }
    if (
      !Array.isArray(arr) ||
      (arr.length !== 2 && arr.length !== 3) ||
      typeof arr[0] !== "string"
    ) {
      fail("malformed_credential", "disclosure must be [salt, value] or [salt, name, value]");
    }
    const digest = DIGEST(d);
    if (map.has(digest)) fail("malformed_credential", "duplicate disclosure");
    if (arr.length === 3) {
      if (typeof arr[1] !== "string" || arr[1] === "_sd" || arr[1] === "...") {
        fail("malformed_credential", "invalid disclosed claim name");
      }
      map.set(digest, { name: arr[1], value: arr[2], used: false });
    } else {
      map.set(digest, { value: arr[1], used: false });
    }
  }
  return map;
}

function take(map: Map<string, Disclosure>, digest: unknown): Disclosure | undefined {
  if (typeof digest !== "string") fail("malformed_credential", "digest must be a string");
  const d = map.get(digest);
  if (!d) return undefined; // decoy digest or claim the holder chose not to disclose
  if (d.used) fail("malformed_credential", "digest referenced more than once");
  d.used = true;
  return d;
}

/** Replace `_sd` digests and `{"...": digest}` array entries with disclosed values (RFC 9901 §7.1). */
function reveal(node: unknown, map: Map<string, Disclosure>, depth = 0): unknown {
  if (depth > 16) fail("malformed_credential", "credential nests too deeply");
  if (Array.isArray(node)) {
    const out: unknown[] = [];
    for (const item of node) {
      if (item && typeof item === "object" && !Array.isArray(item) && "..." in item) {
        if (Object.keys(item).length !== 1)
          fail("malformed_credential", "array digest object has extra keys");
        const d = take(map, (item as Record<string, unknown>)["..."]);
        if (d) {
          if (d.name !== undefined)
            fail("malformed_credential", "array element disclosure has a name");
          out.push(reveal(d.value, map, depth + 1));
        }
      } else {
        out.push(reveal(item, map, depth + 1));
      }
    }
    return out;
  }
  if (!node || typeof node !== "object") return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === "_sd" || k === "_sd_alg") continue;
    out[k] = reveal(v, map, depth + 1);
  }
  const sd = src._sd;
  if (sd !== undefined) {
    if (!Array.isArray(sd)) fail("malformed_credential", "_sd must be an array");
    for (const digest of sd) {
      const d = take(map, digest);
      if (!d) continue;
      if (d.name === undefined) fail("malformed_credential", "object disclosure has no name");
      if (Object.hasOwn(out, d.name)) fail("malformed_credential", "disclosure overwrites a claim");
      out[d.name] = reveal(d.value, map, depth + 1);
    }
  }
  return out;
}

function assertSupportedCrit(header: Record<string, unknown>, where: string): void {
  if (header.crit === undefined) return;
  // Proof's detached-signature marker ("proof.com#sig-1") and any other
  // extension are refused: signatures must be present and verified here.
  fail(
    "detached_signature_unsupported",
    `${where} has critical header parameters ABI does not process`,
  );
}

export async function verifySdJwtVcPresentation(
  presentation: string,
  opts: SdJwtVcVerifyOptions,
): Promise<VerifiedSdJwtVc> {
  if (typeof presentation !== "string" || presentation.length > 32_000) {
    fail("malformed_credential", "presentation must be a compact SD-JWT string");
  }
  const parts = presentation.split("~");
  if (parts.length < 2) fail("malformed_credential", "not an SD-JWT");
  const kbCompact = parts[parts.length - 1]!;
  if (!kbCompact) fail("key_binding_required", "presentation has no Key Binding JWT");
  const disclosures = parts.slice(1, -1);
  let issuerJws, kbJws;
  try {
    issuerJws = parseCompactJws(parts[0]!);
    kbJws = parseCompactJws(kbCompact);
  } catch (e) {
    fail("malformed_credential", e instanceof Error ? e.message : "malformed JWS");
  }
  assertSupportedCrit(issuerJws.header, "issuer JWT");
  assertSupportedCrit(kbJws.header, "KB-JWT");
  if (issuerJws.detached || kbJws.detached) {
    fail("detached_signature_unsupported", "presentation signatures are detached");
  }
  const h = issuerJws.header;
  const p = issuerJws.payload;
  if (h.typ !== "dc+sd-jwt") fail("unsupported_format", "issuer JWT typ must be dc+sd-jwt");
  if (!isEcAlg(h.alg)) fail("unsupported_alg", "issuer JWT alg is not an accepted ECDSA algorithm");
  const trust = opts.issuers.find((t) => t.issuer === p.iss);
  if (!trust) fail("untrusted_issuer", "credential issuer is not on ABI's issuer allowlist");
  let leaf;
  try {
    leaf = verifyX5cChain(h.x5c, trust.anchors, opts.now);
  } catch (e) {
    fail("untrusted_issuer", e instanceof TrustError ? e.message : "certificate chain rejected");
  }
  let leafJwk;
  try {
    leafJwk = asEcPublicJwk(leaf.publicKey.export({ format: "jwk" }));
  } catch {
    fail("untrusted_issuer", "issuer certificate key is not an EC key");
  }
  if (!(await verifyEcJws(issuerJws, h.alg, leafJwk))) {
    fail("invalid_signature", "issuer signature does not verify");
  }

  const now = Math.floor(opts.now.getTime() / 1000);
  const skew = opts.clockSkewSeconds;
  const vct = p.vct;
  if (typeof vct !== "string" || !trust.vcts.includes(vct)) {
    fail("unsupported_credential_type", "credential type is not accepted from this issuer");
  }
  const exp = num(p.exp);
  if (p.exp !== undefined && exp === undefined)
    fail("malformed_credential", "exp must be a number");
  if (exp !== undefined && exp + skew < now) fail("credential_expired", "credential has expired");
  const nbf = num(p.nbf);
  if (nbf !== undefined && nbf - skew > now)
    fail("credential_not_yet_valid", "credential is not valid yet");
  const iat = num(p.iat);
  if (iat !== undefined && iat - skew > now)
    fail("credential_not_yet_valid", "credential issued in the future");
  if (p.status !== undefined) {
    // A status reference must be checked; ABI does not fetch status lists yet.
    fail("status_unverifiable", "credential carries a status reference ABI cannot check");
  }
  if (p._sd_alg !== undefined && p._sd_alg !== "sha-256") {
    fail("unsupported_alg", "only sha-256 disclosure digests are supported");
  }
  const cnf = p.cnf as { jwk?: unknown } | undefined;
  let holderJwk;
  try {
    holderJwk = asEcPublicJwk(cnf?.jwk);
  } catch {
    fail("key_binding_required", "credential has no usable cnf.jwk holder key");
  }
  const map = decodeDisclosures(disclosures);
  const claims = reveal(p, map) as Record<string, unknown>;
  for (const d of map.values()) {
    if (!d.used) fail("malformed_credential", "a disclosure is not referenced by the credential");
  }

  const kh = kbJws.header;
  const kp = kbJws.payload;
  if (kh.typ !== "kb+jwt") fail("key_binding_invalid", "KB-JWT typ must be kb+jwt");
  if (!isEcAlg(kh.alg)) fail("unsupported_alg", "KB-JWT alg is not an accepted ECDSA algorithm");
  if (!(await verifyEcJws(kbJws, kh.alg, holderJwk))) {
    fail("invalid_signature", "key binding signature does not verify against cnf.jwk");
  }
  if (kp.aud !== opts.audience)
    fail("wrong_audience", "presentation was made for a different verifier");
  if (typeof kp.nonce !== "string" || kp.nonce.length === 0) {
    fail("key_binding_invalid", "KB-JWT has no nonce");
  }
  const kbIat = num(kp.iat);
  if (kbIat === undefined) fail("key_binding_invalid", "KB-JWT has no iat");
  if (kbIat - skew > now || kbIat < now - opts.kbMaxAgeSeconds - skew) {
    fail("presentation_expired", "KB-JWT is too old or from the future");
  }
  const presented = `${parts.slice(0, -1).join("~")}~`;
  if (kp.sd_hash !== DIGEST(presented)) {
    fail("key_binding_invalid", "KB-JWT sd_hash does not match the presented SD-JWT");
  }
  return {
    issuer: trust.issuer,
    issuerTrustId: trust.id,
    vct,
    claims,
    nonce: kp.nonce,
    holderKeyThumbprint: await ecJwkThumbprint(holderJwk),
    ...(exp !== undefined && { expiresAt: exp }),
  };
}
