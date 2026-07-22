/**
 * ABI Agent — first slice: org-survey tool loop behind chat.
 *
 * Not a free-text money mover. Tools are read-only surveys of the guardian
 * org (balances, approvals, spend, agents). LLM wiring comes later; for now
 * intent → tools → composed answer, falling back to keyword Q&A.
 */
import { accountId, formatMicroToUsdc } from "@policyvault/common";
import { answerQuestion, buildSummary } from "../insights.js";
import { store } from "../store.js";

export type AbiAgentResult = {
  answer: string;
  goto?: string;
  toolsUsed: string[];
};

type ToolName =
  | "org_summary"
  | "list_agents"
  | "pending_approvals"
  | "recent_spend"
  | "list_budgets";

function pickTools(qRaw: string): ToolName[] {
  const q = qRaw.toLowerCase();
  const tools = new Set<ToolName>();
  const has = (...words: string[]) => words.some((w) => q.includes(w));

  if (has("summary", "overview", "status", "how are we", "health")) tools.add("org_summary");
  if (has("agent", "roster", "who", "balance", "stipend")) tools.add("list_agents");
  if (has("approval", "pending", "waiting", "hitl", "inbox")) tools.add("pending_approvals");
  if (has("spend", "spent", "cost", "payment", "paid")) tools.add("recent_spend");
  if (has("budget", "envelope", "department", "finance", "research")) tools.add("list_budgets");

  // Default survey when the user greets or asks vaguely.
  if (
    !tools.size &&
    (has("hi", "hello", "hey", "help", "what can", "abi", "survey", "look around") ||
      q.length < 24)
  ) {
    tools.add("org_summary");
    tools.add("pending_approvals");
  }

  return [...tools];
}

function runTool(orgId: string, name: ToolName): string {
  switch (name) {
    case "org_summary": {
      const s = buildSummary(orgId);
      const highs = s.highlights
        .slice(0, 3)
        .map((h) => `${h.label}: ${h.value}`)
        .join(" · ");
      return `${s.headline} ${s.body}${highs ? ` Highlights — ${highs}.` : ""}`;
    }
    case "list_agents": {
      const agents = store.listAgents(orgId).filter((a) => a.status !== "archived");
      if (!agents.length) return "No agents on the roster yet.";
      const accounts = store.getAccountMap(orgId);
      return agents
        .map((a) => {
          const bal = accounts.get(accountId("agent", a.id))?.balanceMicro ?? 0n;
          return `${a.name} (${a.status}) · $${formatMicroToUsdc(bal)}`;
        })
        .join("; ");
    }
    case "pending_approvals": {
      const pending = store.listApprovals(orgId, "pending", 20);
      if (!pending.length) return "Inbox zero — nothing waiting for approval.";
      return pending
        .map((p) => `$${formatMicroToUsdc(p.amountMicro)} → ${p.destination}`)
        .join("; ");
    }
    case "recent_spend": {
      const decisions = store
        .listDecisions(orgId, 200)
        .filter((d) => d.outcome === "allow");
      const day = decisions.filter((d) => new Date(d.at).getTime() >= Date.now() - 864e5);
      const total = day.reduce((a, d) => a + Number(d.amountUsdc), 0);
      return `${day.length} settled payments in 24h · ~$${total.toFixed(2)} external.`;
    }
    case "list_budgets": {
      const depts = store.listDepartments(orgId).filter((d) => d.status === "active");
      if (!depts.length) return "No budgets yet — create one under Treasury.";
      const accounts = store.getAccountMap(orgId);
      return depts
        .map((d) => {
          const bal = accounts.get(accountId("department", d.id))?.balanceMicro ?? 0n;
          return `${d.name} · $${formatMicroToUsdc(bal)}`;
        })
        .join("; ");
    }
    default:
      return "";
  }
}

/**
 * Run the ABI agent against an org. Read-only tools only.
 * Falls back to legacy keyword Q&A when no tool matches.
 */
export function runAbiAgent(orgId: string, message: string): AbiAgentResult {
  const toolsUsed = pickTools(message);
  if (!toolsUsed.length) {
    const legacy = answerQuestion(orgId, message);
    return { answer: legacy.answer, goto: legacy.goto, toolsUsed: [] };
  }

  const facts = toolsUsed.map((t) => ({ tool: t, text: runTool(orgId, t) }));
  const body = facts.map((f) => f.text).filter(Boolean).join("\n\n");
  const goto =
    toolsUsed.includes("pending_approvals")
      ? "approvals"
      : toolsUsed.includes("list_budgets")
        ? "treasury"
        : toolsUsed.includes("list_agents")
          ? "agents"
          : toolsUsed.includes("recent_spend")
            ? "activity"
            : "overview";

  return {
    answer: `ABI surveyed the org (${toolsUsed.join(", ")}):\n\n${body}`,
    goto,
    toolsUsed,
  };
}
