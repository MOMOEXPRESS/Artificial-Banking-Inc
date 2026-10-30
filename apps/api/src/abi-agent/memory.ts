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
  /** Decision (intent) ids from the last list shown, newest first — for "the second one". */
  decisionIds?: string[];
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
    if (Array.isArray(d.agentIds))
      next.agentIds = d.agentIds.filter((x): x is string => typeof x === "string");
    if (Array.isArray(d.agentNames))
      next.agentNames = d.agentNames.filter((x): x is string => typeof x === "string");
    if (Array.isArray(d.destinations))
      next.destinations = d.destinations.filter((x): x is string => typeof x === "string");
    if (typeof d.inQuiet === "boolean") next.inQuiet = d.inQuiet;
    if (Array.isArray(d.decisionIds) && d.decisionIds.length)
      next.decisionIds = d.decisionIds
        .filter((x): x is string => typeof x === "string")
        .slice(0, 10);
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
  if (
    /\b(agent|roster|balance|stipend|them|those)\b/.test(q) &&
    (priorTools.includes("list_agents") || scratch.agentIds?.length)
  ) {
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
  if (
    /\b(why)\b/.test(q) &&
    (scratch.destinations?.length ||
      priorTools.includes("list_denials") ||
      priorTools.includes("explain_decision"))
  ) {
    const dest = scratch.destinations?.[0];
    return {
      query: dest ? `explain decision ${dest}` : "explain decision deny",
      reuseTools: [],
      scratch,
    };
  }
  if (
    /\b(them|those|that agent|this agent|him|her)\b/.test(q) &&
    (scratch.agentNames?.length ||
      priorTools.includes("list_agents") ||
      priorTools.includes("agent_detail"))
  ) {
    const name = scratch.agentNames?.[0];
    return {
      query: name ? `tell me about ${name}` : "agent detail",
      reuseTools: name ? [] : ["agent_detail"],
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

/**
 * One-line digest of the turns that fall outside the verbatim window, so a
 * long conversation keeps its thread without sending (or re-reading) every
 * message. Built from stored intents and agent names — no model involved.
 */
export function olderHistorySummary(recent: ChatTurn[], verbatim = 6): string {
  const older = recent
    .filter((t) => t.role === "user" || t.role === "assistant")
    .slice(0, -verbatim);
  if (!older.length) return "";
  const intents = new Set<string>();
  const agents = new Set<string>();
  for (const t of older) {
    if (t.role !== "assistant") continue;
    if (typeof t.meta?.intent === "string" && t.meta.intent !== "unknown")
      intents.add(t.meta.intent);
    const pad = t.meta?.scratchpad as Scratchpad | undefined;
    if (pad?.agentNames && pad.agentNames.length <= 2)
      for (const n of pad.agentNames) agents.add(n);
  }
  const asked = older.filter((t) => t.role === "user").length;
  const bits = [`${asked} earlier question(s)`];
  if (intents.size) bits.push(`topics: ${[...intents].join(", ")}`);
  if (agents.size) bits.push(`agents: ${[...agents].join(", ")}`);
  return `Earlier in this conversation — ${bits.join(" · ")}`;
}
