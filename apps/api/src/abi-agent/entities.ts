/**
 * Bind free-text mentions to org entities (agents, destinations, amounts).
 * Deterministic — only matches against live roster / recent decisions.
 */
import { store } from "../store.js";

export type BoundEntities = {
  agentIds: string[];
  agentNames: string[];
  destinations: string[];
  amountUsdc?: string;
};

/** Escape a string for use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find agents whose names appear in the message (word-boundary, case-insensitive).
 * Longer names win first to avoid partial collisions.
 */
export function bindAgents(orgId: string, message: string): { id: string; name: string }[] {
  const q = message.toLowerCase();
  const agents = store
    .listAgents(orgId)
    .filter((a) => a.status !== "archived")
    .slice()
    .sort((a, b) => b.name.length - a.name.length);
  const hit: { id: string; name: string }[] = [];
  const used = new Set<string>();
  for (const a of agents) {
    const name = a.name.trim();
    if (name.length < 2) continue;
    const re = new RegExp(`\\b${escapeRe(name.toLowerCase())}\\b`, "i");
    if (re.test(q) && !used.has(a.id)) {
      used.add(a.id);
      hit.push({ id: a.id, name: a.name });
    }
  }
  return hit;
}

/** Pull a $amount or bare number that looks like USDC. */
export function bindAmountUsdc(message: string): string | undefined {
  const m =
    message.match(/\$\s*(\d+(?:\.\d{1,6})?)/) ||
    message.match(/\b(\d+(?:\.\d{1,6})?)\s*usdc\b/i);
  return m?.[1];
}

/**
 * Bind destinations from recent decision trail when the message mentions them,
 * or take an explicit "to X" / "for X" fragment.
 */
export function bindDestinations(orgId: string, message: string): string[] {
  const q = message.toLowerCase();
  const explicit =
    message.match(/(?:to|for|at|→|->)\s+([a-z0-9._:@/-]{2,80})/i)?.[1]?.toLowerCase() ?? "";
  const out: string[] = [];
  if (explicit && !/^(the|a|an|our|my|this|that|him|her|them|it)$/i.test(explicit)) {
    out.push(explicit);
  }
  try {
    const decisions = store.listDecisions(orgId, 120);
    const seen = new Set(out);
    for (const d of decisions) {
      const dest = d.destination.trim();
      if (dest.length < 2) continue;
      const lower = dest.toLowerCase();
      if (seen.has(lower)) continue;
      if (q.includes(lower) || (explicit && lower.includes(explicit))) {
        seen.add(lower);
        out.push(dest);
      }
    }
  } catch {
    /* ignore */
  }
  return out.slice(0, 5);
}

export function bindEntities(orgId: string, message: string): BoundEntities {
  const agents = bindAgents(orgId, message);
  return {
    agentIds: agents.map((a) => a.id),
    agentNames: agents.map((a) => a.name),
    destinations: bindDestinations(orgId, message),
    amountUsdc: bindAmountUsdc(message),
  };
}

/** True when the user is asking about a specific named agent. */
export function wantsAgentDetail(message: string, entities: BoundEntities): boolean {
  if (!entities.agentIds.length) return false;
  const q = message.toLowerCase();
  return (
    /\b(about|detail|profile|status of|how is|how's|hows|tell me about|look at|inspect|check on)\b/.test(
      q,
    ) ||
    /\b(stipend|balance|spend|spent|decisions?|history|freeze|frozen)\b/.test(q) ||
    // Bare name mention with a short question: "Researcher?" / "Researcher stipend"
    (q.trim().length < 60 && entities.agentNames.some((n) => q.includes(n.toLowerCase())))
  );
}
