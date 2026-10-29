/**
 * Server-side check that a pasted agent credential belongs to the caller's org.
 *
 * The playground used to accept any key the API would authenticate — including
 * a key from a different ABI account — and then run that agent's payments next
 * to this guardian's approvals and balances. The org is always derived from
 * the authenticated guardian credential; the pasted key must resolve to an
 * agent in that same org, be live (not expired or revoked) and not archived.
 * Nothing about another org's agent is revealed on mismatch.
 */
import { store } from "../store.js";

export type AgentKeyCheck =
  | {
      ok: true;
      agentId: string;
      agentName: string;
      kind: "agent_key" | "session_key";
      scopes: string[];
      status: string;
    }
  | {
      ok: false;
      status: 400 | 401 | 403;
      code: "KEY_MALFORMED" | "KEY_INVALID" | "KEY_ORG_MISMATCH" | "AGENT_ARCHIVED";
      message: string;
    };

export function checkAgentKeyForOrg(orgId: string, rawKey: string): AgentKeyCheck {
  const key = rawKey.trim();
  if (!/^pv_(agent|sess)_[A-Za-z0-9_-]{8,}$/.test(key)) {
    return {
      ok: false,
      status: 400,
      code: "KEY_MALFORMED",
      message: "Paste an agent key (pv_agent_…) or a session key (pv_sess_…).",
    };
  }
  let resolved: {
    agentId: string;
    orgId: string;
    name: string;
    status: string;
    scopes: string[];
    kind: "agent_key" | "session_key";
  } | null = null;
  if (key.startsWith("pv_sess_")) {
    const s = store.getSessionByToken(key);
    if (s) {
      resolved = {
        agentId: s.agent.id,
        orgId: s.agent.orgId,
        name: s.agent.name,
        status: s.agent.status,
        scopes: s.scopes,
        kind: "session_key",
      };
    }
  } else {
    const a = store.getAgentByKey(key);
    if (a) {
      resolved = {
        agentId: a.id,
        orgId: a.orgId,
        name: a.name,
        status: a.status,
        scopes: ["read", "pay", "escrow"],
        kind: "agent_key",
      };
    }
  }
  if (!resolved) {
    return {
      ok: false,
      status: 401,
      code: "KEY_INVALID",
      message: "That key is unknown, expired or revoked.",
    };
  }
  if (resolved.orgId !== orgId) {
    return {
      ok: false,
      status: 403,
      code: "KEY_ORG_MISMATCH",
      message:
        "That key belongs to a different ABI organization. Use a key created in this organization.",
    };
  }
  if (resolved.status === "archived") {
    return {
      ok: false,
      status: 403,
      code: "AGENT_ARCHIVED",
      message: "That agent is archived and can no longer act.",
    };
  }
  return {
    ok: true,
    agentId: resolved.agentId,
    agentName: resolved.name,
    kind: resolved.kind,
    scopes: resolved.scopes,
    status: resolved.status,
  };
}
