/** Micro-USDC: 1 USDC = 1_000_000 micro units. Never use floats for money. */
export type MicroUsdc = bigint;

export const USDC_DECIMALS = 6;
export const MICRO_PER_USDC = 1_000_000n;

export type AgentErrorCode =
  | "POLICY_DENIED"
  | "INSUFFICIENT_STIPEND"
  | "NEEDS_APPROVAL"
  | "APPROVAL_TIMEOUT"
  | "FROZEN"
  | "ALLOWLIST_MISS"
  | "IDEMPOTENCY_REPLAY"
  | "RAIL_FAILED"
  | "RECONCILE_STALE"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR";

export type DecisionOutcome = "allow" | "deny" | "review";

export type IntentTool =
  | "pay"
  | "pay_api"
  | "transfer_internal"
  | "escrow_lock"
  | "escrow_release"
  | "escrow_refund"
  | "withdraw";

export interface MoneyIntent {
  agentId: string;
  orgId: string;
  tool: IntentTool;
  amountMicro: MicroUsdc;
  /** Destination address, domain, or vendor id */
  destination: string;
  jobId?: string;
  idempotencyKey: string;
  memo?: string;
}

export function parseUsdcToMicro(input: string | number): MicroUsdc {
  const s = String(input).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) {
    throw new Error("INVALID_USDC_AMOUNT");
  }
  const [whole, frac = ""] = s.split(".");
  const padded = (frac + "000000").slice(0, 6);
  return BigInt(whole) * MICRO_PER_USDC + BigInt(padded);
}

export function formatMicroToUsdc(micro: MicroUsdc): string {
  const neg = micro < 0n;
  const abs = neg ? -micro : micro;
  const whole = abs / MICRO_PER_USDC;
  const frac = (abs % MICRO_PER_USDC).toString().padStart(6, "0");
  const trimmed = frac.replace(/0+$/, "");
  const body = trimmed.length ? `${whole}.${trimmed}` : `${whole}`;
  return neg ? `-${body}` : body;
}

export const LEGAL_FOOTER =
  "PolicyVault is software for policy-gated agent treasuries. Not a bank. Not FDIC insured. Not investment advice. Operators remain responsible for agent spend.";
