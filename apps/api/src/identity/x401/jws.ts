/**
 * Minimal JWS (RFC 7515) helpers on WebCrypto, which both Node and the
 * Workers runtime ship. Only ECDSA (ES256/ES384/ES512) is accepted: these are
 * the algorithms the Proof SD-JWT VC profile uses for issuer and key-binding
 * signatures. Anything else, including "none", is rejected.
 */
import { Buffer } from "node:buffer";
import type { webcrypto } from "node:crypto";

export type EcAlg = "ES256" | "ES384" | "ES512";
export const EC_ALGS: Record<EcAlg, { curve: string; hash: string; size: number }> = {
  ES256: { curve: "P-256", hash: "SHA-256", size: 32 },
  ES384: { curve: "P-384", hash: "SHA-384", size: 48 },
  ES512: { curve: "P-521", hash: "SHA-512", size: 66 },
};

export function isEcAlg(alg: unknown): alg is EcAlg {
  return typeof alg === "string" && Object.hasOwn(EC_ALGS, alg);
}

export function b64urlJson(segment: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]*$/.test(segment)) throw new Error("segment is not base64url");
  const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("segment is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export interface CompactJws {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array;
  /** True when the signature segment is empty (e.g. Proof detached signatures). */
  detached: boolean;
}

export function parseCompactJws(jws: string): CompactJws {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new Error("JWS must have three segments");
  const [h, p, s] = parts as [string, string, string];
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("signature is not base64url");
  return {
    header: b64urlJson(h),
    payload: b64urlJson(p),
    signingInput: `${h}.${p}`,
    signature: new Uint8Array(Buffer.from(s, "base64url")),
    detached: s.length === 0,
  };
}

export interface EcPublicJwk {
  kty: "EC";
  crv: string;
  x: string;
  y: string;
}

export function asEcPublicJwk(value: unknown): EcPublicJwk {
  const j = value as Record<string, unknown> | null;
  if (
    !j ||
    j.kty !== "EC" ||
    typeof j.crv !== "string" ||
    typeof j.x !== "string" ||
    typeof j.y !== "string"
  ) {
    throw new Error("not an EC public JWK");
  }
  if (j.d !== undefined) throw new Error("a private key was supplied where a public key belongs");
  return { kty: "EC", crv: j.crv, x: j.x, y: j.y };
}

/** Verify an ECDSA JWS signature (raw r||s per RFC 7518 §3.4) over its signing input. */
export async function verifyEcJws(jws: CompactJws, alg: EcAlg, jwk: EcPublicJwk): Promise<boolean> {
  const spec = EC_ALGS[alg];
  if (jwk.crv !== spec.curve) return false;
  if (jws.signature.length !== spec.size * 2) return false;
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
    { name: "ECDSA", namedCurve: spec.curve },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "ECDSA", hash: spec.hash },
    key,
    jws.signature,
    new TextEncoder().encode(jws.signingInput),
  );
}

/** RFC 7638 JWK thumbprint (SHA-256) of an EC public key. */
export async function ecJwkThumbprint(jwk: EcPublicJwk): Promise<string> {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: "EC", x: jwk.x, y: jwk.y });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Buffer.from(digest).toString("base64url");
}

/** Sign a compact JWS with an ES256 private JWK (P-256). */
export async function signEs256(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateJwk: Record<string, unknown>,
): Promise<string> {
  if (privateJwk.kty !== "EC" || privateJwk.crv !== "P-256" || typeof privateJwk.d !== "string") {
    throw new Error("signing key must be a P-256 private JWK");
  }
  const key = await crypto.subtle.importKey(
    "jwk",
    { ...privateJwk, ext: false, key_ops: ["sign"] } as webcrypto.JsonWebKey & { kty: string },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const enc = (o: Record<string, unknown>) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const signingInput = `${enc({ ...header, alg: "ES256" })}.${enc(payload)}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${Buffer.from(sig).toString("base64url")}`;
}

export async function sha256B64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Buffer.from(digest).toString("base64url");
}
