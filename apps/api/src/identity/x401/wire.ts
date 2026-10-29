/**
 * x401 wire objects, implemented against the x401 specification v0.2.0
 * (https://x401.proof.com/spec/0.2.0/ — spec.md at github.com/proof/x401,
 * commit 7e864af). Only the members the spec defines are produced or read.
 *
 * Header syntax (spec "Header Syntax"): each proof header carries exactly one
 * base64url (RFC 4648 §5, no padding) UTF-8 JSON object. A comma-separated
 * list or a duplicated field line makes the header invalid.
 */
import { Buffer } from "node:buffer";

export const X401_VERSION = "0.2.0";
export const PROOF_REQUEST = "PROOF-REQUEST";
export const PROOF_RESPONSE = "PROOF-RESPONSE";
export const PROOF_RESULT = "PROOF-RESULT";
/** DC API protocol identifiers x401 v0.2.0 allows in `digital.requests[].protocol`. */
export const DC_PROTOCOL_SIGNED = "openid4vp-v1-signed";
export const DC_PROTOCOL_UNSIGNED = "openid4vp-v1-unsigned";

export class X401WireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X401WireError";
  }
}

const B64URL = /^[A-Za-z0-9_-]+$/;
/** Generous cap: a header this large is refused before any JSON parsing. */
export const MAX_PROOF_HEADER_BYTES = 64 * 1024;

export function encodeHeaderObject(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** Decode one x401 proof header value into a single JSON object, or throw. */
export function decodeHeaderObject(raw: string | undefined): Record<string, unknown> {
  if (typeof raw !== "string" || raw.length === 0) throw new X401WireError("empty header");
  if (raw.length > MAX_PROOF_HEADER_BYTES) throw new X401WireError("header too large");
  const value = raw.trim();
  // A comma list or padding is outside the spec's single-object syntax.
  if (!B64URL.test(value)) throw new X401WireError("not a single base64url value");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new X401WireError("not base64url JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new X401WireError("decoded value is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** x401 Payload (spec "x401 Payload"); `oauth` is omitted because ABI offers no token exchange. */
export interface X401Payload {
  scheme: "x401";
  version: string;
  credential_requirements: {
    digital: { requests: { protocol: string; data: Record<string, unknown> }[] };
  };
  request_id?: string;
  satisfied_requirements?: string[];
  payment?: { required?: boolean; scheme_hint?: string; notes?: string };
}

export function buildPayload(args: {
  signedRequestJwt: string;
  requestId?: string;
  payment?: X401Payload["payment"];
}): X401Payload {
  return {
    scheme: "x401",
    version: X401_VERSION,
    credential_requirements: {
      digital: {
        requests: [{ protocol: DC_PROTOCOL_SIGNED, data: { request: args.signedRequestJwt } }],
      },
    },
    ...(args.requestId && { request_id: args.requestId }),
    ...(args.payment && { payment: args.payment }),
  };
}

/** Credential Result `{ protocol, data }` as returned by the Digital Credentials API. */
export interface CredentialResult {
  protocol: string;
  data: unknown;
}

/** A decoded PROOF-RESPONSE (spec "Result Artifact" / "x401 Token Object"). */
export type ProofResponse =
  | { kind: "inline"; requestId?: string; agentId?: string; result: CredentialResult }
  | { kind: "reference"; requestId?: string; agentId?: string; uri: string; expiresAt?: string }
  | { kind: "token"; tokenType: string; accessToken: string };

function optionalString(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new X401WireError(`${key} must be a string`);
  return v;
}

/**
 * Parse a PROOF-RESPONSE value. A Token Object carries `scheme`/`access_token`;
 * a Result Artifact carries exactly one of `credential_result` or
 * `credential_result_uri` (spec: "MUST contain exactly one").
 */
export function parseProofResponse(raw: string | undefined): ProofResponse {
  const o = decodeHeaderObject(raw);
  if ("access_token" in o) {
    if (o.scheme !== "x401") throw new X401WireError("token object scheme must be x401");
    const tokenType = optionalString(o, "token_type");
    const accessToken = optionalString(o, "access_token");
    if (!tokenType || !accessToken) throw new X401WireError("token object is incomplete");
    return { kind: "token", tokenType, accessToken };
  }
  const requestId = optionalString(o, "request_id");
  const agentId = optionalString(o, "agent_id");
  const hasInline = o.credential_result !== undefined;
  const uri = optionalString(o, "credential_result_uri");
  if (hasInline === (uri !== undefined)) {
    throw new X401WireError(
      "result artifact needs exactly one of credential_result / credential_result_uri",
    );
  }
  if (uri !== undefined) {
    return {
      kind: "reference",
      requestId,
      agentId,
      uri,
      expiresAt: optionalString(o, "expires_at"),
    };
  }
  const cr = o.credential_result as Record<string, unknown> | null;
  if (!cr || typeof cr !== "object" || Array.isArray(cr) || typeof cr.protocol !== "string") {
    throw new X401WireError("credential_result must be { protocol, data }");
  }
  return { kind: "inline", requestId, agentId, result: { protocol: cr.protocol, data: cr.data } };
}

/** x401 Error Object (spec "x401 Error Object"); `error` is verifier-defined. */
export function encodeErrorObject(error: string, description?: string, requestId?: string): string {
  return encodeHeaderObject({
    scheme: "x401",
    version: X401_VERSION,
    error,
    ...(description && { error_description: description }),
    ...(requestId && { request_id: requestId }),
  });
}

/** Decode a CredentialResult `data` member into the OpenID4VP `vp_token` object. */
export function vpTokenOf(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new X401WireError("credential result data must be an object");
  }
  const d = data as Record<string, unknown>;
  if (d.response !== undefined) {
    // OpenID4VP encrypted response (dc_api.jwt): ABI never requests it.
    throw new X401WireError("encrypted responses are not supported");
  }
  let vp = d.vp_token;
  // OpenID4VP 1.0 carries vp_token as a JSON object; Proof's verifier SDK
  // (@proof.com/proof-vc-server verifyVPToken) receives it base64url-encoded.
  if (typeof vp === "string") {
    try {
      vp = JSON.parse(Buffer.from(vp, "base64url").toString("utf8"));
    } catch {
      throw new X401WireError("vp_token string is not base64url JSON");
    }
  }
  if (!vp || typeof vp !== "object" || Array.isArray(vp)) {
    throw new X401WireError("vp_token must be an object keyed by credential query id");
  }
  return vp as Record<string, unknown>;
}
