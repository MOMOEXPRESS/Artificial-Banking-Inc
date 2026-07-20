import type { DecisionOutcome, IntentTool, MicroUsdc, MoneyIntent } from "@policyvault/common";

export interface PolicyRules {
  perTxMaxMicro: MicroUsdc;
  dailyMaxMicro: MicroUsdc;
  maxPaysPerMinute: number;
  newCounterpartyCooldownHours: number;
  hitlAboveMicro: MicroUsdc;
  addressAllowlist: string[];
  domainAllowlist: string[];
  vendorAllowlist: string[];
  blocklist: string[];
  hitlCategories: IntentTool[];
  /**
   * Window during which spending is restricted, in UTC hours. Wraps midnight
   * when startHour > endHour (e.g. 22 → 6 is the overnight window).
   */
  quietHours?: { startHour: number; endHour: number; action: "review" | "deny" };
  /** Injectable clock so quiet-hours behaviour is testable and replayable. */
  nowMs?: number;
  /** Distinct guardians required to release a parked payment. Default 1. */
  approvalQuorum?: number;
  /**
   * Optional IF/THEN automation hooks evaluated after hard caps.
   * Kept declarative so a visual rule builder can land later without rewriting
   * the engine — actions are limited to notify / review / deny / freeze_agent.
   */
  automation?: AutomationRule[];
  /** Lowercase destinations seen before (addresses/domains/vendors) */
  knownCounterparties: string[];
  /** Spent in rolling 24h window (micro) */
  spentLast24hMicro: MicroUsdc;
  /** Pays in last 60 seconds */
  paysLastMinute: number;
  agentFrozen: boolean;
  orgFrozen: boolean;
}

/**
 * Declarative automation rule. Conditions are AND-ed; first matching rule wins
 * for side-effect actions that escalate severity (deny > review > notify).
 */
export interface AutomationRule {
  id: string;
  /** Human label for audit / UI. */
  name: string;
  when: AutomationCondition;
  then: AutomationAction;
}

export type AutomationCondition =
  | { kind: "amount_above"; micro: MicroUsdc }
  | { kind: "balance_below"; micro: MicroUsdc; /** reserved: wallet id when multi-wallet lands */ walletId?: string }
  | { kind: "merchant_unknown" }
  | { kind: "budget_exceeded" };

export type AutomationAction =
  | { kind: "notify"; channel?: "in_app" | "telegram" | "email" | "slack" }
  | { kind: "require_approval" }
  | { kind: "deny" }
  | { kind: "freeze_agent" };

export interface PolicyDecision {
  outcome: DecisionOutcome;
  ruleIds: string[];
  reasons: string[];
  policyVersion?: string;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function isAddressLike(dest: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(dest.trim());
}

/** True when the UTC hour of `nowMs` falls inside the window, handling midnight wrap. */
function inQuietHours(
  q: { startHour: number; endHour: number; action: "review" | "deny" },
  nowMs: number,
): boolean {
  const hour = new Date(nowMs).getUTCHours();
  if (q.startHour === q.endHour) return false; // zero-width window = disabled
  return q.startHour < q.endHour
    ? hour >= q.startHour && hour < q.endHour
    : hour >= q.startHour || hour < q.endHour; // wraps midnight
}

function destinationKey(dest: string): string {
  const d = norm(dest);
  try {
    if (d.startsWith("http")) return new URL(d).hostname;
  } catch {
    /* ignore */
  }
  return d;
}

function blocklistMatches(destination: string, rawDestination: string, blocked: string): boolean {
  const blockedKey = destinationKey(blocked);
  const raw = norm(rawDestination);
  if (raw === norm(blocked)) return true;
  if (isAddressLike(blockedKey)) return destination === blockedKey;
  return destination === blockedKey || destination.endsWith(`.${blockedKey}`);
}

/**
 * Deterministic policy engine. Default deny if any hard rule fails.
 * LLM never calls this with free text — only structured MoneyIntent.
 */
export function evaluatePolicy(
  intent: MoneyIntent,
  rules: PolicyRules,
  policyVersion = "v0",
): PolicyDecision {
  const ruleIds: string[] = [];
  const reasons: string[] = [];

  if (rules.orgFrozen) {
    return {
      outcome: "deny",
      ruleIds: ["org_frozen"],
      reasons: ["Organization is frozen"],
      policyVersion,
    };
  }
  if (rules.agentFrozen) {
    return {
      outcome: "deny",
      ruleIds: ["agent_frozen"],
      reasons: ["Agent is frozen"],
      policyVersion,
    };
  }

  const dest = destinationKey(intent.destination);
  if (rules.blocklist.some((blocked) => blocklistMatches(dest, intent.destination, blocked))) {
    return {
      outcome: "deny",
      ruleIds: ["blocklist"],
      reasons: [`Destination is blocklisted: ${intent.destination}`],
      policyVersion,
    };
  }

  if (intent.amountMicro <= 0n) {
    return {
      outcome: "deny",
      ruleIds: ["amount_non_positive"],
      reasons: ["Amount must be positive"],
      policyVersion,
    };
  }

  if (intent.amountMicro > rules.perTxMaxMicro) {
    return {
      outcome: "deny",
      ruleIds: ["per_tx_max"],
      reasons: [`Exceeds per-tx max`],
      policyVersion,
    };
  }

  if (rules.spentLast24hMicro + intent.amountMicro > rules.dailyMaxMicro) {
    return {
      outcome: "deny",
      ruleIds: ["daily_max"],
      reasons: [`Exceeds daily max`],
      policyVersion,
    };
  }

  if (rules.paysLastMinute >= rules.maxPaysPerMinute) {
    return {
      outcome: "deny",
      ruleIds: ["velocity"],
      reasons: [`Too many payments per minute`],
      policyVersion,
    };
  }

  // Allowlist matching.
  //
  // Each list votes ONLY if it is configured. An empty list must never vote
  // "allowed": with OR-combined lists that would let a single empty list wave
  // through every destination, silently disabling the other lists.
  const addrOk =
    rules.addressAllowlist.length > 0 &&
    rules.addressAllowlist.map(norm).includes(norm(intent.destination));
  const vendorOk =
    rules.vendorAllowlist.length > 0 &&
    (rules.vendorAllowlist.map(norm).includes(dest) ||
      rules.vendorAllowlist.map(norm).includes(norm(intent.destination)));
  // Suffix match is anchored on a dot so "api.openai.com.attacker.net" cannot
  // masquerade as "api.openai.com".
  const domainOk =
    rules.domainAllowlist.length > 0 &&
    rules.domainAllowlist.some((d) => {
      const entry = norm(d);
      if (dest === entry) return true;
      // Suffix matches require a dotted domain — bare TLDs like "com" never widen.
      if (!entry.includes(".")) return false;
      return dest.endsWith(`.${entry}`);
    });

  if (intent.tool === "pay" || intent.tool === "withdraw") {
    if (!isAddressLike(intent.destination)) {
      return {
        outcome: "deny",
        ruleIds: ["invalid_address"],
        reasons: ["Destination must be an 0x address for pay/withdraw"],
        policyVersion,
      };
    }
    if (rules.addressAllowlist.length === 0) {
      return {
        outcome: "deny",
        ruleIds: ["allowlist_empty"],
        reasons: ["No address allowlist configured"],
        policyVersion,
      };
    }
    if (!addrOk) {
      return {
        outcome: "deny",
        ruleIds: ["allowlist_miss"],
        reasons: ["Address not on allowlist"],
        policyVersion,
      };
    }
  }

  if (intent.tool === "pay_api") {
    // At least one of the two lists must be configured, and the destination
    // must match a configured one.
    if (rules.vendorAllowlist.length === 0 && rules.domainAllowlist.length === 0) {
      return {
        outcome: "deny",
        ruleIds: ["allowlist_empty"],
        reasons: ["No vendor/domain allowlist configured"],
        policyVersion,
      };
    }
    if (!vendorOk && !domainOk) {
      return {
        outcome: "deny",
        ruleIds: ["allowlist_miss"],
        reasons: ["API vendor/domain not on allowlist"],
        policyVersion,
      };
    }
  }

  const known = new Set(rules.knownCounterparties.map(norm));
  const isNew = !known.has(dest) && !known.has(norm(intent.destination));
  if (isNew && rules.newCounterpartyCooldownHours > 0) {
    // MVP: treat unknown as deny unless HITL path — surface as review if over 0 cooldown
    // Spec: cooldown means wait before first send — for MVP we force review
    ruleIds.push("new_counterparty");
    reasons.push("New counterparty requires approval during cooldown");
    return { outcome: "review", ruleIds, reasons, policyVersion };
  }

  if (rules.quietHours && inQuietHours(rules.quietHours, rules.nowMs ?? Date.now())) {
    const { startHour, endHour, action } = rules.quietHours;
    const window = `${String(startHour).padStart(2, "0")}:00–${String(endHour).padStart(2, "0")}:00 UTC`;
    ruleIds.push("quiet_hours");
    reasons.push(
      action === "deny"
        ? `Spending is blocked during quiet hours (${window})`
        : `Spending during quiet hours (${window}) requires approval`,
    );
    return { outcome: action, ruleIds, reasons, policyVersion };
  }

  if (intent.amountMicro > rules.hitlAboveMicro) {
    ruleIds.push("hitl_above");
    reasons.push("Amount requires human approval");
    return { outcome: "review", ruleIds, reasons, policyVersion };
  }

  if (rules.hitlCategories.includes(intent.tool)) {
    ruleIds.push("hitl_category");
    reasons.push(`Tool ${intent.tool} requires human approval`);
    return { outcome: "review", ruleIds, reasons, policyVersion };
  }

  // Optional automation hooks — evaluated after hard caps so IF/THEN never
  // weakens a deny already decided above.
  const auto = evaluateAutomation(intent, rules);
  if (auto) {
    ruleIds.push(`automation:${auto.ruleId}`);
    reasons.push(auto.reason);
    return { outcome: auto.outcome, ruleIds, reasons, policyVersion };
  }

  ruleIds.push("default_allow");
  reasons.push("All policy checks passed");
  return { outcome: "allow", ruleIds, reasons, policyVersion };
}

function evaluateAutomation(
  intent: MoneyIntent,
  rules: PolicyRules,
): { ruleId: string; reason: string; outcome: DecisionOutcome } | null {
  const list = rules.automation ?? [];
  let escalate: { ruleId: string; reason: string; outcome: DecisionOutcome } | null = null;
  for (const rule of list) {
    if (!conditionMatches(rule.when, intent, rules)) continue;
    const next = actionToOutcome(rule);
    if (!next) continue;
    // freeze_agent is recorded as deny at the policy gate; the engine/API can
    // later honour a side-effect channel. Severity: deny > review.
    if (!escalate || severity(next.outcome) > severity(escalate.outcome)) {
      escalate = next;
    }
  }
  return escalate;
}

function severity(o: DecisionOutcome): number {
  return o === "deny" ? 2 : o === "review" ? 1 : 0;
}

function conditionMatches(
  when: AutomationCondition,
  intent: MoneyIntent,
  rules: PolicyRules,
): boolean {
  switch (when.kind) {
    case "amount_above":
      return intent.amountMicro > when.micro;
    case "balance_below":
      // Wallet balance is not on PolicyRules yet — reserved for multi-wallet.
      // Treat as non-matching until the runtime injects a balance snapshot.
      void when.walletId;
      return false;
    case "merchant_unknown": {
      const key = destinationKey(intent.destination);
      return !rules.knownCounterparties.map(norm).includes(key);
    }
    case "budget_exceeded":
      return rules.spentLast24hMicro + intent.amountMicro > rules.dailyMaxMicro;
    default:
      return false;
  }
}

function actionToOutcome(
  rule: AutomationRule,
): { ruleId: string; reason: string; outcome: DecisionOutcome } | null {
  switch (rule.then.kind) {
    case "deny":
    case "freeze_agent":
      return {
        ruleId: rule.id,
        reason: `Automation “${rule.name}” → ${rule.then.kind}`,
        outcome: "deny",
      };
    case "require_approval":
      return {
        ruleId: rule.id,
        reason: `Automation “${rule.name}” → require approval`,
        outcome: "review",
      };
    case "notify":
      // Notify-only rules do not change the money outcome; the notifier layer
      // can subscribe to decisions with ruleIds starting with automation:.
      return null;
    default:
      return null;
  }
}

export function templateSoloSwarm(): Omit<
  PolicyRules,
  | "knownCounterparties"
  | "spentLast24hMicro"
  | "paysLastMinute"
  | "agentFrozen"
  | "orgFrozen"
  | "automation"
> {
  return {
    // Bands must nest: allow < hitlAboveMicro <= review < perTxMaxMicro <= deny
    perTxMaxMicro: 25_000_000n, // $25 hard per-tx ceiling
    dailyMaxMicro: 50_000_000n, // $50
    maxPaysPerMinute: 10,
    newCounterpartyCooldownHours: 24,
    hitlAboveMicro: 10_000_000n, // $10 — above this a guardian must approve
    addressAllowlist: [],
    domainAllowlist: [],
    vendorAllowlist: ["api.openai.com", "data.example"],
    blocklist: [],
    hitlCategories: ["withdraw"],
  };
}
