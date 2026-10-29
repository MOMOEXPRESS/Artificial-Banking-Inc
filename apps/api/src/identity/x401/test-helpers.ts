/**
 * TEST-ONLY helpers: build SD-JWT VC presentations signed with the throwaway
 * keys in ./test-fixtures. Imported by *.test.ts files only.
 */
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  X509Certificate,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { signEs256 } from "./jws.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "test-fixtures");
export const TEST_ISSUER = "https://issuer.x401-test.invalid";
export const TEST_VCT = "https://credentials.x401-test.invalid/TestIdentityCredential";

export function fixturePem(name: string): string {
  return readFileSync(join(DIR, name), "utf8");
}

/** base64 DER of a fixture certificate, as it appears in x5c. */
export function x5cOf(name: string): string {
  return new X509Certificate(fixturePem(`${name}.cert.pem`)).raw.toString("base64");
}

export function issuerJwk(name: string): Record<string, unknown> {
  return createPrivateKey(fixturePem(`${name}.key.pem`)).export({ format: "jwk" }) as Record<
    string,
    unknown
  >;
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
export const digestOf = (d: string) => createHash("sha256").update(d, "ascii").digest("base64url");

export function disclosure(name: string | undefined, value: unknown): string {
  const salt = randomBytes(16).toString("base64url");
  return b64(name === undefined ? [salt, value] : [salt, name, value]);
}

export interface Holder {
  signingJwk: Record<string, unknown>;
  cnfJwk: { kty: string; crv: string; x: string; y: string };
}

/** A throwaway P-256 holder (wallet) key pair. */
export function newHolder(): Holder {
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = pair.privateKey.export({ format: "jwk" }) as Record<string, string>;
  return { signingJwk: jwk, cnfJwk: { kty: "EC", crv: "P-256", x: jwk.x!, y: jwk.y! } };
}

/** A throwaway P-256 JWK for ABI's request-signing key in tests. */
export function newVerifierSigningJwk(): Record<string, unknown> {
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return pair.privateKey.export({ format: "jwk" }) as Record<string, unknown>;
}

export interface IssueOptions {
  issuerCert?: string; // fixture name, default test-issuer
  chain?: string[]; // extra x5c entries (fixture names)
  iss?: string;
  vct?: string;
  holder: Holder;
  exp?: number;
  status?: unknown;
  typ?: string;
  /** Selectively disclosable top-level claims. */
  claims?: Record<string, unknown>;
  /** Selectively disclosable members of age_equal_or_over. */
  ages?: Record<string, boolean>;
}

/** Issue an SD-JWT VC; returns `<issuer-jwt>~<disclosures>~` (no KB-JWT yet). */
export async function issueSdJwtVc(o: IssueOptions): Promise<string> {
  const name = o.issuerCert ?? "test-issuer";
  const disclosures: string[] = [];
  const topSd: string[] = [];
  for (const [k, v] of Object.entries(o.claims ?? { given_name: "Test", family_name: "Holder" })) {
    const d = disclosure(k, v);
    disclosures.push(d);
    topSd.push(digestOf(d));
  }
  const ageSd: string[] = [];
  for (const [k, v] of Object.entries(o.ages ?? { "18": true })) {
    const d = disclosure(k, v);
    disclosures.push(d);
    ageSd.push(digestOf(d));
  }
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: o.iss ?? TEST_ISSUER,
    vct: o.vct ?? TEST_VCT,
    iat: now - 60,
    exp: o.exp ?? now + 3600,
    cnf: { jwk: o.holder.cnfJwk },
    _sd_alg: "sha-256",
    _sd: topSd,
    age_equal_or_over: { _sd: ageSd },
    ...(o.status !== undefined && { status: o.status }),
  };
  const header = { typ: o.typ ?? "dc+sd-jwt", x5c: [name, ...(o.chain ?? [])].map(x5cOf) };
  const jwt = await signEs256(header, payload, issuerJwk(name));
  return `${[jwt, ...disclosures].join("~")}~`;
}

/** Append a KB-JWT signed by the holder, as a wallet does when presenting. */
export async function present(
  sdJwt: string,
  holder: Holder,
  kb: { aud: string; nonce: string; iat?: number; sdHash?: string; signer?: Holder },
): Promise<string> {
  const payload = {
    iat: kb.iat ?? Math.floor(Date.now() / 1000),
    aud: kb.aud,
    nonce: kb.nonce,
    sd_hash: kb.sdHash ?? digestOf(sdJwt),
  };
  const kbJwt = await signEs256({ typ: "kb+jwt" }, payload, (kb.signer ?? holder).signingJwk);
  return `${sdJwt}${kbJwt}`;
}

/** Wrap one presentation as the PROOF-RESPONSE header value (inline Result Artifact). */
export function proofResponseHeader(
  presentation: string,
  credentialId = "proof_id_default",
): string {
  return b64({
    credential_result: {
      protocol: "openid4vp-v1-signed",
      data: { vp_token: { [credentialId]: [presentation] } },
    },
  });
}

/** Decode a PROOF-REQUEST header and its signed request object (test inspection). */
export function decodeProofRequest(header: string): {
  payload: Record<string, unknown>;
  jarHeader: Record<string, unknown>;
  request: Record<string, unknown>;
} {
  const payload = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
  const jar: string = payload.credential_requirements.digital.requests[0].data.request;
  const [h, p] = jar.split(".");
  return {
    payload,
    jarHeader: JSON.parse(Buffer.from(h!, "base64url").toString("utf8")),
    request: JSON.parse(Buffer.from(p!, "base64url").toString("utf8")),
  };
}
