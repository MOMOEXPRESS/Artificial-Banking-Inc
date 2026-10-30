/**
 * In-house KYC (know your customer) and KYA (know your agent).
 *
 * These are internal, self-attested checks run inside ABI with no outside
 * identity, sanctions or document provider. They are NOT regulated identity
 * verification and do not make ABI a licensed or certified anything. What they
 * do: record who stands behind an organization and each agent, refuse the
 * obvious cases (embargoed country, a self-declared sanctions match, an agent
 * its owner suspended), and keep spending small until the owner has told us
 * who they are and vouched for each agent.
 *
 * KYC (per organization, filled in by an owner):
 *   status   unverified → no profile yet
 *            pending    → submitted, but the owner's email is not verified yet
 *            verified   → self-attested profile complete, all local checks pass
 *            restricted → embargoed country or a declared sanctions match; no spend
 *   risk     low | medium | high, from entity type, PEP declaration, country
 *            and expected volume.
 *
 * KYA (per agent, attested by an owner):
 *   identity bound to the owning org, declared purpose/operator/model/provider,
 *   a fingerprint of its API key (from the stored hash, never the key),
 *   optional allowed categories and counterparties (enforced when declared),
 *   risk tier, owner attestation, recent-activity anomaly flags, and a status
 *   (unattested | attested | suspended) that gates spending.
 *
 * Spend gating (see `complianceGate`):
 *   restricted org or suspended agent        → every payment refused
 *   agent declared scope, payment outside it → refused
 *   unverified/pending org, unattested agent → per-payment and 24h caps
 *   verified high-risk org                   → larger caps
 * Organizations that existed before this shipped are grandfathered: no caps,
 * but restriction and suspension still apply. Caps are enforced in production
 * (or with ABI_COMPLIANCE_ENFORCE=1) and off otherwise unless set.
 */
import { createHash } from "node:crypto";

export const KYC_TERMS_VERSION = "2026-10-30";
export const SANCTIONS_LIST_VERSION = "abi-bundled-2026-10-30";

export type KycStatus = "unverified" | "pending" | "verified" | "restricted";
export type KyaStatus = "unattested" | "attested" | "suspended";
export type RiskTier = "low" | "medium" | "high";
export type EntityType = "individual" | "business";
export type VolumeBand = "under_1k" | "1k_10k" | "10k_100k" | "over_100k";

/**
 * Comprehensively embargoed jurisdictions (bundled, reviewed 2026-10-30). A
 * small, conservative list — not a substitute for a screening provider.
 */
export const EMBARGOED_COUNTRIES: Record<string, string> = {
  CU: "Cuba",
  IR: "Iran",
  KP: "North Korea",
  SY: "Syria",
};

/** Higher-risk jurisdictions: allowed, but the org is rated high risk. */
export const HIGH_RISK_COUNTRIES: Record<string, string> = {
  AF: "Afghanistan",
  BY: "Belarus",
  MM: "Myanmar",
  RU: "Russia",
  VE: "Venezuela",
  YE: "Yemen",
};

export interface KycInput {
  entityType: EntityType;
  legalName: string;
  businessName?: string;
  registrationNumber?: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  ageAttested: boolean;
  /** "I am not on a sanctions list and not acting for anyone who is." */
  sanctionsAttested: boolean;
  /** Politically exposed person self-declaration. */
  pepDeclared: boolean;
  intendedUse: string;
  expectedMonthlyVolume: VolumeBand;
  termsAccepted: boolean;
}

export interface KycRecord extends Omit<KycInput, "termsAccepted"> {
  orgId: string;
  subjectUserId?: string;
  status: KycStatus;
  riskTier: RiskTier;
  statusReasons: string[];
  termsVersion?: string;
  termsAcceptedAt?: string;
  submittedAt?: string;
  verifiedAt?: string;
  updatedAt: string;
}

export interface KycEvaluation {
  status: KycStatus;
  riskTier: RiskTier;
  reasons: string[];
}

export function normalizeCountry(raw: string): string {
  return raw.trim().toUpperCase().slice(0, 2);
}

/** Pure: decide status and risk tier from a submission. */
export function evaluateKyc(input: KycInput, ctx: { ownerEmailVerified: boolean }): KycEvaluation {
  const reasons: string[] = [];
  const country = normalizeCountry(input.country);
  if (EMBARGOED_COUNTRIES[country]) {
    reasons.push(`Country ${EMBARGOED_COUNTRIES[country]} is on ABI's embargoed list.`);
  }
  if (!input.sanctionsAttested) {
    reasons.push("The sanctions attestation was not confirmed.");
  }
  if (reasons.length) return { status: "restricted", riskTier: "high", reasons };

  let tier: RiskTier = "low";
  const bump = (t: RiskTier) => {
    const order: RiskTier[] = ["low", "medium", "high"];
    if (order.indexOf(t) > order.indexOf(tier)) tier = t;
  };
  if (input.entityType === "business") bump("medium");
  if (input.expectedMonthlyVolume === "10k_100k") bump("medium");
  if (input.expectedMonthlyVolume === "over_100k") {
    bump("high");
    reasons.push("Expected volume over $100k a month.");
  }
  if (HIGH_RISK_COUNTRIES[country]) {
    bump("high");
    reasons.push(`${HIGH_RISK_COUNTRIES[country]} is on ABI's higher-risk list.`);
  }
  if (input.pepDeclared) {
    bump("high");
    reasons.push("Declared a politically exposed person.");
  }
  if (!ctx.ownerEmailVerified) {
    return {
      status: "pending",
      riskTier: tier,
      reasons: [...reasons, "Verify the owner's email to finish."],
    };
  }
  return { status: "verified", riskTier: tier, reasons };
}

/** Field-level problems with a submission, or null. */
export function kycInputProblem(input: KycInput): string | null {
  if (input.legalName.trim().length < 2) return "Enter your full legal name.";
  if (!/^[A-Z]{2}$/.test(normalizeCountry(input.country))) {
    return "Choose a country (two-letter ISO code).";
  }
  if (input.entityType === "business" && !input.businessName?.trim()) {
    return "Enter the registered business name.";
  }
  if (!input.ageAttested) return "You must confirm you are at least 18.";
  if (!input.termsAccepted) return "Accept the Terms of Use and Privacy Notice to continue.";
  if (input.intendedUse.trim().length < 4) return "Describe briefly what your agents will pay for.";
  return null;
}

// ------------------------------------------------------------------ KYA

export interface KyaInput {
  purpose: string;
  operator: string;
  model?: string;
  provider?: string;
  allowedCategories: string[];
  allowedCounterparties: string[];
}

export interface KyaRecord extends KyaInput {
  agentId: string;
  orgId: string;
  status: KyaStatus;
  attestedByUserId?: string;
  attestedByName?: string;
  attestedAt?: string;
  suspendedReason?: string;
  updatedAt: string;
}

export interface AgentActivityStats {
  decisions24h: number;
  denials24h: number;
  outOfScope24h: number;
  pays1h: number;
  pays7d: number;
  newCounterparties24h: number;
}

export interface AnomalyFlag {
  code: "refusal_spike" | "velocity_spike" | "new_counterparties" | "out_of_scope_attempts";
  message: string;
}

/** Pure: anomaly flags from recent activity. Flags inform; they never block. */
export function anomalyFlags(s: AgentActivityStats): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  if (s.denials24h >= 5 && s.denials24h * 2 >= s.decisions24h) {
    flags.push({
      code: "refusal_spike",
      message: `${s.denials24h} of ${s.decisions24h} payment requests refused in 24h.`,
    });
  }
  const hourlyAvg7d = s.pays7d / (7 * 24);
  if (s.pays1h >= 10 && s.pays1h > 3 * hourlyAvg7d) {
    flags.push({
      code: "velocity_spike",
      message: `${s.pays1h} payments in the last hour, over 3× its 7-day hourly average.`,
    });
  }
  if (s.newCounterparties24h >= 5) {
    flags.push({
      code: "new_counterparties",
      message: `Paid ${s.newCounterparties24h} new counterparties in 24h.`,
    });
  }
  if (s.outOfScope24h >= 1) {
    flags.push({
      code: "out_of_scope_attempts",
      message: `${s.outOfScope24h} attempt(s) outside its declared scope in 24h.`,
    });
  }
  return flags;
}

export function agentRiskTier(args: {
  kya?: Pick<KyaRecord, "status" | "model" | "provider">;
  orgTier?: RiskTier;
  flags: AnomalyFlag[];
}): RiskTier {
  if (args.flags.length >= 2 || args.orgTier === "high") return "high";
  if (!args.kya || args.kya.status !== "attested") return "medium";
  if (!args.kya.model?.trim() || !args.kya.provider?.trim()) return "medium";
  if (args.flags.length === 1) return "medium";
  return "low";
}

/** Non-reversible display fingerprint of an agent key, from its stored hash. */
export function keyFingerprint(storedKeyHash: string): string {
  const hex = createHash("sha256").update(`abi-kya:${storedKeyHash}`).digest("hex").slice(0, 16);
  return hex.match(/.{4}/g)!.join(":");
}

function destKeys(destination: string): string[] {
  const d = destination.trim().toLowerCase();
  const keys = [d];
  try {
    if (/^https?:\/\//.test(d)) keys.push(new URL(d).hostname);
  } catch {
    /* keep raw */
  }
  return keys;
}

/** True when `destination` matches one of the declared counterparties. */
export function counterpartyAllowed(destination: string, allowed: string[]): boolean {
  const keys = destKeys(destination);
  return allowed.some((raw) => {
    const a = raw.trim().toLowerCase();
    if (!a) return false;
    return keys.some((k) => k === a || (a.includes(".") && k.endsWith(`.${a}`)));
  });
}

// ------------------------------------------------------------ spend gate

export interface ComplianceCaps {
  perTxMaxMicro: bigint;
  dailyMaxMicro: bigint;
}

const USDC = 1_000_000n;

function capFromEnv(name: string, fallbackUsdc: number): bigint {
  const n = Number(process.env[name]);
  const usdc = Number.isFinite(n) && n > 0 ? n : fallbackUsdc;
  return BigInt(Math.round(usdc * 1_000_000));
}

/** Caps while the org is unverified/pending or the agent is unattested. */
export function baselineCaps(): ComplianceCaps {
  return {
    perTxMaxMicro: capFromEnv("ABI_KYC_UNVERIFIED_PER_TX_USDC", 25),
    dailyMaxMicro: capFromEnv("ABI_KYC_UNVERIFIED_DAILY_USDC", 100),
  };
}

/** Caps for a verified but high-risk org. */
export function highRiskCaps(): ComplianceCaps {
  return {
    perTxMaxMicro: capFromEnv("ABI_KYC_HIGH_RISK_PER_TX_USDC", 500),
    dailyMaxMicro: capFromEnv("ABI_KYC_HIGH_RISK_DAILY_USDC", 2_000),
  };
}

export function complianceCapsEnforced(): boolean {
  const flag = process.env.ABI_COMPLIANCE_ENFORCE?.trim();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return process.env.NODE_ENV === "production";
}

export interface GateInput {
  grandfathered: boolean;
  kyc?: Pick<KycRecord, "status" | "riskTier">;
  kya?: Pick<KyaRecord, "status" | "allowedCategories" | "allowedCounterparties">;
  destination?: string;
  destinationCategory?: string;
  enforceCaps?: boolean;
}

export type GateResult =
  | { kind: "block"; ruleId: string; reason: string }
  | { kind: "cap"; ruleId: string; reason: string; caps: ComplianceCaps }
  | { kind: "none" };

function minCaps(a: ComplianceCaps | undefined, b: ComplianceCaps): ComplianceCaps {
  if (!a) return b;
  return {
    perTxMaxMicro: a.perTxMaxMicro < b.perTxMaxMicro ? a.perTxMaxMicro : b.perTxMaxMicro,
    dailyMaxMicro: a.dailyMaxMicro < b.dailyMaxMicro ? a.dailyMaxMicro : b.dailyMaxMicro,
  };
}

/** Pure: what KYC/KYA allow for one payment. */
export function complianceGate(input: GateInput): GateResult {
  const kycStatus = input.kyc?.status ?? "unverified";
  if (kycStatus === "restricted") {
    return {
      kind: "block",
      ruleId: "kyc_restricted",
      reason:
        "This organization is restricted by ABI's internal KYC check. No payments can be made.",
    };
  }
  if (input.kya?.status === "suspended") {
    return {
      kind: "block",
      ruleId: "kya_suspended",
      reason: "This agent is suspended under Know Your Agent. An owner must reinstate it.",
    };
  }
  if (input.kya && input.destination) {
    const cats = input.kya.allowedCategories.map((c) => c.trim().toLowerCase()).filter(Boolean);
    if (cats.length && input.destinationCategory && !cats.includes(input.destinationCategory)) {
      return {
        kind: "block",
        ruleId: "kya_out_of_scope",
        reason: `Category "${input.destinationCategory}" is outside this agent's declared scope.`,
      };
    }
    const cps = input.kya.allowedCounterparties.filter((c) => c.trim());
    if (cps.length && !counterpartyAllowed(input.destination, cps)) {
      return {
        kind: "block",
        ruleId: "kya_out_of_scope",
        reason: "This counterparty is outside the agent's declared counterparties.",
      };
    }
  }
  const enforce = input.enforceCaps ?? complianceCapsEnforced();
  if (!enforce || input.grandfathered) return { kind: "none" };

  let caps: ComplianceCaps | undefined;
  const why: string[] = [];
  if (kycStatus === "unverified" || kycStatus === "pending") {
    caps = minCaps(caps, baselineCaps());
    why.push(kycStatus === "pending" ? "KYC is pending" : "the organization has not completed KYC");
  } else if (input.kyc?.riskTier === "high") {
    caps = minCaps(caps, highRiskCaps());
    why.push("the organization is rated high risk");
  }
  if (!input.kya || input.kya.status === "unattested") {
    caps = minCaps(caps, baselineCaps());
    why.push("the agent has not been attested (Know Your Agent)");
  }
  if (!caps) return { kind: "none" };
  return {
    kind: "cap",
    ruleId: "kyc_tier",
    reason: `Starter limits apply because ${why.join(" and ")}. An owner can lift them in Settings → Compliance.`,
    caps,
  };
}

export function formatUsdc(micro: bigint): string {
  const whole = micro / USDC;
  const frac = micro % USDC;
  return frac === 0n
    ? whole.toString()
    : `${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}
