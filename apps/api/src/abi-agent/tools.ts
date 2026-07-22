/**
 * Read-only org survey tools for the ABI agent.
 * Never moves money or approves payments — facts only.
 * External web actions are HITL proposals only (never auto-executed).
 */
import { accountId, formatMicroToUsdc } from "@policyvault/common";
import { anomalies, burnForecast, vendorLedger } from "../analytics.js";
import { buildSummary } from "../insights.js";
import { store } from "../store.js";
import {
  createExternalProposal,
  inferExternalArgs,
  type ExternalActionProposal,
} from "./external-actions.js";

export const TOOL_NAMES = [
  "org_summary",
  "list_agents",
  "pending_approvals",
  "recent_spend",
  "list_budgets",
  "list_denials",
  "top_vendors",
  "invoice_status",
  "escrow_status",
  "books_health",
  "burn_forecast",
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

/** Keyword → tools. Also used after follow-up resolution. */
export function pickTools(qRaw: string): ToolName[] {
  const q = qRaw.toLowerCase();
  const tools = new Set<ToolName>();
  const has = (...words: string[]) => words.some((w) => q.includes(w));

  if (has("summary", "overview", "status", "how are we", "health", "snapshot")) {
    tools.add("org_summary");
  }
  if (has("agent", "roster", "stipend") || (has("who") && has("balance"))) {
    tools.add("list_agents");
  }
  if (has("approval", "pending", "waiting", "hitl", "inbox")) {
    tools.add("pending_approvals");
  }
  if (has("spend", "spent", "cost", "payment") && !has("vendor", "who paid", "where")) {
    tools.add("recent_spend");
  }
  if (has("budget", "envelope", "finance", "research") && !has("draft", "post", "tweet", "blurb")) {
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
    // fold anomalies into books_health narrative via burn for now
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
