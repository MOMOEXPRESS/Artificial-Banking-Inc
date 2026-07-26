/**
 * Analytics over the org's own history: policy simulation, vendor ledger,
 * burn-rate forecasting and anomaly scoring.
 *
 * Everything here is derived from stored rows — no estimates, no models. The
 * simulator in particular replays real decisions against a candidate ruleset
 * so "what would this change have done" is answered with your actual traffic.
 */
import { formatMicroToUsdc, normalizeHitlCategories, parseUsdcToMicro, type MicroUsdc } from "@policyvault/common";
import { evaluatePolicy, type PolicyRules } from "@policyvault/policy";
import { currentRevision, store } from "./store.js";

/**
 * Raw decimal string for JSON fields — the console runs arithmetic on these,
 * so they must stay parseable by Number().
 */
const usd = (m: MicroUsdc) => formatMicroToUsdc(m);

/** Money inside human sentences, where a bare "13.2" reads as a bug. */
const usdText = (m: MicroUsdc) =>
  `$${Number(formatMicroToUsdc(m)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/* ========================================================== simulator */

export interface SimulationChange {
  perTxMaxUsdc?: string;
  dailyMaxUsdc?: string;
  hitlAboveUsdc?: string;
  maxPaysPerMinute?: number;
  newCounterpartyCooldownHours?: number;
  addressAllowlist?: string[];
  domainAllowlist?: string[];
  vendorAllowlist?: string[];
  blocklist?: string[];
  hitlCategories?: string[];
  quietHours?: { startHour: number; endHour: number; action: "review" | "deny" } | null;
}

export interface SimulationResult {
  sampled: number;
  windowHours: number;
  current: Record<string, number>;
  proposed: Record<string, number>;
  changed: {
    at: string;
    agentName: string;
    tool: string;
    amountUsdc: string;
    destination: string;
    from: string;
    to: string;
    reason: string;
  }[];
  extraApprovalsPerDay: number;
  valueNewlyBlockedUsdc: string;
  valueNewlyAllowedUsdc: string;
  verdict: string;
}

/**
 * Replay historical intents against a proposed ruleset.
 *
 * Honest limitation: rolling-window state (24h spend, per-minute velocity) is
 * reconstructed from the decision log as it advances, so velocity outcomes are
 * approximate for very old history. Amount and allowlist rules — the ones
 * people actually tune — replay exactly.
 */
export function simulatePolicy(
  orgId: string,
  change: SimulationChange,
  windowHours = 24 * 7,
): SimulationResult {
  const base = store.getPolicyTemplate(orgId);
  const agents = store.listAgents(orgId);
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id.slice(0, 10);

  const proposed = {
    ...base,
    ...(change.perTxMaxUsdc !== undefined && { perTxMaxMicro: parseUsdcToMicro(change.perTxMaxUsdc) }),
    ...(change.dailyMaxUsdc !== undefined && { dailyMaxMicro: parseUsdcToMicro(change.dailyMaxUsdc) }),
    ...(change.hitlAboveUsdc !== undefined && { hitlAboveMicro: parseUsdcToMicro(change.hitlAboveUsdc) }),
    ...(change.maxPaysPerMinute !== undefined && { maxPaysPerMinute: change.maxPaysPerMinute }),
    ...(change.newCounterpartyCooldownHours !== undefined && {
      newCounterpartyCooldownHours: change.newCounterpartyCooldownHours,
    }),
    ...(change.addressAllowlist && { addressAllowlist: change.addressAllowlist }),
    ...(change.domainAllowlist && { domainAllowlist: change.domainAllowlist }),
    ...(change.vendorAllowlist && { vendorAllowlist: change.vendorAllowlist }),
    ...(change.blocklist && { blocklist: change.blocklist }),
    ...(change.hitlCategories && {
      hitlCategories: normalizeHitlCategories(change.hitlCategories),
    }),
    ...(change.quietHours !== undefined && {
      quietHours: change.quietHours ?? undefined,
    }),
  };

  const cutoff = Date.now() - windowHours * 3600_000;
  const history = store
    .listDecisions(orgId, 1000)
    .filter((d) => new Date(d.at).getTime() >= cutoff)
    .filter((d) => d.tool === "pay" || d.tool === "pay_api" || d.tool === "escrow_lock")
    .reverse(); // oldest first so rolling state accumulates correctly

  const known = new Set(store.knownCounterparties(orgId));
  for (const a of agents) known.add(a.id);

  const counters = new Map<string, { spent: bigint; recent: number[] }>();
  const tally = (o: string, m: Record<string, number>) => (m[o] = (m[o] ?? 0) + 1);
  const currentCounts: Record<string, number> = {};
  const proposedCounts: Record<string, number> = {};
  const changed: SimulationResult["changed"] = [];
  let newlyBlocked = 0n;
  let newlyAllowed = 0n;

  for (const d of history) {
    const at = new Date(d.at).getTime();
    const c = counters.get(d.agentId) ?? { spent: 0n, recent: [] };
    c.recent = c.recent.filter((t) => t > at - 60_000);
    const amountMicro = parseUsdcToMicro(d.amountUsdc);

    const rulesFor = (r: typeof base): PolicyRules => ({
      ...r,
      knownCounterparties: [...known],
      spentLast24hMicro: c.spent,
      paysLastMinute: c.recent.length,
      agentFrozen: false,
      orgFrozen: false,
    });

    const intent = {
      agentId: d.agentId,
      orgId,
      tool: d.tool as "pay" | "pay_api" | "escrow_lock",
      amountMicro,
      destination: d.destination,
      idempotencyKey: "sim",
    };

    const nowOutcome = evaluatePolicy(intent, rulesFor(base)).outcome;
    const propDecision = evaluatePolicy(intent, rulesFor(proposed));
    tally(nowOutcome, currentCounts);
    tally(propDecision.outcome, proposedCounts);

    if (nowOutcome !== propDecision.outcome) {
      changed.push({
        at: d.at,
        agentName: agentName(d.agentId),
        tool: d.tool,
        amountUsdc: d.amountUsdc,
        destination: d.destination,
        from: nowOutcome,
        to: propDecision.outcome,
        reason: propDecision.reasons[0] ?? "",
      });
      if (nowOutcome === "allow" && propDecision.outcome !== "allow") newlyBlocked += amountMicro;
      if (nowOutcome !== "allow" && propDecision.outcome === "allow") newlyAllowed += amountMicro;
    }

    // Advance rolling state using what actually happened historically.
    if (d.outcome === "allow") {
      c.spent += amountMicro;
      c.recent.push(at);
      known.add(d.destination.toLowerCase());
    }
    counters.set(d.agentId, c);
  }

  const days = Math.max(windowHours / 24, 1 / 24);
  const extraApprovals = ((proposedCounts.review ?? 0) - (currentCounts.review ?? 0)) / days;

  const verdict = !history.length
    ? "No historical traffic in this window — run some missions first, then simulate."
    : !changed.length
      ? "This change would not have altered a single past decision. Safe, but also inert on your current traffic."
      : `${changed.length} of ${history.length} past decisions would change. ` +
        (extraApprovals > 0
          ? `Expect roughly ${extraApprovals.toFixed(1)} more approval interruptions per day. `
          : extraApprovals < 0
            ? `Roughly ${Math.abs(extraApprovals).toFixed(1)} fewer interruptions per day. `
            : "") +
        (newlyBlocked > 0n ? `${usdText(newlyBlocked)} of past spend would have been stopped. ` : "") +
        (newlyAllowed > 0n ? `${usdText(newlyAllowed)} previously refused would now pass. ` : "");

  return {
    sampled: history.length,
    windowHours,
    current: currentCounts,
    proposed: proposedCounts,
    changed: changed.slice(0, 40),
    extraApprovalsPerDay: Number(extraApprovals.toFixed(2)),
    valueNewlyBlockedUsdc: usd(newlyBlocked),
    valueNewlyAllowedUsdc: usd(newlyAllowed),
    verdict,
  };
}

/* ====================================================== vendor ledger */

export interface VendorRow {
  vendor: string;
  totalUsdc: string;
  payments: number;
  blocked: number;
  firstSeen: string;
  lastSeen: string;
  avgUsdc: string;
  maxUsdc: string;
  trend: number[];
  allowlisted: boolean;
  sharePct: number;
}

export function vendorLedger(orgId: string): { vendors: VendorRow[]; concentrationPct: number } {
  return cachedAnalytic(`vendors:${orgId}`, () => {
    const decisions = store.listDecisions(orgId, 1000);
    const template = store.getPolicyTemplate(orgId);
    const allow = new Set(
      [...template.vendorAllowlist, ...template.domainAllowlist, ...template.addressAllowlist].map((v) =>
        v.toLowerCase(),
      ),
    );

    const map = new Map<
      string,
      { total: bigint; payments: number; blocked: number; first: string; last: string; max: bigint; amounts: number[] }
    >();
    for (const d of decisions) {
      const key = d.destination.replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
      const e =
        map.get(key) ??
        { total: 0n, payments: 0, blocked: 0, first: d.at, last: d.at, max: 0n, amounts: [] };
      const amt = parseUsdcToMicro(d.amountUsdc);
      if (d.outcome === "allow") {
        e.total += amt;
        e.payments++;
        e.amounts.push(Number(d.amountUsdc));
        if (amt > e.max) e.max = amt;
      } else if (d.outcome === "deny") {
        e.blocked++;
      }
      if (d.at < e.first) e.first = d.at;
      if (d.at > e.last) e.last = d.at;
      map.set(key, e);
    }

    const grand = [...map.values()].reduce((a, e) => a + e.total, 0n);
    const vendors: VendorRow[] = [...map.entries()]
      .map(([vendor, e]) => ({
        vendor,
        totalUsdc: usd(e.total),
        payments: e.payments,
        blocked: e.blocked,
        firstSeen: e.first,
        lastSeen: e.last,
        avgUsdc: usd(e.payments ? e.total / BigInt(e.payments) : 0n),
        maxUsdc: usd(e.max),
        trend: e.amounts.slice(-12),
        allowlisted: allow.has(vendor),
        sharePct: grand > 0n ? Math.round((Number(e.total) / Number(grand)) * 100) : 0,
      }))
      .sort((a, b) => Number(b.totalUsdc) - Number(a.totalUsdc));

    return { vendors, concentrationPct: vendors[0]?.sharePct ?? 0 };
  });
}

/* ==================================================== burn forecasting */

export interface BurnForecast {
  perAgent: {
    agentId: string;
    name: string;
    spentTodayUsdc: string;
    dailyCapUsdc: string;
    burnPerHourUsdc: string;
    hoursToCap: number | null;
    exhaustsAt: string | null;
    balanceUsdc: string;
    hoursToEmpty: number | null;
  }[];
  orgRunwayDays: number | null;
  orgBurnPerDayUsdc: string;
  note: string;
}

export function burnForecast(orgId: string): BurnForecast {
  return cachedAnalytic(`burn:${orgId}`, () => {
    const agents = store.listAgents(orgId);
    const accounts = store.getAccountMap(orgId);
    const template = store.getPolicyTemplate(orgId);
    const decisions = store.listDecisions(orgId, 1000).filter((d) => d.outcome === "allow");
    const dailyCap = template.dailyMaxMicro;

    // Observed burn rate over whatever history exists, capped to 24h.
    //
    // The divisor is floored at one hour on purpose: a burst of test payments
    // inside a few seconds would otherwise extrapolate to an absurd "$4,000 a
    // day". Under-stating a rate we cannot yet measure is far better than
    // printing an alarming number that means nothing.
    const now = Date.now();
    const recent = decisions.filter((d) => new Date(d.at).getTime() >= now - 864e5);
    const oldest = recent.length ? Math.min(...recent.map((d) => new Date(d.at).getTime())) : now;
    const observedHours = (now - oldest) / 3600_000;
    const elapsedHours = Math.max(observedHours, 1);
    /** Below this we have not watched long enough to project honestly. */
    const projectable = observedHours >= 0.5 && recent.length >= 3;

    const perAgent = agents.map((a) => {
      const mine = recent.filter((d) => d.agentId === a.id);
      const spent = mine.reduce((s, d) => s + parseUsdcToMicro(d.amountUsdc), 0n);
      const balance = accounts.get(`agent:${a.id}:available`)?.balanceMicro ?? 0n;
      const perHour = projectable ? Number(spent) / 1e6 / elapsedHours : 0;
      const capRemaining = Number(dailyCap - spent) / 1e6;
      const hoursToCap = perHour > 0.0001 ? capRemaining / perHour : null;
      const hoursToEmpty = perHour > 0.0001 ? Number(balance) / 1e6 / perHour : null;
      return {
        agentId: a.id,
        name: a.name,
        spentTodayUsdc: usd(spent),
        dailyCapUsdc: usd(dailyCap),
        burnPerHourUsdc: perHour.toFixed(2),
        hoursToCap: hoursToCap === null ? null : Number(Math.max(hoursToCap, 0).toFixed(1)),
        exhaustsAt:
          hoursToCap === null || hoursToCap > 720
            ? null
            : new Date(now + hoursToCap * 3600_000).toISOString(),
        balanceUsdc: usd(balance),
        hoursToEmpty: hoursToEmpty === null ? null : Number(Math.max(hoursToEmpty, 0).toFixed(1)),
      };
    });

    const orgTreasury = accounts.get(`org:${orgId}:available`)?.balanceMicro ?? 0n;
    const withAgents = [...accounts.values()]
      .filter((x) => x.kind === "agent_available")
      .reduce((s, x) => s + x.balanceMicro, 0n);
    const totalPerDay = perAgent.reduce((s, p) => s + Number(p.burnPerHourUsdc) * 24, 0);
    const runway = totalPerDay > 0.01 ? Number(orgTreasury + withAgents) / 1e6 / totalPerDay : null;

    return {
      perAgent,
      orgRunwayDays: runway === null ? null : Number(runway.toFixed(1)),
      orgBurnPerDayUsdc: totalPerDay.toFixed(2),
      note: !recent.length
        ? "No spending in the last 24 hours — nothing to project from yet."
        : !projectable
          ? `Only ${recent.length} payment${recent.length === 1 ? "" : "s"} over ${
              observedHours < 1 / 60
                ? "a few seconds"
                : `${Math.round(observedHours * 60)} minutes`
            } — too short a window to project a rate from. Come back after an hour of real activity.`
          : `Projected from ${recent.length} payments observed over ${observedHours.toFixed(1)} hours.`,
    };
  });
}

/* ====================================================== anomaly scoring */

export interface Anomaly {
  intentId: string;
  at: string;
  agentName: string;
  amountUsdc: string;
  destination: string;
  score: number;
  signals: string[];
}

/**
 * Confidence-scored oddities in *allowed* spend. These passed policy — the
 * point is to surface things a hard rule would not catch, so a human can
 * tighten the rules if warranted.
 */
export function anomalies(orgId: string): { anomalies: Anomaly[]; scanned: number } {
  return cachedAnalytic(`anomalies:${orgId}`, () => {
    const decisions = store.listDecisions(orgId, 1000);
    const agents = store.listAgents(orgId);
    const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id.slice(0, 10);
    const allowed = decisions.filter((d) => d.outcome === "allow");
    if (allowed.length < 3) return { anomalies: [], scanned: allowed.length };

    const amounts = allowed.map((d) => Number(d.amountUsdc));
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const sd = Math.sqrt(amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length) || 1;

    const seenBefore = new Map<string, string>();
    for (const d of [...allowed].reverse()) {
      const k = d.destination.toLowerCase();
      if (!seenBefore.has(k)) seenBefore.set(k, d.at);
    }

    const out: Anomaly[] = [];
    for (const d of allowed) {
      const amt = Number(d.amountUsdc);
      const signals: string[] = [];
      let score = 0;

      const z = (amt - mean) / sd;
      if (z > 2.5) {
        score += 40;
        signals.push(`${z.toFixed(1)}× standard deviation above your typical payment`);
      } else if (z > 1.5) {
        score += 20;
        signals.push("larger than usual for this org");
      }

      const hour = new Date(d.at).getUTCHours();
      if (hour >= 1 && hour <= 5) {
        score += 20;
        signals.push(`settled at ${String(hour).padStart(2, "0")}:00 UTC, outside normal hours`);
      }

      const firstSeen = seenBefore.get(d.destination.toLowerCase());
      if (firstSeen === d.at) {
        score += 25;
        signals.push("first ever payment to this counterparty");
      }

      const within5m = allowed.filter(
        (o) =>
          o.agentId === d.agentId &&
          Math.abs(new Date(o.at).getTime() - new Date(d.at).getTime()) < 300_000,
      ).length;
      if (within5m >= 5) {
        score += 20;
        signals.push(`${within5m} payments from this agent within 5 minutes`);
      }

      if (score >= 40) {
        out.push({
          intentId: d.intentId,
          at: d.at,
          agentName: agentName(d.agentId),
          amountUsdc: d.amountUsdc,
          destination: d.destination,
          score: Math.min(100, score),
          signals,
        });
      }
    }

    out.sort((a, b) => b.score - a.score);
    return { anomalies: out.slice(0, 25), scanned: allowed.length };
  });
}

/* ================================================= cost per deliverable */

export interface JobEconomics {
  runs: {
    runId: string;
    title: string;
    costUsdc: string;
    revenueUsdc: string;
    marginUsdc: string;
    multiple: number | null;
    invoiceNumber?: string;
    invoiceStatus?: string;
    finishedAt?: string;
  }[];
  totalCostUsdc: string;
  totalRevenueUsdc: string;
  netUsdc: string;
  avgCostUsdc: string;
  avgMultiple: number | null;
  billedCount: number;
  unbilledCount: number;
}

/** Joins what each run cost against what it was billed for — the agent-firm P&L. */
export function jobEconomics(orgId: string): JobEconomics {
  return cachedAnalytic(`econ:${orgId}`, () => {
    const runs = store.listRuns(orgId, 200);
    const invoices = store.listInvoices(orgId);

    const rows = runs.map((r) => {
      const inv = invoices.find((i) => i.runId === r.id);
      const revenue = inv && inv.status === "paid" ? inv.amountMicro : 0n;
      const margin = revenue - r.costMicro;
      return {
        runId: r.id,
        title: r.title,
        costUsdc: usd(r.costMicro),
        revenueUsdc: usd(revenue),
        marginUsdc: usd(margin),
        multiple: r.costMicro > 0n && revenue > 0n ? Number((Number(revenue) / Number(r.costMicro)).toFixed(1)) : null,
        invoiceNumber: inv?.number,
        invoiceStatus: inv?.status,
        finishedAt: r.finishedAt,
      };
    });

    const totalCost = runs.reduce((a, r) => a + r.costMicro, 0n);
    const totalRevenue = rows.reduce((a, r) => a + parseUsdcToMicro(r.revenueUsdc), 0n);
    const multiples = rows.map((r) => r.multiple).filter((m): m is number => m !== null);

    return {
      runs: rows,
      totalCostUsdc: usd(totalCost),
      totalRevenueUsdc: usd(totalRevenue),
      netUsdc: usd(totalRevenue - totalCost),
      avgCostUsdc: usd(runs.length ? totalCost / BigInt(runs.length) : 0n),
      avgMultiple: multiples.length
        ? Number((multiples.reduce((a, b) => a + b, 0) / multiples.length).toFixed(1))
        : null,
      billedCount: rows.filter((r) => r.invoiceNumber).length,
      unbilledCount: rows.filter((r) => !r.invoiceNumber && r.costUsdc !== "0").length,
    };
  });
}

/* ------------------------------------------------------------- caching */

const analyticCache = new Map<string, { rev: number; value: unknown }>();

function cachedAnalytic<T>(key: string, compute: () => T): T {
  const slot = analyticCache.get(key);
  if (slot && slot.rev === currentRevision()) return slot.value as T;
  const value = compute();
  analyticCache.set(key, { rev: currentRevision(), value });
  return value;
}
