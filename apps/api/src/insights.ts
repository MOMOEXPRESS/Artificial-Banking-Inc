/**
 * Insights: turns the org's own ledger, decisions and invoices into plain
 * English — a period summary, highlight cards, and answers to questions the
 * guardian asks in the console.
 *
 * This is deterministic analysis over your data, not a language model: every
 * sentence is derived from a number you can click through to. An LLM can be
 * layered on later for phrasing, but the facts come from here so they are
 * always true.
 */
import { formatMicroToUsdc, type MicroUsdc } from "@policyvault/common";
import { currentRevision, store } from "./store.js";

export interface Highlight {
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad" | "info";
  hint: string;
}

export interface Summary {
  headline: string;
  body: string;
  highlights: Highlight[];
  generatedAt: string;
}

/** Money for humans: always a currency symbol and two decimals. */
const usd = (m: MicroUsdc) =>
  `$${Number(formatMicroToUsdc(m)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const usdNum = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100));

function windowed<T extends { at?: string; createdAt?: string; issuedAt?: string }>(
  rows: T[],
  hours: number,
): T[] {
  const cutoff = Date.now() - hours * 3600_000;
  return rows.filter((r) => {
    const t = new Date(r.at ?? r.createdAt ?? r.issuedAt ?? 0).getTime();
    return t >= cutoff;
  });
}

/**
 * Cached on the store's revision: the summary is a pure read over stored rows,
 * so it only changes when something is written. Without this it recomputes on
 * every 4-second console poll (~24ms of blocking work at scale).
 */
const summaryCache = new Map<string, { rev: number; value: Summary }>();

export function buildSummary(orgId: string, hours = 24): Summary {
  const key = `${orgId}:${hours}`;
  const slot = summaryCache.get(key);
  if (slot && slot.rev === currentRevision()) return slot.value;
  const value = buildSummaryUncached(orgId, hours);
  summaryCache.set(key, { rev: currentRevision(), value });
  return value;
}

function buildSummaryUncached(orgId: string, hours = 24): Summary {
  const decisions = store.listDecisions(orgId, 500);
  const recent = windowed(decisions, hours);
  const prior = decisions.filter((d) => {
    const t = new Date(d.at).getTime();
    return t < Date.now() - hours * 3600_000 && t >= Date.now() - hours * 2 * 3600_000;
  });

  const spendOf = (rows: typeof decisions) =>
    rows.filter((d) => d.outcome === "allow").reduce((a, d) => a + Number(d.amountUsdc), 0);
  const spend = spendOf(recent);
  const priorSpend = spendOf(prior);
  const change = priorSpend > 0 ? Math.round(((spend - priorSpend) / priorSpend) * 100) : null;

  const denied = recent.filter((d) => d.outcome === "deny");
  const reviewed = recent.filter((d) => d.outcome === "review");
  const approvals = store.listApprovals(orgId, undefined, 200);
  const pending = approvals.filter((a) => a.status === "pending");
  const escrows = store.listEscrows(orgId, 200);
  const locked = escrows.filter((e) => e.state === "locked");
  const invoices = store.listInvoices(orgId);
  const paid = invoices.filter((i) => i.status === "paid");
  const outstanding = invoices.filter((i) => i.status === "sent" || i.status === "overdue");
  const revenue = paid.reduce((a, i) => a + i.amountMicro, 0n);
  const owed = outstanding.reduce((a, i) => a + i.amountMicro, 0n);

  // Vendor concentration
  const byDest = new Map<string, number>();
  for (const d of recent.filter((x) => x.outcome === "allow")) {
    const key = d.destination.replace(/^https?:\/\//, "").split("/")[0];
    byDest.set(key, (byDest.get(key) ?? 0) + Number(d.amountUsdc));
  }
  const topVendor = [...byDest.entries()].sort((a, b) => b[1] - a[1])[0];

  // Agent nearing its cap
  const template = store.getPolicyTemplate(orgId);
  const dailyMax = Number(formatMicroToUsdc(template.dailyMaxMicro));
  const hot = store
    .listAgents(orgId)
    .map((a) => ({ name: a.name, spent: Number(formatMicroToUsdc(store.spentLast24h(a.id))) }))
    .filter((a) => dailyMax > 0 && a.spent / dailyMax >= 0.75)
    .sort((a, b) => b.spent - a.spent)[0];

  const frozenAgents = store.listAgents(orgId).filter((a) => a.status === "frozen");
  const recon = store.reconcileOrg(orgId);
  const failedHooks = store.listDeliveries(orgId, 100).filter((d) => d.status === "failed");

  /* ---------------------------------------------------------- narrative */
  const period = hours === 24 ? "the last 24 hours" : `the last ${hours} hours`;
  const sentences: string[] = [];

  if (recent.length === 0) {
    sentences.push(
      `No agent activity in ${period}. Balances are untouched and nothing is waiting on you.`,
    );
  } else {
    const dir =
      change === null ? "" : change > 0 ? ` — up ${change}% on the prior period` : change < 0 ? ` — down ${Math.abs(change)}% on the prior period` : " — flat on the prior period";
    sentences.push(
      `Agents settled ${usdNum(spend)} across ${recent.filter((d) => d.outcome === "allow").length} payments in ${period}${dir}.`,
    );
    if (topVendor) {
      const share = pct(topVendor[1], spend);
      sentences.push(
        share >= 60
          ? `Spending is concentrated: ${share}% went to ${topVendor[0]}, so an outage or price change there hits you hard.`
          : `The largest counterparty was ${topVendor[0]} at ${share}% of spend.`,
      );
    }
  }

  if (denied.length) {
    const reasons = new Map<string, number>();
    for (const d of denied) reasons.set(d.ruleIds[0] ?? "policy", (reasons.get(d.ruleIds[0] ?? "policy") ?? 0) + 1);
    const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
    sentences.push(
      `The policy engine blocked ${denied.length} attempt${denied.length === 1 ? "" : "s"}, mostly on ${top[0].replace(/_/g, " ")} — that is the guardrail doing its job, not an error.`,
    );
  }

  if (pending.length) {
    const oldest = pending.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
    sentences.push(
      `${pending.length} payment${pending.length === 1 ? " is" : "s are"} parked waiting on you, the oldest since ${new Date(oldest.createdAt).toLocaleTimeString()} — agents are blocked until you decide.`,
    );
  } else if (reviewed.length) {
    sentences.push(`All ${reviewed.length} escalation${reviewed.length === 1 ? "" : "s"} this period have been resolved.`);
  }

  if (locked.length) {
    const total = locked.reduce((a, e) => a + e.amountMicro, 0n);
    sentences.push(
      `${usd(total)} is locked in ${locked.length} open escrow${locked.length === 1 ? "" : "s"}; it auto-refunds if the work is not accepted in time.`,
    );
  }

  if (paid.length || outstanding.length) {
    sentences.push(
      `On the income side you have booked ${usd(revenue)} from ${paid.length} paid invoice${paid.length === 1 ? "" : "s"}${
        owed > 0n ? ` with ${usd(owed)} still outstanding` : ""
      }.`,
    );
  }

  if (hot) {
    sentences.push(
      `${hot.name} has used ${pct(hot.spent, dailyMax)}% of its daily cap — raise the cap or it will start hitting denials.`,
    );
  }
  if (frozenAgents.length) {
    sentences.push(
      `${frozenAgents.map((a) => a.name).join(", ")} ${frozenAgents.length === 1 ? "is" : "are"} frozen and cannot spend at all.`,
    );
  }
  if (!recon.ok) {
    sentences.push(
      `⚠ Ledger reconciliation found drift on ${recon.drift.length} account(s) — investigate before trusting balances.`,
    );
  }
  if (failedHooks.length) {
    sentences.push(`${failedHooks.length} webhook deliveries failed permanently; downstream systems may be out of sync.`);
  }

  const headline =
    pending.length > 0
      ? `${pending.length} decision${pending.length === 1 ? "" : "s"} waiting on you`
      : !recon.ok
        ? "Ledger drift detected"
        : recent.length === 0
          ? "Quiet period — nothing needs you"
          : denied.length > 0
            ? "Activity normal, guardrails holding"
            : "All activity within policy";

  /* --------------------------------------------------------- highlights */
  const highlights: Highlight[] = [
    {
      label: "Spend trend",
      value: change === null ? usdNum(spend) : `${change > 0 ? "+" : ""}${change}%`,
      tone: change !== null && change > 50 ? "warn" : "info",
      hint: change === null ? "no prior period to compare" : `vs ${usdNum(priorSpend)} previously`,
    },
    {
      label: "Blocked",
      value: String(denied.length),
      tone: denied.length > 0 ? "ok" : "info",
      hint: denied.length ? "attempts refused by policy" : "no attempts refused",
    },
    {
      label: "Awaiting you",
      value: String(pending.length),
      tone: pending.length > 0 ? "warn" : "ok",
      hint: pending.length ? "agents blocked right now" : "inbox zero",
    },
    {
      label: "Booked revenue",
      value: usd(revenue),
      tone: revenue > 0n ? "ok" : "info",
      hint: outstanding.length ? `${usd(owed)} outstanding` : "from paid invoices",
    },
  ];

  return {
    headline,
    body: sentences.join(" "),
    highlights,
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ Q & A */

export function answerQuestion(orgId: string, questionRaw: string): { answer: string; goto?: string } {
  const q = questionRaw.toLowerCase().trim();
  const decisions = store.listDecisions(orgId, 500);
  const allow = decisions.filter((d) => d.outcome === "allow");
  const agents = store.listAgents(orgId);
  const accounts = [...store.getAccountMap(orgId).values()];
  const invoices = store.listInvoices(orgId);
  const has = (...words: string[]) => words.some((w) => q.includes(w));

  if (!q) return { answer: "Ask me about spend, denials, agents, approvals, escrow or invoices." };

  if (has("how much", "spend", "spent", "cost")) {
    const day = allow.filter((d) => new Date(d.at).getTime() >= Date.now() - 864e5);
    const total = day.reduce((a, d) => a + Number(d.amountUsdc), 0);
    const all = allow.reduce((a, d) => a + Number(d.amountUsdc), 0);
    return {
      answer: `Agents spent ${usdNum(total)} in the last 24 hours across ${day.length} payments, and ${usdNum(all)} in total since this org was created.`,
      goto: "activity",
    };
  }

  if (has("deny", "denied", "blocked", "refuse", "reject")) {
    const denied = decisions.filter((d) => d.outcome === "deny");
    if (!denied.length) return { answer: "Nothing has been blocked — no agent has tried anything outside policy yet." };
    const byRule = new Map<string, number>();
    for (const d of denied) byRule.set(d.ruleIds[0] ?? "policy", (byRule.get(d.ruleIds[0] ?? "policy") ?? 0) + 1);
    const list = [...byRule.entries()].map(([r, n]) => `${n}× ${r.replace(/_/g, " ")}`).join(", ");
    return { answer: `${denied.length} attempts were blocked: ${list}. The most recent was ${usd(BigInt(Math.round(Number(denied[0].amountUsdc) * 1e6)))} to ${denied[0].destination}.`, goto: "activity" };
  }

  if (has("approval", "waiting", "pending", "approve")) {
    const pending = store.listApprovals(orgId, "pending", 50);
    if (!pending.length) return { answer: "Nothing is waiting on you — inbox zero.", goto: "approvals" };
    return {
      answer: `${pending.length} payment${pending.length === 1 ? "" : "s"} waiting: ${pending
        .map((p) => `${usd(p.amountMicro)} to ${p.destination}`)
        .join("; ")}. Agents stay blocked until you decide.`,
      goto: "approvals",
    };
  }

  if (has("vendor", "who", "where", "counterparty", "paid to")) {
    const byDest = new Map<string, number>();
    for (const d of allow) {
      const k = d.destination.replace(/^https?:\/\//, "").split("/")[0];
      byDest.set(k, (byDest.get(k) ?? 0) + Number(d.amountUsdc));
    }
    const top = [...byDest.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!top.length) return { answer: "No money has left the vault yet." };
    return {
      answer: `Money went to: ${top.map(([k, v]) => `${k} (${usdNum(v)})`).join(", ")}.`,
      goto: "activity",
    };
  }

  if (has("agent", "balance", "budget", "who has")) {
    const lines = agents.map((a) => {
      const bal = accounts.find((x) => x.kind === "agent_available" && x.agentId === a.id);
      return `${a.name}: ${usd(bal?.balanceMicro ?? 0n)}${a.status === "frozen" ? " (frozen)" : ""}`;
    });
    return { answer: `Agent balances — ${lines.join(", ")}.`, goto: "overview" };
  }

  if (has("escrow", "hired", "peer")) {
    const escrows = store.listEscrows(orgId, 100);
    const locked = escrows.filter((e) => e.state === "locked");
    if (!escrows.length) return { answer: "No escrows yet — no agent has hired another." };
    return {
      answer: `${escrows.length} escrow${escrows.length === 1 ? "" : "s"} total, ${locked.length} still locked holding ${usd(locked.reduce((a, e) => a + e.amountMicro, 0n))}.`,
      goto: "escrows",
    };
  }

  if (has("invoice", "revenue", "income", "owed", "billed")) {
    const paid = invoices.filter((i) => i.status === "paid");
    const open = invoices.filter((i) => i.status === "sent" || i.status === "overdue");
    if (!invoices.length) return { answer: "No invoices yet. Create one from the Invoices screen to bill a client for agent work.", goto: "invoices" };
    return {
      answer: `${invoices.length} invoices: ${usd(paid.reduce((a, i) => a + i.amountMicro, 0n))} collected, ${usd(open.reduce((a, i) => a + i.amountMicro, 0n))} outstanding across ${open.length} unpaid.`,
      goto: "invoices",
    };
  }

  if (has("safe", "secure", "risk", "drift", "reconcil")) {
    const recon = store.reconcileOrg(orgId);
    return {
      answer: recon.ok
        ? `Books are clean: ${recon.journalsReplayed} journal entries replayed across ${recon.accountsChecked} accounts with zero drift. Every payment passed the policy engine before it moved.`
        : `⚠ Drift on ${recon.drift.length} accounts — the stored balance disagrees with the journal replay.`,
      goto: "ledger",
    };
  }

  if (has("summary", "what happened", "brief", "overview", "status", "help")) {
    return { answer: buildSummary(orgId).body };
  }

  return {
    answer:
      "I can answer from your own data — try “how much did we spend today”, “what got blocked”, “who did we pay”, “what is waiting on me”, “are the books clean” or “how much revenue”.",
  };
}
