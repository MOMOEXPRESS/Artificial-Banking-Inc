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
  /**
   * IANA zone the quiet-hours window is expressed in (e.g. "Europe/London").
   * Defaults to UTC. Without this the window was always UTC, so an APAC team
   * setting 22:00–06:00 got a block in the middle of their working day.
   */
  quietHoursTimezone?: string;
  /**
   * Ceiling on what the WHOLE organization may spend in a rolling 24h window.
   *
   * `dailyMaxMicro` is per agent, so twenty agents under a "$50 daily max"
   * could spend $1,000/day with nothing to stop them. Omitted means no
   * org-level ceiling, which is the pre-existing behaviour.
   */
  orgDailyMaxMicro?: MicroUsdc;
  /** Shared rolling 24h ceilings for individual pay_api destinations across all agents. */
  merchantDailyCaps?: Record<string, MicroUsdc>;
  /** Settled org spend for this exact destination, injected by the runtime. */
  merchantSpentLast24hMicro?: MicroUsdc;
  /**
   * Per-category ceilings (P6-T3), keyed by lowercase category.
   *
   * Amount + destination + time says nothing about WHAT the money is for,
   * which is how finance teams actually reason about budgets: "cap inference
   * spend at $200/day, but never cap security tooling". A category with no
   * entry here is governed by the agent/org caps alone.
   */
  categoryCaps?: Record<string, CategoryCap>;
  /** Category of this intent's destination, resolved by the runtime. */
  destinationCategory?: string;
  /** Spent by this agent in this category, rolling 24h (micro). */
  categorySpentLast24hMicro?: MicroUsdc;
  /**
   * Time-boxed budget (P6-T4). A budget with an end date and a total ceiling:
   * "this campaign gets $5,000 through March 31, then stops." Also the natural
   * safety expiry for an agent nobody remembers deploying.
   */
  budgetWindow?: BudgetWindow;
  /** Spent inside the current budget window (micro), injected by the runtime. */
  windowSpentMicro?: MicroUsdc;
  /**
   * Send payments to review when the counterparty's risk score exceeds this
   * (0–100, higher is riskier). Omitted disables scoring, which is the
   * pre-existing behaviour: an allowlist hit was the only signal.
   */
  counterpartyRiskReviewAbove?: number;
  /** Facts about this destination, injected by the runtime for scoring. */
  counterpartyStats?: CounterpartyStats;
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
  /**
   * Snapshot of the spending wallet's available balance (micro), injected by
   * the runtime so `balance_below` automation can match without the policy
   * package reading the ledger.
   */
  walletBalanceMicro?: MicroUsdc;
  /** Lowercase destinations seen before (addresses/domains/vendors) */
  knownCounterparties: string[];
  /** Spent by THIS AGENT in a rolling 24h window (micro). */
  spentLast24hMicro: MicroUsdc;
  /** Spent by the whole org in a rolling 24h window (micro). */
  orgSpentLast24hMicro?: MicroUsdc;
  /**
   * When this destination was first seen, epoch ms. Undefined means never.
   * Drives the new-counterparty cooldown, which previously ignored its own
   * hours setting entirely.
   */
  counterpartyFirstSeenMs?: number;
  /** Pays in last 60 seconds */
  paysLastMinute: number;
  agentFrozen: boolean;
  orgFrozen: boolean;
}

/** A ceiling that applies only to spend in one category. */
export interface CategoryCap {
  perTxMaxMicro?: MicroUsdc;
  dailyMaxMicro?: MicroUsdc;
  hitlAboveMicro?: MicroUsdc;
  /** Refuse this category outright — a blocklist expressed by purpose. */
  blocked?: boolean;
}

/** A budget with a start, an end, and a total it may never exceed. */
export interface BudgetWindow {
  /** Epoch ms. Spending before this is refused. Omitted means "already open". */
  startsAtMs?: number;
  /** Epoch ms. Spending after this is refused. Omitted means "never expires". */
  endsAtMs?: number;
  /** Total spendable inside the window (micro). Omitted means no total cap. */
  totalMaxMicro?: MicroUsdc;
  /** Human label for the audit trail, e.g. "Q1 paid-acquisition test". */
  label?: string;
}

/** What the runtime knows about a destination, for risk scoring. */
export interface CounterpartyStats {
  /** Epoch ms first seen. Undefined means never paid before. */
  firstSeenMs?: number;
  /** Successful payments to this destination, all time. */
  payCount?: number;
  /** Total ever paid to this destination (micro). */
  totalPaidMicro?: MicroUsdc;
  /** Compliance screening result, when a screener has run. */
  screened?: "clear" | "flagged" | "unknown";
}

/**
 * Risk score for a counterparty, 0 (established) to 100 (unknown).
 *
 * Deliberately a small, explainable function rather than a learned model: an
 * operator has to be able to read a denial reason and agree with it. Learned
 * baselines are S-6, and they need production data this system does not have.
 */
export function counterpartyRiskScore(
  stats: CounterpartyStats | undefined,
  nowMs: number = Date.now(),
): { score: number; factors: string[] } {
  const factors: string[] = [];
  if (!stats || (stats.firstSeenMs === undefined && !stats.payCount)) {
    return { score: 100, factors: ["never paid before"] };
  }
  if (stats.screened === "flagged") {
    return { score: 100, factors: ["flagged by compliance screening"] };
  }

  let score = 0;
  // Age. A counterparty known for a month is meaningfully safer than one
  // known for an hour; past 30 days the age signal stops carrying weight.
  const ageDays =
    stats.firstSeenMs === undefined ? 0 : Math.max(0, (nowMs - stats.firstSeenMs) / 86_400_000);
  const ageScore = Math.round(50 * (1 - Math.min(ageDays, 30) / 30));
  if (ageScore > 0)
    factors.push(`known for ${ageDays < 1 ? "less than a day" : `${Math.floor(ageDays)}d`}`);
  score += ageScore;

  // History. Repeat payments are the strongest cheap signal of a real vendor.
  const pays = stats.payCount ?? 0;
  const payScore = Math.round(30 * (1 - Math.min(pays, 10) / 10));
  if (payScore > 0) factors.push(`${pays} prior payment${pays === 1 ? "" : "s"}`);
  score += payScore;

  // Screening. Unknown is a mild penalty, not a block: most orgs run no
  // screener, and treating that as risk would flag every payment they make.
  if (stats.screened !== "clear") {
    score += 20;
    factors.push("not screened");
  }

  return { score: Math.max(0, Math.min(100, score)), factors };
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
  /** ISO timestamp when the rule was first saved (server-stamped). */
  createdAt?: string;
  /** ISO timestamp of last edit (server-stamped). */
  updatedAt?: string;
}

export type AutomationCondition =
  | { kind: "amount_above"; micro: MicroUsdc }
  | {
      kind: "balance_below";
      micro: MicroUsdc;
      /** reserved: wallet id when multi-wallet lands */ walletId?: string;
    }
  | { kind: "merchant_unknown" }
  /** @deprecated use daily_cap_exceeded — kept for stored policies */
  | { kind: "budget_exceeded" }
  | { kind: "daily_cap_exceeded" };

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

/**
 * Hour of day in a given IANA zone, honouring DST.
 *
 * Falls back to UTC for an unrecognised zone rather than throwing: a typo in a
 * settings field must not make every payment fail.
 */
function hourInZone(nowMs: number, timezone?: string): number {
  const d = new Date(nowMs);
  if (!timezone || timezone.toUpperCase() === "UTC") return d.getUTCHours();
  try {
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(d);
    const n = Number(hour);
    return Number.isFinite(n) ? n % 24 : d.getUTCHours();
  } catch {
    return d.getUTCHours();
  }
}

/**
 * True when the local hour falls inside the window, handling midnight wrap.
 *
 * The window used to be evaluated in UTC only, so a team in Asia setting
 * 22:00-06:00 got a spending block in the middle of their working day.
 */
function inQuietHours(
  q: { startHour: number; endHour: number; action: "review" | "deny" },
  nowMs: number,
  timezone?: string,
): boolean {
  const hour = hourInZone(nowMs, timezone);
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

  // Organization-wide ceiling. `dailyMaxMicro` is per agent, so without this a
  // fleet of individually-compliant agents could spend an unbounded multiple
  // of the limit the operator thought they had set.
  if (
    rules.orgDailyMaxMicro !== undefined &&
    (rules.orgSpentLast24hMicro ?? 0n) + intent.amountMicro > rules.orgDailyMaxMicro
  ) {
    return {
      outcome: "deny",
      ruleIds: ["org_daily_max"],
      reasons: ["Exceeds the organization's daily spending cap"],
      policyVersion,
    };
  }

  if (intent.tool === "pay_api") {
    const cap = rules.merchantDailyCaps?.[intent.destination.trim().toLowerCase()];
    if (cap !== undefined && (rules.merchantSpentLast24hMicro ?? 0n) + intent.amountMicro > cap) {
      return {
        outcome: "deny",
        ruleIds: ["merchant_daily_max"],
        reasons: [`Exceeds the organization's rolling 24h cap for ${intent.destination}`],
        policyVersion,
      };
    }
  }

  // Time-boxed budget (P6-T4). Checked with the hard caps because an expired
  // budget is a spending ceiling of zero, not a soft signal.
  if (rules.budgetWindow) {
    const now = rules.nowMs ?? Date.now();
    const { startsAtMs, endsAtMs, totalMaxMicro, label } = rules.budgetWindow;
    const name = label ? `Budget "${label}"` : "This budget";
    if (startsAtMs !== undefined && now < startsAtMs) {
      return {
        outcome: "deny",
        ruleIds: ["budget_window_not_started"],
        reasons: [`${name} has not started yet`],
        policyVersion,
      };
    }
    if (endsAtMs !== undefined && now > endsAtMs) {
      return {
        outcome: "deny",
        ruleIds: ["budget_window_expired"],
        reasons: [`${name} expired`],
        policyVersion,
      };
    }
    if (
      totalMaxMicro !== undefined &&
      (rules.windowSpentMicro ?? 0n) + intent.amountMicro > totalMaxMicro
    ) {
      return {
        outcome: "deny",
        ruleIds: ["budget_window_exhausted"],
        reasons: [`${name} has no remaining balance for this payment`],
        policyVersion,
      };
    }
  }

  // Category ceilings (P6-T3). Only the destination's own category applies;
  // an uncategorised destination is governed by the agent/org caps alone.
  const category = rules.destinationCategory ? norm(rules.destinationCategory) : undefined;
  const categoryCap = category ? rules.categoryCaps?.[category] : undefined;
  if (categoryCap) {
    if (categoryCap.blocked) {
      return {
        outcome: "deny",
        ruleIds: ["category_blocked"],
        reasons: [`Spending on ${category} is not permitted`],
        policyVersion,
      };
    }
    if (categoryCap.perTxMaxMicro !== undefined && intent.amountMicro > categoryCap.perTxMaxMicro) {
      return {
        outcome: "deny",
        ruleIds: ["category_per_tx_max"],
        reasons: [`Exceeds the per-payment max for ${category}`],
        policyVersion,
      };
    }
    if (
      categoryCap.dailyMaxMicro !== undefined &&
      (rules.categorySpentLast24hMicro ?? 0n) + intent.amountMicro > categoryCap.dailyMaxMicro
    ) {
      return {
        outcome: "deny",
        ruleIds: ["category_daily_max"],
        reasons: [`Exceeds the daily cap for ${category}`],
        policyVersion,
      };
    }
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

  // New-counterparty cooldown.
  //
  // This used to treat any nonzero `newCounterpartyCooldownHours` as a boolean:
  // an unknown destination always went to review and the hours were never read,
  // so a control the UI presents as "hours" did nothing of the sort. It now
  // means what it says - a destination stays in cooldown until it has been
  // known for that long.
  const known = new Set(rules.knownCounterparties.map(norm));
  const isKnown = known.has(dest) || known.has(norm(intent.destination));
  if (rules.newCounterpartyCooldownHours > 0) {
    if (!isKnown) {
      ruleIds.push("new_counterparty");
      reasons.push("First payment to this counterparty requires approval");
      return { outcome: "review", ruleIds, reasons, policyVersion };
    }
    // Known, but possibly not for long enough yet.
    //
    // An absent first-seen timestamp means the counterparty predates the
    // column. Treat it as long-established rather than in-cooldown: failing
    // closed here would drop every previously-trusted vendor back into
    // approval the moment this shipped, which is a worse failure than the one
    // it would guard against.
    const firstSeen = rules.counterpartyFirstSeenMs;
    if (firstSeen !== undefined) {
      const cooldownMs = rules.newCounterpartyCooldownHours * 3_600_000;
      const now = rules.nowMs ?? Date.now();
      if (now - firstSeen < cooldownMs) {
        ruleIds.push("new_counterparty");
        reasons.push(
          `Counterparty is still within its ${rules.newCounterpartyCooldownHours}h cooldown`,
        );
        return { outcome: "review", ruleIds, reasons, policyVersion };
      }
    }
  }

  if (
    rules.quietHours &&
    inQuietHours(rules.quietHours, rules.nowMs ?? Date.now(), rules.quietHoursTimezone)
  ) {
    const { startHour, endHour, action } = rules.quietHours;
    const zone = rules.quietHoursTimezone ?? "UTC";
    const window = `${String(startHour).padStart(2, "0")}:00–${String(endHour).padStart(2, "0")}:00 ${zone}`;
    ruleIds.push("quiet_hours");
    reasons.push(
      action === "deny"
        ? `Spending is blocked during quiet hours (${window})`
        : `Spending during quiet hours (${window}) requires approval`,
    );
    return { outcome: action, ruleIds, reasons, policyVersion };
  }

  if (
    categoryCap?.hitlAboveMicro !== undefined &&
    intent.amountMicro > categoryCap.hitlAboveMicro
  ) {
    ruleIds.push("category_hitl_above");
    reasons.push(`Amount requires human approval for ${category} spend`);
    return { outcome: "review", ruleIds, reasons, policyVersion };
  }

  // Counterparty risk (P6-T3) — graduated, where the allowlist is binary.
  // Runs after the allowlist so an allowlisted-but-brand-new vendor can still
  // be parked for a look, and before the amount threshold so the reason a
  // payment parked is the more specific one.
  if (rules.counterpartyRiskReviewAbove !== undefined) {
    const { score, factors } = counterpartyRiskScore(
      rules.counterpartyStats,
      rules.nowMs ?? Date.now(),
    );
    if (score > rules.counterpartyRiskReviewAbove) {
      ruleIds.push("counterparty_risk");
      reasons.push(
        `Counterparty risk ${score}/100 exceeds the ${rules.counterpartyRiskReviewAbove} threshold (${factors.join(", ")})`,
      );
      return { outcome: "review", ruleIds, reasons, policyVersion };
    }
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
      // Runtime injects walletBalanceMicro (agent available today; walletId later).
      void when.walletId;
      if (rules.walletBalanceMicro === undefined) return false;
      return rules.walletBalanceMicro < when.micro;
    case "merchant_unknown": {
      const key = destinationKey(intent.destination);
      return !rules.knownCounterparties.map(norm).includes(key);
    }
    case "budget_exceeded":
    case "daily_cap_exceeded":
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

/**
 * Persisted policy template — runtime fields (spent, frozen, counterparties,
 * wallet balance) are injected by `rulesFor` and never stored.
 */
export type PolicyTemplate = Omit<
  PolicyRules,
  | "knownCounterparties"
  | "spentLast24hMicro"
  | "orgSpentLast24hMicro"
  | "merchantSpentLast24hMicro"
  | "counterpartyFirstSeenMs"
  // Runtime-injected facts about THIS intent, not configuration an operator
  // sets. Leaving them settable would let a stored policy pin its own
  // "spent so far" and disable the caps that read it.
  | "destinationCategory"
  | "categorySpentLast24hMicro"
  | "windowSpentMicro"
  | "counterpartyStats"
  | "paysLastMinute"
  | "agentFrozen"
  | "orgFrozen"
  | "walletBalanceMicro"
  | "nowMs"
>;

/**
 * A per-agent override. Every field is optional; anything omitted inherits the
 * organization default.
 *
 * Allowlists REPLACE rather than merge. A narrower list is usually the whole
 * point of an override, and silently unioning would widen it - the opposite of
 * what an operator setting a stricter policy expects.
 */
export type PolicyOverride = Partial<PolicyTemplate>;

/** Which layer supplied each effective value, for explainability. */
export type PolicyProvenance = Record<string, "org" | "agent">;

/**
 * Merge an org template with an optional per-agent override.
 *
 * Returns the effective template plus provenance, so a decision can say *why*
 * a limit applied rather than leaving an operator to guess which layer won.
 */
export function resolvePolicy(
  orgTemplate: PolicyTemplate,
  override?: PolicyOverride | null,
): { effective: PolicyTemplate; provenance: PolicyProvenance } {
  const effective = { ...orgTemplate };
  const provenance: PolicyProvenance = {};
  for (const key of Object.keys(orgTemplate)) {
    provenance[key] = "org";
  }
  if (!override) return { effective, provenance };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    (effective as Record<string, unknown>)[key] = value;
    provenance[key] = "agent";
  }
  return { effective, provenance };
}

export function templateSoloSwarm(): PolicyTemplate {
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
    automation: [],
  };
}

/** Multi-agent desk — tighter per-tx, shared vendor list, overnight quiet hours. */
export function templateSwarm(): PolicyTemplate {
  return {
    perTxMaxMicro: 15_000_000n,
    dailyMaxMicro: 40_000_000n,
    maxPaysPerMinute: 8,
    newCounterpartyCooldownHours: 48,
    hitlAboveMicro: 5_000_000n,
    addressAllowlist: [],
    domainAllowlist: [],
    vendorAllowlist: ["api.openai.com", "api.anthropic.com", "data.example"],
    blocklist: [],
    hitlCategories: ["withdraw", "transfer_internal"],
    quietHours: { startHour: 22, endHour: 6, action: "review" },
    approvalQuorum: 1,
    automation: [
      {
        id: "auto_unknown_merchant",
        name: "Unknown merchant → approval",
        when: { kind: "merchant_unknown" },
        then: { kind: "require_approval" },
      },
    ],
  };
}

/** API seller / x402-heavy — higher velocity, domain allowlist focus. */
export function templateApiSeller(): PolicyTemplate {
  return {
    perTxMaxMicro: 50_000_000n,
    dailyMaxMicro: 200_000_000n,
    maxPaysPerMinute: 30,
    newCounterpartyCooldownHours: 0,
    hitlAboveMicro: 25_000_000n,
    addressAllowlist: [],
    // Deliberately empty. This shipped with ["localhost"], which let any agent
    // on an org using this template drive server-side fetches into the host's
    // own network via pay_api. Local sellers are allowlisted per-org by the
    // demo seeder instead, and only where local targets are permitted.
    domainAllowlist: [],
    vendorAllowlist: [],
    blocklist: [],
    hitlCategories: ["withdraw"],
    approvalQuorum: 1,
    automation: [
      {
        id: "auto_large_pay",
        name: "Large payment → notify",
        when: { kind: "amount_above", micro: 20_000_000n },
        then: { kind: "notify", channel: "in_app" },
      },
    ],
  };
}

export type PolicyTemplateId = "solo_swarm" | "swarm" | "api_seller";

export function policyTemplateById(id: PolicyTemplateId): PolicyTemplate {
  switch (id) {
    case "swarm":
      return templateSwarm();
    case "api_seller":
      return templateApiSeller();
    case "solo_swarm":
    default:
      return templateSoloSwarm();
  }
}

export function listPolicyTemplateCatalog(): {
  id: PolicyTemplateId;
  name: string;
  description: string;
}[] {
  return [
    {
      id: "solo_swarm",
      name: "Solo swarm",
      description: "Default demo — $10 HITL, $25 per-tx, OpenAI allowlisted.",
    },
    {
      id: "swarm",
      name: "Research swarm",
      description: "Tighter caps, overnight quiet hours, unknown-merchant HITL.",
    },
    {
      id: "api_seller",
      name: "API seller",
      description: "Higher velocity for x402 / machine payments; large-pay notify.",
    },
  ];
}

/** Rules whose `when` matches — used by the API to fire notify/freeze side-effects. */
export function matchedAutomationRules(intent: MoneyIntent, rules: PolicyRules): AutomationRule[] {
  return (rules.automation ?? []).filter((rule) => conditionMatches(rule.when, intent, rules));
}
