/**
 * Short-term chat memory — durable chat_messages + scratchpad for follow-ups.
 * Resolves pronouns / “and spend?” from recent turns and lastEntities.
 */
import type { ToolName } from "./tools.js";

export type ChatTurn = {
  role: "user" | "assistant" | "system";
  body: string;
  meta?: Record<string, unknown>;
};

/** Working memory carried on assistant meta between turns. */
export type Scratchpad = {
  lastTopic?: string;
  agentIds?: string[];
  agentNames?: string[];
  destinations?: string[];
  inQuiet?: boolean;
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

export function lastScratchpad(recent: ChatTurn[]): Scratchpad {
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    if (m?.role !== "assistant") continue;
    const pad = m.meta?.scratchpad;
    if (pad && typeof pad === "object") return pad as Scratchpad;
  }
  return {};
}

/** Build scratchpad from tool results for the next turn. */
export function buildScratchpad(
  results: { tool: string; data?: Record<string, unknown> }[],
  prior: Scratchpad = {},
): Scratchpad {
  const next: Scratchpad = { ...prior };
  for (const r of results) {
    const d = r.data;
    if (!d) continue;
    if (typeof d.topic === "string") next.lastTopic = d.topic;
    if (Array.isArray(d.agentIds)) next.agentIds = d.agentIds.filter((x): x is string => typeof x === "string");
    if (Array.isArray(d.agentNames))
      next.agentNames = d.agentNames.filter((x): x is string => typeof x === "string");
    if (Array.isArray(d.destinations))
      next.destinations = d.destinations.filter((x): x is string => typeof x === "string");
    if (typeof d.inQuiet === "boolean") next.inQuiet = d.inQuiet;
  }
  return next;
}

/** True when the message is a short follow-up that needs prior context. */
export function isFollowUp(message: string): boolean {
  const q = message.toLowerCase().trim();
  if (q.length > 80) return false;
  return (
    /^(and|also|what about|how about|those|them|their|it|same|again|more|ok|yes|why)\b/.test(q) ||
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
): { query: string; reuseTools: ToolName[]; scratch: Scratchpad } {
  const priorTools = lastToolsUsed(recent);
  const scratch = lastScratchpad(recent);
  const q = message.toLowerCase().trim();

  if (!isFollowUp(message)) {
    return { query: message, reuseTools: [], scratch };
  }

  if (/\b(spend|spent|cost|payments?)\b/.test(q)) {
    return { query: "recent spend", reuseTools: [], scratch };
  }
  if (/\b(agent|roster|balance|stipend|them|those)\b/.test(q) && (priorTools.includes("list_agents") || scratch.agentIds?.length)) {
    return { query: "list agents balances", reuseTools: ["list_agents"], scratch };
  }
  if (/\b(budget|finance|research|envelope)\b/.test(q)) {
    return { query: "list budgets", reuseTools: [], scratch };
  }
  if (/\b(approval|pending|waiting|inbox)\b/.test(q)) {
    return { query: "pending approvals", reuseTools: [], scratch };
  }
  if (/\b(deny|denied|blocked)\b/.test(q)) {
    return { query: "list denials", reuseTools: [], scratch };
  }
  if (/\b(vendor|who|where)\b/.test(q)) {
    return { query: "top vendors", reuseTools: [], scratch };
  }
  if (/\b(policy|band|threshold|hitl|ceiling)\b/.test(q)) {
    return { query: "show policy bands", reuseTools: [], scratch };
  }
  if (/\b(quiet)\b/.test(q)) {
    return { query: "quiet hours status", reuseTools: [], scratch };
  }
  if (/\b(why)\b/.test(q) && (scratch.destinations?.length || priorTools.includes("list_denials"))) {
    const dest = scratch.destinations?.[0];
    return {
      query: dest ? `lookup decision ${dest}` : "lookup decision deny",
      reuseTools: [],
      scratch,
    };
  }
  if (/\b(draft|blurb|marketing|copy)\b/.test(q)) {
    return { query: "draft marketing blurb", reuseTools: [], scratch };
  }
  if (/\b(maltbook|linkedin|post online)\b/.test(q)) {
    return { query: "propose maltbook post", reuseTools: [], scratch };
  }

  if (priorTools.length) {
    return { query: message, reuseTools: priorTools, scratch };
  }

  const lastUser = [...recent].reverse().find((t) => t.role === "user");
  if (lastUser) {
    return { query: `${lastUser.body} ${message}`, reuseTools: [], scratch };
  }
  return { query: message, reuseTools: [], scratch };
}

export function transcriptSnippet(recent: ChatTurn[], max = 6): string {
  return recent
    .filter((t) => t.role === "user" || t.role === "assistant")
    .slice(-max)
    .map((t) => `${t.role === "user" ? "Guardian" : "ABI"}: ${t.body.slice(0, 200)}`)
    .join("\n");
}

export function scratchpadSnippet(scratch: Scratchpad): string {
  const bits: string[] = [];
  if (scratch.lastTopic) bits.push(`topic=${scratch.lastTopic}`);
  if (scratch.agentNames?.length) bits.push(`agents=${scratch.agentNames.join(",")}`);
  if (scratch.destinations?.length) bits.push(`dest=${scratch.destinations.join(",")}`);
  if (typeof scratch.inQuiet === "boolean") bits.push(`inQuiet=${scratch.inQuiet}`);
  return bits.length ? `Scratchpad: ${bits.join(" · ")}` : "";
}
