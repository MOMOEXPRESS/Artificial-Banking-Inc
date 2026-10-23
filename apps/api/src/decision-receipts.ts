/**
 * Signed decision receipts.
 *
 * Every policy decision ABI records (allow, review, deny — agent intents,
 * post-approval re-checks, freezes, subscriptions, guardian treasury
 * withdrawals) gets a receipt: a canonical JSON body covering what was
 * decided, for how much, to whom, under which policy, and — on a cap denial —
 * the numbers that bound, plus an HMAC-SHA256 signature.
 *
 * The x402 receipt standard does not sign the amount or payee today; this
 * does. Verification is server-side (`verifyDecisionReceipt`, exposed at
 * POST /v1/{agent,guardian}/decision-receipts/verify) because the key is
 * symmetric. Moving to Ed25519 with a published public key is the follow-up
 * once every runtime we deploy to supports it.
 *
 * Key: `ABI_DECISION_SIGNING_KEY` if set, else derived from `ABI_KEY_PEPPER`
 * (domain-separated, so the pepper itself is never used as a MAC key). With
 * neither — local dev and some tests — receipts are produced with
 * `alg: "none"` and an empty signature, and verify reports `unsigned`.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { formatMicroToUsdc } from "@policyvault/common";
import type { DenialLimits } from "@policyvault/policy";

export const RECEIPT_VERSION = 1;
const DOMAIN = "abi-decision-receipt-v1";

/** Wire form of DenialLimits: decimal strings, never bigint. */
export interface LimitsView {
  ruleId: string;
  unit: "usdc" | "count";
  attempted: string;
  cap: string;
  used?: string;
  remaining: string;
  window?: string;
}

export function limitsView(l: DenialLimits | undefined): LimitsView | undefined {
  if (!l) return undefined;
  const fmt = (v: bigint) => (l.unit === "usdc" ? formatMicroToUsdc(v) : v.toString());
  return {
    ruleId: l.ruleId,
    unit: l.unit,
    attempted: fmt(l.attempted),
    cap: fmt(l.cap),
    ...(l.used !== undefined && { used: fmt(l.used) }),
    remaining: fmt(l.remaining),
    ...(l.window && { window: l.window }),
  };
}

export interface ReceiptBody {
  v: number;
  decisionId: string;
  intentId: string;
  orgId: string;
  agentId: string;
  outcome: string;
  tool: string;
  amountUsdc: string;
  destination: string;
  ruleIds: string[];
  reasons: string[];
  limits: LimitsView | null;
  supersedes: string | null;
  policyVersion: string | null;
  policyHash: string | null;
  requestHash: string | null;
  nonce: string;
  at: string;
}

export interface DecisionReceipt {
  body: ReceiptBody;
  alg: "HMAC-SHA256" | "none";
  keyId: string | null;
  signature: string;
}

/** Deterministic JSON: sorted keys at every level, no whitespace, no undefined. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function signingKey(): Buffer | null {
  const explicit = process.env.ABI_DECISION_SIGNING_KEY?.trim();
  const pepper = process.env.ABI_KEY_PEPPER?.trim();
  const root = explicit || pepper;
  if (!root) return null;
  // Domain-separate: never use the pepper itself as a MAC key.
  return createHmac("sha256", root).update(DOMAIN).digest();
}

function keyIdFor(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function signReceiptBody(body: ReceiptBody): DecisionReceipt {
  const key = signingKey();
  if (!key) return { body, alg: "none", keyId: null, signature: "" };
  const signature = createHmac("sha256", key).update(canonicalJson(body)).digest("hex");
  return { body, alg: "HMAC-SHA256", keyId: keyIdFor(key), signature };
}

export function newReceiptNonce(): string {
  return randomBytes(16).toString("hex");
}

export type VerifyResult =
  | { valid: true }
  | { valid: false; reason: "unsigned" | "unknown_key" | "bad_signature" | "malformed" };

export function verifyDecisionReceipt(receipt: unknown): VerifyResult {
  if (!receipt || typeof receipt !== "object") return { valid: false, reason: "malformed" };
  const r = receipt as Partial<DecisionReceipt>;
  if (!r.body || typeof r.body !== "object" || typeof r.signature !== "string") {
    return { valid: false, reason: "malformed" };
  }
  if (r.alg !== "HMAC-SHA256" || !r.signature) return { valid: false, reason: "unsigned" };
  const key = signingKey();
  if (!key || r.keyId !== keyIdFor(key)) return { valid: false, reason: "unknown_key" };
  const expected = createHmac("sha256", key).update(canonicalJson(r.body)).digest();
  let given: Buffer;
  try {
    given = Buffer.from(r.signature, "hex");
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { valid: false, reason: "bad_signature" };
  }
  return { valid: true };
}
