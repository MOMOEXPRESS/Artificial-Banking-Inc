/**
 * Read-only org survey tools for the ABI agent.
 * Never moves money or approves payments — facts only.
 * External web actions are HITL proposals only (never auto-executed).
 */
import { accountId, formatMicroToUsdc, parseUsdcToMicro } from "@policyvault/common";
import { anomalies, burnForecast, vendorLedger } from "../analytics.js";
import { buildSummary } from "../insights.js";
import { store } from "../store.js";
import {
  createExternalProposal,
  inferExternalArgs,
  type ExternalActionProposal,
} from "./external-actions.js";
import { quietHoursStatus } from "./quiet.js";

export const TOOL_NAMES = [
  "org_summary",
  "list_agents",
  "agent_detail",
  "pending_approvals",
  "recent_spend",
  "list_budgets",
  "list_denials",
  "top_vendors",
  "invoice_status",
  "escrow_status",
  "books_health",
  "burn_forecast",
  "get_policy",
  "quiet_hours_status",
  "lookup_decision",
  "explain_decision",
  "governance_status",
  "treasury_snapshot",
  "compare_agents",
  "recommend_next",
  "remember_fact",
  "recall_facts",
  "draft_marketing_blurb",
  "propose_external_action",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type ToolResult = {
  tool: ToolName;
  title: string;
  text: string;
  goto?: string;
  externalAction?: ExternalActionProposal;
  /** Structured facts for scratchpad / follow-ups (not always shown). */
  data?: Record<string, unknown>;
};

const usd = (m: bigint) => `$${formatMicroToUsdc(m)}`;

export function runTool(
  orgId: string,
  name: ToolName,
  args: Record<string, unknown> = {},
): ToolResult {
  switch (name) {
    case "org_summary": {
      const s = buildSummary(orgId);
      const highs = s.highlights
        .slice(0, 4)
        .map((h) => `${h.label}: ${h.value}`)
        .join(" · ");
      return {
        tool: name,
        title: "Org snapshot",
        text: `${s.headline}\n${s.body}${highs ? `\nHighlights — ${highs}.` : ""}`,
        goto: "overview",
      };
    }
    case "list_agents": {
      const agents = store.listAgents(orgId).filter((a) => a.status !== "archived");
      if (!agents.length) {
        return { tool: name, title: "Agents", text: "No agents on the roster yet.", goto: "agents" };
      }
      const accounts = store.getAccountMap(orgId);
      const lines = agents.map((a) => {
        const bal = accounts.get(accountId("agent", a.id))?.balanceMicro ?? 0n;
        return `• ${a.name} — ${a.status}, stipend ${usd(bal)}`;
      });
      return {
        tool: name,
        title: "Agents",
        text: `${agents.length} agent${agents.length === 1 ? "" : "s"}:\n${lines.join("\n")}`,
        goto: "agents",
        data: {
          topic: "agents",
          agentIds: agents.map((a) => a.id),
          agentNames: agents.map((a) => a.name),
        },
      };
    }
    case "agent_detail": {
      const agents = store.listAgents(orgId).filter((a) => a.status !== "archived");
      const wantId = String(args.agentId ?? "").trim();
      const wantName = String(args.agentName ?? args.query ?? "").toLowerCase().trim();
      let agent =
        (wantId && agents.find((a) => a.id === wantId)) ||
        (wantName && agents.find((a) => a.name.toLowerCase() === wantName)) ||
        (wantName && agents.find((a) => a.name.toLowerCase().includes(wantName))) ||
        undefined;
      if (!agent && agents.length === 1) agent = agents[0];
      if (!agent) {
        return {
          tool: name,
          title: "Agent detail",
          text: wantName
            ? `No agent matching “${wantName}” — try list_agents for the roster.`
            : "Name an agent (e.g. “How is Researcher?”) for a detail card.",
          goto: "agents",
        };
      }
      const accounts = store.getAccountMap(orgId);
      const bal = accounts.get(accountId("agent", agent.id))?.balanceMicro ?? 0n;
      const spent = store.spentLast24h(agent.id);
      const decisions = store.listDecisionsForAgent(orgId, agent.id, 8);
      const denied = decisions.filter((d) => d.outcome === "deny").length;
      const allowed = decisions.filter((d) => d.outcome === "allow").length;
      const reviewed = decisions.filter((d) => d.outcome === "review").length;
      const freezes = store
        .listFreezes(orgId, 30)
        .filter((f) => f.agentId === agent!.id)
        .slice(0, 2);
      const recent = decisions.slice(0, 4).map(
        (d) =>
          `  · ${d.outcome.toUpperCase()} $${d.amountUsdc} → ${d.destination} (${d.ruleIds[0] ?? "policy"})`,
      );
      const lines = [
        `${agent.name} — ${agent.status}`,
        `Stipend available: ${usd(bal)} · 24h spend: ${usd(spent)}`,
        `Recent outcomes: ${allowed} allow · ${reviewed} review · ${denied} deny (last ${decisions.length} trails)`,
        freezes.length
          ? `Freeze history: ${freezes.map((f) => f.reason).join("; ")}`
          : "No freezes on file.",
        recent.length ? `Latest:\n${recent.join("\n")}` : "No payment decisions yet for this agent.",
      ];
      return {
        tool: name,
        title: `Agent · ${agent.name}`,
        text: lines.join("\n"),
        goto: "agents",
        data: {
          topic: "agents",
          agentIds: [agent.id],
          agentNames: [agent.name],
          destinations: decisions.map((d) => d.destination).slice(0, 5),
        },
      };
    }
    case "pending_approvals": {
      const pending = store.listApprovals(orgId, "pending", 20);
      if (!pending.length) {
        return {
          tool: name,
          title: "Approvals",
          text: "Inbox zero — nothing waiting for your approval.",
          goto: "approvals",
        };
      }
      const lines = pending.map(
        (p) => `• ${usd(p.amountMicro)} → ${p.destination} (${p.reasons[0] ?? "review"})`,
      );
      return {
        tool: name,
        title: "Approvals waiting",
        text: `${pending.length} waiting:\n${lines.join("\n")}`,
        goto: "approvals",
      };
    }
    case "recent_spend": {
      const decisions = store.listDecisions(orgId, 300).filter((d) => d.outcome === "allow");
      const day = decisions.filter((d) => new Date(d.at).getTime() >= Date.now() - 864e5);
      const total = day.reduce((a, d) => a + Number(d.amountUsdc), 0);
      const life = decisions.reduce((a, d) => a + Number(d.amountUsdc), 0);
      return {
        tool: name,
        title: "Spend",
        text: `Last 24h: ${day.length} settled payments · ~$${total.toFixed(2)}.\nLifetime: ~$${life.toFixed(2)} across ${decisions.length} payments.`,
        goto: "activity",
      };
    }
    case "list_budgets": {
      const depts = store.listDepartments(orgId).filter((d) => d.status === "active");
      if (!depts.length) {
        return {
          tool: name,
          title: "Budgets",
          text: "No budgets yet — create one under Treasury → Budgets.",
          goto: "treasury",
        };
      }
      const accounts = store.getAccountMap(orgId);
      const lines = depts.map((d) => {
        const bal = accounts.get(accountId("department", d.id))?.balanceMicro ?? 0n;
        return `• ${d.name} — ${usd(bal)} available`;
      });
      return {
        tool: name,
        title: "Budgets",
        text: lines.join("\n"),
        goto: "treasury",
      };
    }
    case "list_denials": {
      const denied = store.listDecisions(orgId, 300).filter((d) => d.outcome === "deny");
      if (!denied.length) {
        return {
          tool: name,
          title: "Denials",
          text: "Nothing blocked — no agent has tried outside policy yet.",
          goto: "activity",
        };
      }
      const byRule = new Map<string, number>();
      for (const d of denied) {
        const r = d.ruleIds[0] ?? "policy";
        byRule.set(r, (byRule.get(r) ?? 0) + 1);
      }
      const rules = [...byRule.entries()]
        .map(([r, n]) => `${n}× ${r.replace(/_/g, " ")}`)
        .join(", ");
      const last = denied[0]!;
      return {
        tool: name,
        title: "Policy denials",
        text: `${denied.length} blocked. By rule: ${rules}.\nMost recent: $${last.amountUsdc} → ${last.destination}.`,
        goto: "activity",
      };
    }
    case "top_vendors": {
      const { vendors, concentrationPct } = vendorLedger(orgId);
      if (!vendors.length) {
        return {
          tool: name,
          title: "Vendors",
          text: "No external payees yet.",
          goto: "activity",
        };
      }
      const top = vendors.slice(0, 5);
      const lines = top.map((v) => `• ${v.vendor} — $${Number(v.totalUsdc).toFixed(2)}`);
      return {
        tool: name,
        title: "Where money went",
        text: `${lines.join("\n")}\nTop concentration: ${concentrationPct}% of spend.`,
        goto: "activity",
      };
    }
    case "invoice_status": {
      const invoices = store.listInvoices(orgId);
      const paid = invoices.filter((i) => i.status === "paid");
      const open = invoices.filter((i) => i.status === "sent" || i.status === "overdue");
      const revenue = paid.reduce((a, i) => a + i.amountMicro, 0n);
      const owed = open.reduce((a, i) => a + i.amountMicro, 0n);
      return {
        tool: name,
        title: "Invoices",
        text: `${invoices.length} invoices · booked ${usd(revenue)} · outstanding ${usd(owed)} (${open.length} open).`,
        goto: "work",
      };
    }
    case "escrow_status": {
      const escrows = store.listEscrows(orgId, 100);
      const locked = escrows.filter((e) => e.state === "locked");
      const held = locked.reduce((a, e) => a + e.amountMicro, 0n);
      return {
        tool: name,
        title: "Escrow",
        text: `${escrows.length} total · ${locked.length} locked holding ${usd(held)}.`,
        goto: "escrows",
      };
    }
    case "books_health": {
      const r = store.reconcileOrg(orgId);
      if (r.ok) {
        return {
          tool: name,
          title: "Books",
          text: "Reconciliation clean — ledger balances match account totals.",
          goto: "overview",
        };
      }
      return {
        tool: name,
        title: "Books",
        text: `Drift detected: ${JSON.stringify(r.drift).slice(0, 280)}`,
        goto: "overview",
      };
    }
    case "burn_forecast": {
      const b = burnForecast(orgId);
      return {
        tool: name,
        title: "Burn",
        text: `Org burn ~$${Number(b.orgBurnPerDayUsdc ?? 0).toFixed(2)}/day · runway ~${
          b.orgRunwayDays ?? "?"
        } days. ${b.note ?? ""}`.trim(),
        goto: "overview",
      };
    }
    case "get_policy": {
      const t = store.getPolicyTemplate(orgId);
      const hitl = formatMicroToUsdc(t.hitlAboveMicro);
      const cap = formatMicroToUsdc(t.perTxMaxMicro);
      const daily = formatMicroToUsdc(t.dailyMaxMicro);
      const quietLine = t.quietHours
        ? `Quiet hours ${String(t.quietHours.startHour).padStart(2, "0")}:00–${String(t.quietHours.endHour).padStart(2, "0")}:00 UTC · on hit → ${t.quietHours.action}`
        : "Quiet hours off";
      return {
        tool: name,
        title: "Policy bands",
        text: [
          `Ask me above (HITL): $${hitl} — under this settles instantly; above waits for you.`,
          `Per payment ceiling: $${cap} — over this is refused.`,
          `Daily max: $${daily}.`,
          `Max pays / minute: ${t.maxPaysPerMinute}.`,
          quietLine,
          `Quorum: ${t.approvalQuorum ?? 1} guardian vote(s).`,
        ].join("\n"),
        goto: "policy",
        data: {
          hitlAboveUsdc: hitl,
          perTxMaxUsdc: cap,
          dailyMaxUsdc: daily,
          topic: "policy",
        },
      };
    }
    case "quiet_hours_status": {
      const t = store.getPolicyTemplate(orgId);
      if (!t.quietHours || t.quietHours.startHour === t.quietHours.endHour) {
        return {
          tool: name,
          title: "Quiet hours",
          text: "Quiet hours are off — payments use normal allow / review / deny bands around the clock.",
          goto: "policy",
          data: { topic: "quiet", inQuiet: false },
        };
      }
      const st = quietHoursStatus(t.quietHours);
      const action = t.quietHours.action ?? "review";
      return {
        tool: name,
        title: "Quiet hours",
        text: st.inQuiet
          ? `IN QUIET HOURS now (${st.clock}). Ends in ${st.countdown}. Payments that hit quiet hours are sent to ${action}. Window ${String(t.quietHours.startHour).padStart(2, "0")}:00–${String(t.quietHours.endHour).padStart(2, "0")}:00 UTC.`
          : `Open now (${st.clock}). Quiet starts in ${st.countdown}. Window ${String(t.quietHours.startHour).padStart(2, "0")}:00–${String(t.quietHours.endHour).padStart(2, "0")}:00 UTC · on hit → ${action}.`,
        goto: "policy",
        data: { topic: "quiet", inQuiet: st.inQuiet, countdown: st.countdown },
      };
    }
    case "lookup_decision": {
      const q = String(args.query ?? args.destination ?? "").toLowerCase().trim();
      const decisions = store.listDecisions(orgId, 400);
      const matched = q
        ? decisions.filter(
            (d) =>
              d.destination.toLowerCase().includes(q) ||
              d.outcome.toLowerCase().includes(q) ||
              d.ruleIds.some((r) => r.toLowerCase().includes(q)) ||
              d.reasons.some((r) => r.toLowerCase().includes(q)),
          )
        : decisions.filter((d) => d.outcome === "deny").slice(0, 8);
      const rows = (matched.length ? matched : decisions).slice(0, 8);
      if (!rows.length) {
        return {
          tool: name,
          title: "Decisions",
          text: "No matching decisions in the recent trail.",
          goto: "activity",
        };
      }
      const lines = rows.map(
        (d) =>
          `• ${d.outcome.toUpperCase()} $${d.amountUsdc} → ${d.destination} (${d.ruleIds[0] ?? "policy"}) · ${d.reasons[0] ?? ""}`,
      );
      return {
        tool: name,
        title: q ? `Decisions matching “${q}”` : "Recent decisions",
        text: lines.join("\n"),
        goto: "activity",
        data: {
          topic: "decisions",
          destinations: rows.map((d) => d.destination).slice(0, 5),
        },
      };
    }
    case "explain_decision": {
      const q = String(args.query ?? args.destination ?? "").toLowerCase().trim();
      const agentId = String(args.agentId ?? "").trim();
      const decisions = agentId
        ? store.listDecisionsForAgent(orgId, agentId, 80)
        : store.listDecisions(orgId, 400);
      const matched = q
        ? decisions.filter(
            (d) =>
              d.destination.toLowerCase().includes(q) ||
              d.outcome.toLowerCase().includes(q) ||
              d.intentId.toLowerCase().includes(q) ||
              d.ruleIds.some((r) => r.toLowerCase().includes(q)) ||
              d.reasons.some((r) => r.toLowerCase().includes(q)),
          )
        : decisions.filter((d) => d.outcome === "deny" || d.outcome === "review");
      const d = matched[0] ?? decisions[0];
      if (!d) {
        return {
          tool: name,
          title: "Explain decision",
          text: "No decisions to explain yet — once an agent pays, I can map the outcome to policy bands.",
          goto: "activity",
        };
      }
      const t = store.getPolicyTemplate(orgId);
      const agent = store.getAgent(d.agentId);
      let amountMicro = 0n;
      try {
        amountMicro = parseUsdcToMicro(d.amountUsdc);
      } catch {
        amountMicro = 0n;
      }
      const bandNotes: string[] = [];
      if (amountMicro > t.perTxMaxMicro) {
        bandNotes.push(
          `Amount $${d.amountUsdc} is above the per-payment ceiling ($${formatMicroToUsdc(t.perTxMaxMicro)}) → expect deny.`,
        );
      } else if (amountMicro > t.hitlAboveMicro) {
        bandNotes.push(
          `Amount $${d.amountUsdc} is above ask-me-above ($${formatMicroToUsdc(t.hitlAboveMicro)}) → expect HITL review.`,
        );
      } else {
        bandNotes.push(
          `Amount $${d.amountUsdc} is at/under ask-me-above ($${formatMicroToUsdc(t.hitlAboveMicro)}) — auto-allow unless another rule fired.`,
        );
      }
      if (t.quietHours && t.quietHours.startHour !== t.quietHours.endHour) {
        const st = quietHoursStatus(t.quietHours, new Date(d.at));
        if (st.inQuiet) {
          bandNotes.push(
            `Quiet hours were active at decision time → policy action ${t.quietHours.action ?? "review"}.`,
          );
        }
      }
      const text = [
        `${d.outcome.toUpperCase()} $${d.amountUsdc} → ${d.destination}`,
        `Agent: ${agent?.name ?? d.agentId} · at ${d.at}`,
        `Rules: ${d.ruleIds.join(", ") || "policy"}`,
        `Reasons: ${d.reasons.join("; ") || "—"}`,
        "",
        "Band context:",
        ...bandNotes.map((b) => `• ${b}`),
        "",
        `Live bands now: ask-me $${formatMicroToUsdc(t.hitlAboveMicro)} · per-pay $${formatMicroToUsdc(t.perTxMaxMicro)} · daily $${formatMicroToUsdc(t.dailyMaxMicro)}.`,
      ].join("\n");
      return {
        tool: name,
        title: "Why this decision",
        text,
        goto: "activity",
        data: {
          topic: "decisions",
          destinations: [d.destination],
          agentIds: [d.agentId],
          agentNames: agent ? [agent.name] : [],
        },
      };
    }
    case "governance_status": {
      const org = store.getOrg(orgId);
      const guardians = store.listGuardians(orgId).filter((g) => !g.revokedAt);
      const t = store.getPolicyTemplate(orgId);
      const lines: string[] = [
        `• ${org?.name ?? "Org"} founding owner — owner (full approve; org key)`,
      ];
      for (const g of guardians) {
        const bits = [`${g.name} — ${g.role}`];
        if (g.conditions?.restricted) bits.push("restricted");
        if (g.conditions?.maxApproveUsdc) bits.push(`max $${g.conditions.maxApproveUsdc}`);
        if (g.conditions?.note) bits.push(g.conditions.note);
        lines.push(`• ${bits.join(" · ")}`);
      }
      const secondaryApprovers = guardians.filter((g) => g.role === "owner" || g.role === "approver").length;
      const seats = 1 + guardians.length;
      const canApprove = 1 + secondaryApprovers;
      return {
        tool: name,
        title: "Governance",
        text: [
          `${seats} seat${seats === 1 ? "" : "s"} · ${canApprove} can approve · quorum ${t.approvalQuorum ?? 1}`,
          ...lines,
        ].join("\n"),
        goto: "policy",
        data: { topic: "governance" },
      };
    }
    case "treasury_snapshot": {
      const accounts = store.getAccountMap(orgId);
      const vault = accounts.get(accountId("org", orgId))?.balanceMicro ?? 0n;
      const depts = store.listDepartments(orgId).filter((d) => d.status === "active");
      const deptLines = depts.map((d) => {
        const bal = accounts.get(accountId("department", d.id))?.balanceMicro ?? 0n;
        return `• ${d.name} budget — ${usd(bal)}`;
      });
      let holdingsLine = "";
      try {
        const holdings = store.listOrgAssetHoldings(orgId).filter((h) => h.balanceMicro > 0n);
        if (holdings.length) {
          holdingsLine = holdings
            .map((h) => `${h.asset.symbol} ${formatMicroToUsdc(h.balanceMicro)}`)
            .join(" · ");
        }
      } catch {
        /* older DBs */
      }
      return {
        tool: name,
        title: "Treasury",
        text: [
          `Org vault (USDC spend rail): ${usd(vault)}`,
          holdingsLine ? `Other holdings: ${holdingsLine}` : "Other holdings: none credited yet.",
          deptLines.length ? `Budgets:\n${deptLines.join("\n")}` : "No budgets yet.",
        ].join("\n"),
        goto: "treasury",
        data: { topic: "treasury", vaultUsdc: formatMicroToUsdc(vault) },
      };
    }
    case "compare_agents": {
      const agents = store.listAgents(orgId).filter((a) => a.status !== "archived");
      const accounts = store.getAccountMap(orgId);
      if (agents.length < 2) {
        return {
          tool: name,
          title: "Compare agents",
          text: "Need at least two agents on the roster to compare.",
          goto: "agents",
        };
      }
      const ranked = agents
        .map((a) => {
          const bal = accounts.get(accountId("agent", a.id))?.balanceMicro ?? 0n;
          const spent = store.spentLast24h(a.id);
          return { a, bal, spent };
        })
        .sort((x, y) => (y.spent > x.spent ? 1 : y.spent < x.spent ? -1 : 0));
      const lines = ranked.map(
        (r) =>
          `• ${r.a.name} — ${r.a.status}; stipend ${usd(r.bal)}; 24h spend ${usd(r.spent)}`,
      );
      const top = ranked[0]!;
      return {
        tool: name,
        title: "Agent comparison",
        text: `${lines.join("\n")}\nHighest 24h burn: ${top.a.name} (${usd(top.spent)}).`,
        goto: "agents",
        data: {
          topic: "agents",
          agentIds: ranked.map((r) => r.a.id),
          agentNames: ranked.map((r) => r.a.name),
        },
      };
    }
    case "recommend_next": {
      const pending = store.listApprovals(orgId, "pending", 20);
      const t = store.getPolicyTemplate(orgId);
      const accounts = store.getAccountMap(orgId);
      const agents = store.listAgents(orgId).filter((a) => a.status !== "archived");
      const active = agents.filter((a) => a.status === "active");
      const frozen = agents.filter((a) => a.status === "frozen");
      const low = active.filter((a) => {
        const bal = accounts.get(accountId("agent", a.id))?.balanceMicro ?? 0n;
        return bal < 5_000_000n;
      });
      const denied = store.listDecisions(orgId, 80).filter((d) => d.outcome === "deny");
      const bullets: string[] = [];
      if (pending.length) {
        const first = pending[0]!;
        bullets.push(
          `Approve or deny ${pending.length} parked payment${pending.length === 1 ? "" : "s"} (e.g. $${first.amountUsdc} → ${first.destination}).`,
        );
      }
      if (frozen.length) {
        bullets.push(
          `Thaw or archive frozen agent${frozen.length === 1 ? "" : "s"}: ${frozen.map((a) => a.name).join(", ")}.`,
        );
      }
      if (low.length) {
        bullets.push(
          `Top up low stipends: ${low.map((a) => a.name).join(", ")} (under $5) from a budget or Fund.`,
        );
      }
      if (denied.length >= 3) {
        const last = denied[0]!;
        bullets.push(
          `${denied.length} recent denials (latest $${last.amountUsdc} → ${last.destination}) — check Policy bands or ask “why was that denied?”.`,
        );
      }
      if (t.quietHours && t.quietHours.startHour !== t.quietHours.endHour) {
        const st = quietHoursStatus(t.quietHours);
        if (st.inQuiet) {
          bullets.push(
            `Quiet hours active — ends in ${st.countdown}; expect ${t.quietHours.action} on hits.`,
          );
        }
      }
      try {
        if (!store.reconcileOrg(orgId).ok) {
          bullets.push("Reconcile ledger drift before trusting vault totals.");
        }
      } catch {
        /* ignore */
      }
      try {
        const { concentrationPct } = vendorLedger(orgId);
        if (concentrationPct >= 60) {
          bullets.push(
            `Vendor concentration is ${concentrationPct}% — review Top vendors if that feels tight.`,
          );
        }
      } catch {
        /* ignore */
      }
      if (!bullets.length) {
        bullets.push("Inbox clear — optional: review Policy bands or run Simulate on a draft change.");
      }
      return {
        tool: name,
        title: "What to do next",
        text: bullets.map((b) => `• ${b}`).join("\n"),
        goto: pending.length ? "approvals" : frozen.length ? "agents" : "overview",
        data: { topic: "recommend", bullets },
      };
    }
    case "remember_fact": {
      const fact = String(args.fact ?? args.message ?? "").trim();
      if (!fact || fact.length < 3) {
        return {
          tool: name,
          title: "Memory",
          text: 'Tell me what to remember, e.g. “Remember that Researcher only pays pricing APIs.”',
          goto: "chat",
        };
      }
      const cleaned = fact
        .replace(/^(remember( that)?|note that|save that|don't forget)\s*/i, "")
        .trim();
      const row = store.addAbiMemory(orgId, cleaned || fact, "guardian");
      return {
        tool: name,
        title: "Remembered",
        text: `Saved: “${row.fact}” — I'll use this on later questions about this org.`,
        goto: "chat",
        data: { topic: "memory", fact: row.fact },
      };
    }
    case "recall_facts": {
      const q = String(args.query ?? "").trim();
      const rows = q ? store.searchAbiMemories(orgId, q, 12) : store.listAbiMemories(orgId, 12);
      if (!rows.length) {
        return {
          tool: name,
          title: "Memory",
          text: "No saved notes yet — say “Remember that …” to teach me an org fact.",
          goto: "chat",
          data: { topic: "memory" },
        };
      }
      return {
        tool: name,
        title: "What I remember",
        text: rows.map((r) => `• ${r.fact}`).join("\n"),
        goto: "chat",
        data: { topic: "memory", facts: rows.map((r) => r.fact) },
      };
    }
    case "draft_marketing_blurb": {
      const s = buildSummary(orgId);
      const agents = store.listAgents(orgId).filter((a) => a.status === "active").length;
      const depts = store.listDepartments(orgId).filter((d) => d.status === "active");
      const budgetNames = depts.map((d) => d.name).slice(0, 3);
      const blurb = [
        "Draft (not published — review before posting):",
        "",
        `"Artificial Banking keeps AI agents on a leash and a ledger.`,
        `We're running ${agents} active agent${agents === 1 ? "" : "s"}${
          budgetNames.length ? ` across ${budgetNames.join(", ")} budgets` : ""
        }, with policy gates on every payment.`,
        `${s.headline}`,
        `Not a bank. Not FDIC insured. Software for policy-gated agent money."`,
      ].join("\n");
      return {
        tool: name,
        title: "Marketing draft",
        text: blurb,
        goto: "chat",
      };
    }
    case "propose_external_action": {
      const inferred =
        args.platform || args.action || args.content
          ? {
              platform: args.platform,
              action: args.action,
              content: args.content,
            }
          : inferExternalArgs(String(args.message ?? "external action"));
      const proposal = createExternalProposal(orgId, inferred);
      return {
        tool: name,
        title: "External action (needs your OK)",
        text: [
          `Queued ${proposal.action} on ${proposal.platform} — nothing has been posted or signed up.`,
          `Approve below to queue for browser execution (stub — no live browse yet).`,
          "",
          `Draft:`,
          proposal.content,
        ].join("\n"),
        goto: "chat",
        externalAction: proposal,
      };
    }
    default: {
      const _exhaustive: never = name;
      return { tool: _exhaustive, title: "Unknown", text: "" };
    }
  }
}

/** Keyword → tools. Word-ish matching to avoid substring traps (e.g. research⊂Researcher). */
export function pickTools(qRaw: string): ToolName[] {
  const q = qRaw.toLowerCase();
  const tools = new Set<ToolName>();
  /** Match whole words; allow a trailing `s` for simple plurals (agent/agents). */
  const has = (...phrases: string[]) =>
    phrases.some((p) => {
      if (p.includes(" ")) return q.includes(p);
      const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${esc}s?\\b`).test(q);
    });

  if (has("summary", "overview", "status", "how are we", "health", "snapshot")) {
    tools.add("org_summary");
  }
  if (has("agent", "roster", "stipend") || (has("who") && has("balance"))) {
    tools.add("list_agents");
  }
  if (
    has("about", "detail", "profile", "how's", "how is", "tell me about", "check on", "inspect") &&
    has("agent", "researcher", "writer")
  ) {
    tools.add("agent_detail");
  }
  if (has("approval", "pending", "waiting", "hitl", "inbox")) {
    tools.add("pending_approvals");
  }
  // Avoid pulling spend on "who can approve payments?" / governance questions
  if (
    has("spend", "spent", "cost") ||
    (has("payment", "payments") && !has("approve", "approval", "guardian", "governance", "who can"))
  ) {
    if (!has("vendor", "who paid", "where")) tools.add("recent_spend");
  }
  if (has("budget", "envelope", "department") && !has("draft", "post", "tweet", "blurb")) {
    tools.add("list_budgets");
  }
  if (has("deny", "denied", "denial", "denials", "blocked", "refuse", "reject")) {
    tools.add("list_denials");
  }
  if (has("vendor", "counterparty", "who did we pay", "where did money", "paid to")) {
    tools.add("top_vendors");
  }
  if (has("invoice", "revenue", "owed", "receivable")) tools.add("invoice_status");
  if (has("escrow", "hired", "peer")) tools.add("escrow_status");
  if (has("reconcile", "books", "drift", "safe", "clean", "ledger")) {
    tools.add("books_health");
  }
  if (has("burn", "runway")) tools.add("burn_forecast");
  if (
    has("policy", "band", "bands", "threshold", "ask me", "per payment", "per tx", "hitl above", "daily max")
  ) {
    tools.add("get_policy");
  }
  if (has("quiet", "after hours", "off hours", "night window")) {
    tools.add("quiet_hours_status");
  }
  if (
    has("why was", "why did", "look up", "lookup", "that payment", "this payment", "decision trail") ||
    (has("denied") && has("to", "for", "at"))
  ) {
    tools.add("lookup_decision");
    tools.add("explain_decision");
  }
  if (has("explain") && has("deny", "denied", "blocked", "decision", "refusal", "payment")) {
    tools.add("explain_decision");
  }
  if (has("guardian", "governance", "who can approve", "quorum", "approver seat")) {
    tools.add("governance_status");
  }
  if (has("treasury", "vault", "holding", "btc", "eth") || (has("deposit") && has("org"))) {
    tools.add("treasury_snapshot");
  }
  if (has("compare", "versus", "vs ")) tools.add("compare_agents");
  if (has("what should", "recommend", "next step", "priorit", "what now", "attention")) {
    tools.add("recommend_next");
  }
  if (has("remember that", "note that", "save that", "don't forget") || /^remember\b/.test(q)) {
    tools.add("remember_fact");
  }
  if (has("what do you remember", "recall", "your notes", "what did i tell")) {
    tools.add("recall_facts");
  }
  if (has("draft", "blurb", "marketing", "tweet", "pitch", "write copy")) {
    tools.add("draft_marketing_blurb");
  }
  if (
    has("maltbook", "linkedin") ||
    (has("post") && has("web", "online", "twitter", " x ")) ||
    has("sign up on", "signup on", "register on")
  ) {
    tools.add("propose_external_action");
  }
  if (has("anomaly", "unusual", "weird")) {
    tools.add("burn_forecast");
    tools.add("list_denials");
  }

  if (
    !tools.size &&
    (has("hi", "hello", "hey", "help", "what can", "abi", "survey", "look around") ||
      q.trim().length < 20)
  ) {
    tools.add("org_summary");
    tools.add("pending_approvals");
  }

  return [...tools];
}

/** Optional anomaly line for richer summaries. */
export function anomalyNote(orgId: string): string | null {
  try {
    const { anomalies: rows, scanned } = anomalies(orgId);
    if (!rows.length) return null;
    return `${rows.length} anomaly signal${rows.length === 1 ? "" : "s"} across ${scanned} recent events — open Insights for detail.`;
  } catch {
    return null;
  }
}
