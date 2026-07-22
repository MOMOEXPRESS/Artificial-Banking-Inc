/**
 * Short-term chat memory — uses durable chat_messages as the transcript.
 * Resolves follow-ups ("and spend?", "what about them?") from recent turns.
 */
import type { ToolName } from "./tools.js";

export type ChatTurn = {
  role: "user" | "assistant" | "system";
  body: string;
  meta?: Record<string, unknown>;
};

export function lastToolsUsed(recent: ChatTurn[]): ToolName[] {
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    if (m?.role !== "assistant") continue;
    const tools = m.meta?.toolsUsed;
    if (Array.isArray(tools) && tools.length) {
      return tools.filter((t): t is ToolName => typeof t === "string") as ToolName[];
    }
  }
  return [];
}

/** True when the message is a short follow-up that needs prior context. */
export function isFollowUp(message: string): boolean {
  const q = message.toLowerCase().trim();
  if (q.length > 80) return false;
  return (
    /^(and|also|what about|how about|those|them|their|it|same|again|more|ok|yes)\b/.test(q) ||
    /\b(them|those|that|it)\b/.test(q) ||
    /^(same|again)\??$/.test(q)
  );
}

/**
 * Expand a follow-up into a synthetic query that pickTools can route,
 * and/or return tools to reuse from the prior turn.
 */
export function resolveFollowUp(
  message: string,
  recent: ChatTurn[],
): { query: string; reuseTools: ToolName[] } {
  const priorTools = lastToolsUsed(recent);
  const q = message.toLowerCase().trim();

  if (!isFollowUp(message)) {
    return { query: message, reuseTools: [] };
  }

  // Pronoun / "and X" expansions
  if (/\b(spend|spent|cost|payments?)\b/.test(q)) {
    return { query: "recent spend", reuseTools: [] };
  }
  if (/\b(agent|roster|balance|stipend|them|those)\b/.test(q) && priorTools.includes("list_agents")) {
    return { query: "list agents balances", reuseTools: ["list_agents"] };
  }
  if (/\b(budget|finance|research|envelope)\b/.test(q)) {
    return { query: "list budgets", reuseTools: [] };
  }
  if (/\b(approval|pending|waiting|inbox)\b/.test(q)) {
    return { query: "pending approvals", reuseTools: [] };
  }
  if (/\b(deny|denied|blocked)\b/.test(q)) {
    return { query: "list denials", reuseTools: [] };
  }
  if (/\b(vendor|who|where)\b/.test(q)) {
    return { query: "top vendors", reuseTools: [] };
  }
  if (/\b(draft|blurb|marketing|copy)\b/.test(q)) {
    return { query: "draft marketing blurb", reuseTools: [] };
  }
  if (/\b(maltbook|linkedin|post online)\b/.test(q)) {
    return { query: "propose maltbook post", reuseTools: [] };
  }

  // Bare "and …?" / "what about them?" → reuse prior tools
  if (priorTools.length) {
    return { query: message, reuseTools: priorTools };
  }

  // Fall back to last user question concatenated
  const lastUser = [...recent].reverse().find((t) => t.role === "user");
  if (lastUser) {
    return { query: `${lastUser.body} ${message}`, reuseTools: [] };
  }
  return { query: message, reuseTools: [] };
}

export function transcriptSnippet(recent: ChatTurn[], max = 6): string {
  return recent
    .filter((t) => t.role === "user" || t.role === "assistant")
    .slice(-max)
    .map((t) => `${t.role === "user" ? "Guardian" : "ABI"}: ${t.body.slice(0, 200)}`)
    .join("\n");
}
