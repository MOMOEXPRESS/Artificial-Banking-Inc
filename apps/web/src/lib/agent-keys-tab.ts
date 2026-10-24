/**
 * Agent keys for this browser tab only.
 *
 * Agent keys are deliberately never written to localStorage (an XSS there
 * would keep them forever). They used to live only in memory, so any reload
 * left the playground with no acting agent and a disabled Run button. Keep
 * them in sessionStorage instead: scoped to this tab and org, gone when the
 * tab closes, and cleared on sign-out (see SESSION_TAB_KEYS in sign-out.ts).
 */
import type { AgentKey } from "./console-types";

export const AGENT_KEYS_TAB_KEY = "abi_agent_keys";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const isAgentKey = (k: unknown): k is AgentKey =>
  !!k &&
  typeof (k as AgentKey).agentId === "string" &&
  typeof (k as AgentKey).name === "string" &&
  typeof (k as AgentKey).key === "string" &&
  (k as AgentKey).key.length > 0;

export function loadTabAgentKeys(tab: StorageLike | null | undefined, orgId?: string): AgentKey[] {
  if (!tab || !orgId) return [];
  try {
    const raw = tab.getItem(AGENT_KEYS_TAB_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { orgId?: string; keys?: unknown[] };
    if (parsed.orgId !== orgId || !Array.isArray(parsed.keys)) return [];
    return parsed.keys.filter(isAgentKey);
  } catch {
    return [];
  }
}

export function saveTabAgentKeys(
  tab: StorageLike | null | undefined,
  orgId: string | undefined,
  keys: AgentKey[],
): void {
  if (!tab) return;
  try {
    if (!orgId || keys.length === 0) {
      tab.removeItem(AGENT_KEYS_TAB_KEY);
      return;
    }
    tab.setItem(AGENT_KEYS_TAB_KEY, JSON.stringify({ orgId, keys: keys.filter(isAgentKey) }));
  } catch {
    /* storage full or blocked — keys stay in memory for this page */
  }
}

/** Merge stored tab keys under any already in memory (memory wins). */
export function mergeAgentKeys(memory: AgentKey[], stored: AgentKey[]): AgentKey[] {
  const seen = new Set(memory.map((k) => k.agentId));
  return [...memory, ...stored.filter((k) => !seen.has(k.agentId))];
}
