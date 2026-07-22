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
  | "VALIDATION_ERROR"
  /** Destination failed a compliance / KYT screen. */
  | "COMPLIANCE_BLOCKED"
  /** Custody provider unavailable or misconfigured. */
  | "CUSTODY_UNAVAILABLE";

export type DecisionOutcome = "allow" | "deny" | "review";

export type IntentTool =
  | "pay"
  | "pay_api"
  | "transfer_internal"
  | "escrow_lock"
  | "escrow_release"
  | "escrow_refund"
  | "withdraw";

/**
 * Wallet scopes — org + agent are fully wired; department + shared are first-class
 * treasury wallets with the same account-id scheme.
 */
export type WalletScope = "org" | "department" | "agent" | "shared";

/** Reference to any spendable wallet in an org. */
export interface WalletRef {
  scope: WalletScope;
  /** Org id, agent id, department id, or shared-wallet id. */
  id: string;
}

/** Supported settlement asset (USDC today; registry allows more without ledger rewrite). */
export interface AssetRecord {
  id: string;
  symbol: string;
  decimals: number;
  chain: "base" | "base-sepolia";
  /** Token contract; null for native gas placeholders. */
  contract: string | null;
  /** Org-scoped custom assets; null = platform default. */
  orgId?: string;
}

export const USDC_ASSET_ID = "asset_usdc";

/** Notification channels — in-app + Telegram today; others are extension slots. */
export type NotificationChannel =
  | "in_app"
  | "telegram"
  | "email"
  | "slack"
  | "discord"
  | "push"
  | "sms"
  | "webhook";

export type WebhookEventName =
  | "payment.succeeded"
  | "payment.failed"
  | "approval.pending"
  | "approval.resolved"
  | "policy.denied"
  | "agent.frozen"
  | "agent.unfrozen"
  | "escrow.locked"
  | "escrow.released"
  | "escrow.refunded"
  | "invoice.paid"
  | "subscription.charged"
  | "compliance.flagged"
  | "treasury.move.pending"
  | "treasury.move.executed"
  | "treasury.recovery";

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

/**
 * Thin agent identity envelope. Extra fields live in `profile` so the registry
 * can grow (reputation, groups, ownership) without schema churn on every call.
 */
export interface AgentIdentity {
  id: string;
  orgId: string;
  name: string;
  status: "active" | "frozen" | "archived";
  /** Free-form profile for future: groupId, ownerGuardianId, runtime, tags. */
  profile?: Record<string, unknown>;
}

/**
 * Documented optional keys for `AgentIdentity.profile` / `AgentRow.profile`.
 * `groupId` is legacy primary hint — membership lives in `agent_group_members`.
 */
export interface AgentProfileHints {
  /** @deprecated prefer multi membership via agent_group_members; kept as soft primary */
  groupId?: string;
  ownerGuardianId?: string;
  tags?: string[];
  runtime?: string;
  reputationScore?: number;
}

/** Org-scoped ops label (freeze / bulk fund roster). Optional link to a Treasury budget. */
export interface AgentGroupRecord {
  id: string;
  orgId: string;
  name: string;
  status: "active" | "archived";
  createdAt: string;
  /** When set, bulk fund / auto-fund defaults to this budget envelope. */
  budgetId?: string;
  autoFund?: AutoFundConfig;
}

/** Proactive top-up when a labeled agent's stipend falls below threshold. */
export interface AutoFundConfig {
  enabled: boolean;
  /** Top up when agent available USDC is strictly below this. */
  thresholdUsdc: string;
  /** Amount to transfer from the linked budget (or org) each trigger. */
  topUpUsdc: string;
  /** Minimum minutes between auto-fund for the same agent under this label (default 5). */
  minIntervalMinutes: number;
}

/**
 * Short-lived agent credential. Prefer these over long-lived API keys when
 * wiring runtimes; revoke on freeze. Token prefix: `pv_sess_`.
 */
export interface SessionKeyRecord {
  id: string;
  orgId: string;
  agentId: string;
  /** Present only at create time — never listed again. */
  token?: string;
  label?: string;
  scopes: string[];
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
}

/**
 * True when the agent still has a usable long-lived API key.
 * Accepts plaintext `pv_agent_…` (reveal-once) or hashed-at-rest `h1:…` (A13).
 */
export function agentApiKeyIsLive(apiKey: string): boolean {
  if (!apiKey || apiKey.startsWith("revoked_")) return false;
  return apiKey.startsWith("pv_agent_") || apiKey.startsWith("h1:");
}

/** Org-level feature / plan envelope — SSO, SLA, etc. land as flags here. */
export type OrgSettings = Record<string, unknown>;

/**
 * Merchant directory row (org-scoped). Allowlists stay string-based; this is
 * optional metadata layered on top of known counterparties.
 */
export interface MerchantRecord {
  id: string;
  orgId: string;
  /** Normalized key matching allowlist / destination keys. */
  key: string;
  label?: string;
  category?: string;
  meta?: Record<string, unknown>;
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
  "Artificial Banking Incorporated is software for policy-gated agent treasuries. Not a bank. Not FDIC insured. Not investment advice. Operators remain responsible for agent spend.";

/** Stable account id helpers — keep every future wallet scope on this scheme. */
export function accountId(scope: WalletScope, ownerId: string, kind: "available" | "held" = "available"): string {
  const prefix =
    scope === "org"
      ? "org"
      : scope === "agent"
        ? "agent"
        : scope === "department"
          ? "dept"
          : "shared";
  return `${prefix}:${ownerId}:${kind}`;
}
