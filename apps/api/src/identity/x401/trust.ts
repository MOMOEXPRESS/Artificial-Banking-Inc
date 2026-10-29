/**
 * Explicit issuer trust for x401 credential verification (ABI trust policy).
 *
 * An issuer is trusted only when it is listed here with its pinned X.509 trust
 * anchor and expected `iss`. Signing keys come from the credential's `x5c`
 * chain and must chain to that pinned anchor: ABI never fetches issuer keys,
 * JWKS or metadata from URLs carried in a credential, so a presentation cannot
 * point the verifier at an attacker-chosen key or an internal address.
 *
 * The Proof root certificates are copied verbatim from
 * @proof.com/proof-vc-server@0.7.0 dist/certificates/trust_store/*.js
 * (Proof Root CA R1 is also published at http://cert.proof.com/proof-root-ca-r1.crt).
 * Key rotation: issuer leaf keys rotate freely under the pinned root; rotating
 * the root itself is a code change reviewed like any other trust change.
 */
import { X509Certificate } from "node:crypto";
import { Buffer } from "node:buffer";

export interface IssuerTrust {
  /** Stable label used in audit logs. */
  id: string;
  /** Exact `iss` the issuer puts in its credentials. */
  issuer: string;
  /** Pinned root certificate(s), PEM. */
  anchorsPem: string[];
  /** Credential types (`vct`) accepted from this issuer. */
  vcts: string[];
}

/** Proof credential issuer identifiers (`iss`), per @proof.com/proof-vc-common BASE_URLS. */
export const PROOF_ISSUERS = {
  sandbox: "https://api.fairfax.proof.com",
  production: "https://api.proof.com",
} as const;
/** ProofCredentialV1 `vct`, per @proof.com/proof-vc-common PROOF_CREDENTIAL_V1_VCT. */
export const PROOF_CREDENTIAL_V1_VCT = "https://credentials.notarize.com/ProofCredentialV1";

export class TrustError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrustError";
  }
}

export function parseAnchors(pems: string[]): X509Certificate[] {
  return pems.map((pem) => {
    const cert = new X509Certificate(pem);
    if (!cert.ca) throw new TrustError("trust anchor is not a CA certificate");
    if (!cert.verify(cert.publicKey)) throw new TrustError("trust anchor is not self-signed");
    return cert;
  });
}

function inValidity(cert: X509Certificate, now: Date): boolean {
  const from = new Date(cert.validFrom);
  const to = new Date(cert.validTo);
  return !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && now >= from && now <= to;
}

/**
 * Validate an `x5c` chain (leaf first, base64 DER) up to one of the pinned
 * anchors and return the leaf certificate. Mirrors the checks in Proof's own
 * verifier: leaf is not a CA, every link is in validity, issued and signed by
 * the next CA, and the top of the chain is issued by a pinned anchor.
 */
export function verifyX5cChain(
  x5c: unknown,
  anchors: X509Certificate[],
  now: Date,
): X509Certificate {
  if (!Array.isArray(x5c) || x5c.length === 0 || x5c.length > 5) {
    throw new TrustError("x5c is missing or malformed");
  }
  const chain = x5c.map((b64) => {
    if (typeof b64 !== "string" || !/^[A-Za-z0-9+/=]+$/.test(b64))
      throw new TrustError("x5c entry is not base64");
    try {
      return new X509Certificate(Buffer.from(b64, "base64"));
    } catch {
      throw new TrustError("x5c entry is not a certificate");
    }
  });
  const leaf = chain[0]!;
  if (leaf.ca) throw new TrustError("leaf certificate must not be a CA");
  for (let i = 0; i < chain.length - 1; i++) {
    const cert = chain[i]!;
    const issuer = chain[i + 1]!;
    if (!inValidity(cert, now))
      throw new TrustError(`certificate ${i} is expired or not yet valid`);
    if (!issuer.ca) throw new TrustError(`certificate ${i + 1} is not a CA`);
    if (!cert.checkIssued(issuer) || !cert.verify(issuer.publicKey)) {
      throw new TrustError(`certificate ${i} is not signed by the next certificate`);
    }
  }
  const top = chain[chain.length - 1]!;
  if (!inValidity(top, now)) throw new TrustError("top certificate is expired or not yet valid");
  const anchor = anchors.find(
    (a) =>
      a.fingerprint256 === top.fingerprint256 || (top.checkIssued(a) && top.verify(a.publicKey)),
  );
  if (!anchor) throw new TrustError("certificate chain does not end at a trusted anchor");
  if (!inValidity(anchor, now)) throw new TrustError("trust anchor is expired");
  return leaf;
}
