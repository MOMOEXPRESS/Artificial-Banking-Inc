"use client";

import { useCallback, useEffect, useState } from "react";
import { Empty, Icon } from "./ui";

type AgentRow = {
  id: string;
  orgId: string;
  name: string;
  status: "active" | "frozen" | "archived";
  profile?: Record<string, unknown>;
  apiKeyLive?: boolean;
  availableUsdc?: string;
  heldUsdc?: string;
  spent24hUsdc?: string;
  groupName?: string;
};

type GroupRow = {
  id: string;
  name: string;
  status: string;
  memberCount: number;
  members: { id: string; name: string; status: string }[];
};

type FreezeRow = {
  id: number;
  agentId?: string;
  agentName?: string;
  reason: string;
  at: string;
  scope: string;
};

type SessionRow = {
  id: string;
  agentId: string;
  label?: string;
  scopes: string[];
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
};

function fmt(u?: string) {
  if (!u) return "$0";
  const n = Number(u);
  if (Number.isNaN(n)) return `$${u}`;
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function statusTone(s: string) {
  if (s === "active") return "ok";
  if (s === "frozen") return "warn";
  return "bad";
}

export function AgentsView({
  gFetch,
  busy,
  act,
  onKeyRevealed,
  readOnly = false,
}: {
  gFetch: (path: string, init?: RequestInit) => Promise<Response>;
  busy: boolean;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  onKeyRevealed?: (entry: { agentId: string; name: string; key: string }) => void;
  readOnly?: boolean;
}) {
  const locked = busy || readOnly;
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [freezes, setFreezes] = useState<FreezeRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(null);
  const [tab, setTab] = useState<"roster" | "groups" | "sessions" | "freezes">("roster");

  const [newName, setNewName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [rename, setRename] = useState("");
  const [tags, setTags] = useState("");
  const [runtime, setRuntime] = useState("");
  const [ownerId, setOwnerId] = useState("owner");
  const [assignGroup, setAssignGroup] = useState("");
  const [sessionLabel, setSessionLabel] = useState("");
  const [revealedSession, setRevealedSession] = useState<string | null>(null);

  const [rosterReady, setRosterReady] = useState(false);
  const [fundAmounts, setFundAmounts] = useState<Record<string, string>>({});

  const refreshRoster = useCallback(async () => {
    const [a, g] = await Promise.all([
      gFetch("/v1/guardian/agents").then((x) => x.json()),
      gFetch("/v1/guardian/agent-groups").then((x) => x.json()),
    ]);
    setAgents(a.agents ?? []);
    setGroups(g.groups ?? []);
    setRosterReady(true);
  }, [gFetch]);

  const refreshFreezes = useCallback(async () => {
    const f = await gFetch("/v1/guardian/freezes").then((x) => x.json());
    setFreezes(f.freezes ?? []);
  }, [gFetch]);

  const refreshSessions = useCallback(async () => {
    const s = await gFetch("/v1/guardian/session-keys").then((x) => x.json());
    setSessions(s.sessionKeys ?? []);
  }, [gFetch]);

  const refresh = useCallback(async () => {
    await refreshRoster();
    if (tab === "freezes") await refreshFreezes();
    if (tab === "sessions") await refreshSessions();
  }, [refreshRoster, refreshFreezes, refreshSessions, tab]);

  useEffect(() => {
    void refreshRoster();
  }, [refreshRoster]);

  useEffect(() => {
    if (tab === "freezes") void refreshFreezes();
    if (tab === "sessions") void refreshSessions();
  }, [tab, refreshFreezes, refreshSessions]);

  const loadDetail = useCallback(
    async (id: string) => {
      setSelected(id);
      const [d, an] = await Promise.all([
        gFetch(`/v1/guardian/agents/${id}`).then((x) => x.json()),
        gFetch(`/v1/guardian/agents/${id}/analytics`).then((x) => x.json()),
      ]);
      setDetail(d);
      setAnalytics(an);
      const ident = d.identity as AgentRow | undefined;
      setRename(ident?.name ?? "");
      const profile = (ident?.profile ?? {}) as Record<string, unknown>;
      setTags(Array.isArray(profile.tags) ? (profile.tags as string[]).join(", ") : "");
      setRuntime(typeof profile.runtime === "string" ? profile.runtime : "");
      setOwnerId(
        typeof profile.ownerGuardianId === "string" ? profile.ownerGuardianId : "owner",
      );
      setAssignGroup(typeof profile.groupId === "string" ? profile.groupId : "");
    },
    [gFetch],
  );

  const createAgent = () =>
    act("Create agent", async () => {
      const res = await gFetch("/v1/guardian/agents", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d.error));
      onKeyRevealed?.({ agentId: d.agentId, name: newName.trim(), key: d.apiKey });
      setNewName("");
      await refresh();
      return "Agent created — API key shown once.";
    });

  const createGroup = () =>
    act("Create group", async () => {
      const res = await gFetch("/v1/guardian/agent-groups", {
        method: "POST",
        body: JSON.stringify({ name: groupName.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d.error));
      setGroupName("");
      await refresh();
      return `Group ${d.group.name} ready.`;
    });

  const selectedAgent = agents.find((a) => a.id === selected);

  return (
    <>
      <div className="card-head" style={{ marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Agents</h2>
          <div className="sub">Identity, groups, keys, sessions, freeze audit</div>
        </div>
        <div className="seg">
          {(
            [
              ["roster", "Roster"],
              ["groups", "Groups"],
              ["sessions", "Sessions"],
              ["freezes", "Freezes"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "roster" && (
        <div className="grid g-main fill">
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Roster</h2>
                <div className="sub">{agents.length} agents</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <input
                  placeholder="New agent name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && newName.trim() && void createAgent()}
                />
                <button
                  className="sm"
                  disabled={locked || !newName.trim()}
                  onClick={() => void createAgent()}
                >
                  Create
                </button>
              </div>
            </div>
            {agents.length === 0 ? (
              <Empty icon="robot">No agents yet — create one to start allocating stipends.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Group</th>
                    <th>Available</th>
                    <th>24h</th>
                    <th>Key</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <tr key={a.id} className={selected === a.id ? "on" : undefined}>
                      <td>
                        <button
                          className="ghost sm"
                          style={{ padding: 0, fontWeight: 600 }}
                          onClick={() => void loadDetail(a.id)}
                        >
                          {a.name}
                        </button>
                      </td>
                      <td>
                        <span className={`pill ${statusTone(a.status)}`}>
                          <i /> {a.status}
                        </span>
                      </td>
                      <td className="faint">{a.groupName ?? "—"}</td>
                      <td className="mono">{fmt(a.availableUsdc)}</td>
                      <td className="mono faint">{fmt(a.spent24hUsdc)}</td>
                      <td className="faint">{a.apiKeyLive ? "live" : "revoked"}</td>
                      <td>
                        <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                          {a.status === "active" && (
                            <button
                              className="sm ghost"
                              disabled={locked}
                              onClick={() =>
                                void act("Freeze", async () => {
                                  await gFetch(`/v1/guardian/agents/${a.id}/freeze`, {
                                    method: "POST",
                                    body: JSON.stringify({ reason: "guardian kill switch" }),
                                  });
                                  await refresh();
                                  return `${a.name} frozen.`;
                                })
                              }
                            >
                              Freeze
                            </button>
                          )}
                          {a.status === "frozen" && (
                            <button
                              className="sm ghost"
                              disabled={locked}
                              onClick={() =>
                                void act("Unfreeze", async () => {
                                  await gFetch(`/v1/guardian/agents/${a.id}/unfreeze`, {
                                    method: "POST",
                                    body: JSON.stringify({}),
                                  });
                                  await refresh();
                                  return `${a.name} unfrozen.`;
                                })
                              }
                            >
                              Unfreeze
                            </button>
                          )}
                          {a.status !== "archived" && (
                            <button
                              className="sm ghost"
                              disabled={locked}
                              onClick={() =>
                                void act("Rotate key", async () => {
                                  const res = await gFetch(
                                    `/v1/guardian/agents/${a.id}/rotate-key`,
                                    { method: "POST" },
                                  );
                                  const d = await res.json();
                                  if (!res.ok) throw new Error(JSON.stringify(d.error));
                                  onKeyRevealed?.({
                                    agentId: a.id,
                                    name: `${a.name} (rotated)`,
                                    key: d.apiKey,
                                  });
                                  await refresh();
                                  return "Key rotated.";
                                })
                              }
                            >
                              Rotate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            {!selected || !detail ? (
              <Empty icon="robot">Select an agent for profile, ownership, and analytics.</Empty>
            ) : (
              <>
                <div className="card-head">
                  <div>
                    <h2>{(detail.identity as AgentRow)?.name}</h2>
                    <div className="sub mono faint">{selected}</div>
                  </div>
                  <span className={`pill ${statusTone((detail.identity as AgentRow)?.status ?? "")}`}>
                    <i /> {(detail.identity as AgentRow)?.status}
                  </span>
                </div>

                <div className="grid g-2" style={{ marginBottom: 18, gap: 14 }}>
                  <div
                    style={{
                      padding: "12px 14px",
                      borderRadius: 10,
                      background: "var(--surface-3)",
                    }}
                  >
                    <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>
                      Available
                    </div>
                    <div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>
                      {fmt(detail.availableUsdc as string)}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "12px 14px",
                      borderRadius: 10,
                      background: "var(--surface-3)",
                    }}
                  >
                    <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>
                      Held
                    </div>
                    <div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>
                      {fmt(detail.heldUsdc as string)}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "12px 14px",
                      borderRadius: 10,
                      background: "var(--surface-3)",
                    }}
                  >
                    <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>
                      24h spend
                    </div>
                    <div className="mono" style={{ fontSize: 16 }}>
                      {fmt(detail.spent24hUsdc as string)}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "12px 14px",
                      borderRadius: 10,
                      background: "var(--surface-3)",
                    }}
                  >
                    <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>
                      Lifetime settled
                    </div>
                    <div className="mono" style={{ fontSize: 16 }}>
                      {fmt((analytics?.lifetimeSettledUsdc as string) ?? "0")}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    marginBottom: 18,
                    padding: "4px 0 8px",
                  }}
                >
                  <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                    Display name
                    <input value={rename} disabled={readOnly} onChange={(e) => setRename(e.target.value)} />
                  </label>
                  <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                    Runtime
                    <input
                      placeholder="langgraph / eliza / custom"
                      value={runtime}
                      disabled={readOnly}
                      onChange={(e) => setRuntime(e.target.value)}
                    />
                  </label>
                  <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                    Tags (comma-separated)
                    <input value={tags} disabled={readOnly} onChange={(e) => setTags(e.target.value)} />
                  </label>
                  <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                    Owner guardian id
                    <input value={ownerId} disabled={readOnly} onChange={(e) => setOwnerId(e.target.value)} />
                  </label>
                  <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                    Group
                    <select value={assignGroup} disabled={readOnly} onChange={(e) => setAssignGroup(e.target.value)}>
                      <option value="">— none —</option>
                      {groups
                        .filter((g) => g.status === "active")
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    disabled={locked}
                    onClick={() =>
                      void act("Save profile", async () => {
                        const profile: Record<string, unknown> = {
                          runtime: runtime.trim() || undefined,
                          tags: tags
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean),
                          ownerGuardianId: ownerId.trim() || "owner",
                          groupId: assignGroup || "",
                        };
                        const res = await gFetch(`/v1/guardian/agents/${selected}`, {
                          method: "PATCH",
                          body: JSON.stringify({
                            name: rename.trim() || undefined,
                            profile,
                          }),
                        });
                        const d = await res.json();
                        if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d.error));
                        await refresh();
                        await loadDetail(selected);
                        return "Profile saved.";
                      })
                    }
                  >
                    Save identity
                  </button>
                </div>

                <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                  <button
                    className="sm ghost"
                    disabled={locked || selectedAgent?.status === "archived"}
                    onClick={() =>
                      void act("Revoke keys", async () => {
                        const res = await gFetch(`/v1/guardian/agents/${selected}/revoke-key`, {
                          method: "POST",
                        });
                        const d = await res.json();
                        if (!res.ok) throw new Error(JSON.stringify(d.error));
                        await refresh();
                        await loadDetail(selected!);
                        return `Revoked API key + ${d.sessionsRevoked} session(s).`;
                      })
                    }
                  >
                    Revoke all keys
                  </button>
                  {selectedAgent?.status !== "archived" ? (
                    <button
                      className="sm ghost"
                      disabled={locked}
                      onClick={() =>
                        void act("Archive", async () => {
                          await gFetch(`/v1/guardian/agents/${selected}/archive`, {
                            method: "POST",
                          });
                          await refresh();
                          await loadDetail(selected!);
                          return "Agent archived — non-spendable, keys dead.";
                        })
                      }
                    >
                      Archive
                    </button>
                  ) : (
                    <button
                      className="sm"
                      disabled={locked}
                      onClick={() =>
                        void act("Unarchive", async () => {
                          const res = await gFetch(`/v1/guardian/agents/${selected}/unarchive`, {
                            method: "POST",
                          });
                          const d = await res.json();
                          if (!res.ok) throw new Error(JSON.stringify(d.error));
                          onKeyRevealed?.({
                            agentId: selected!,
                            name: `${rename} (restored)`,
                            key: d.apiKey,
                          });
                          await refresh();
                          await loadDetail(selected!);
                          return "Agent restored with a fresh API key.";
                        })
                      }
                    >
                      Unarchive
                    </button>
                  )}
                  <button
                    className="sm"
                    disabled={locked || selectedAgent?.status !== "active"}
                    onClick={() =>
                      void act("Mint session", async () => {
                        const res = await gFetch(
                          `/v1/guardian/agents/${selected}/session-keys`,
                          {
                            method: "POST",
                            body: JSON.stringify({
                              label: sessionLabel.trim() || "console",
                              ttlHours: 24,
                            }),
                          },
                        );
                        const d = await res.json();
                        if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d.error));
                        setRevealedSession(d.sessionKey.token);
                        setSessionLabel("");
                        await refresh();
                        return "Session token minted — copy below.";
                      })
                    }
                  >
                    Mint 24h session
                  </button>
                </div>

                {revealedSession && (
                  <div className="card" style={{ marginBottom: 12, background: "var(--surface-2, #f6f4ef)" }}>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                      Session token (once)
                    </div>
                    <code className="mono" style={{ wordBreak: "break-all", fontSize: 12 }}>
                      {revealedSession}
                    </code>
                  </div>
                )}

                {analytics && (
                  <div className="sub" style={{ marginBottom: 8 }}>
                    Decisions allow {(analytics.decisions as { allow: number })?.allow ?? 0} · deny{" "}
                    {(analytics.decisions as { deny: number })?.deny ?? 0} · review{" "}
                    {(analytics.decisions as { review: number })?.review ?? 0}
                  </div>
                )}

                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                  Recent decisions
                </div>
                <div style={{ maxHeight: 180, overflow: "auto" }}>
                  {((detail.recentDecisions as { outcome: string; tool: string; amountUsdc: string; at: string }[]) ?? [])
                    .slice(0, 8)
                    .map((d, i) => (
                      <div key={i} className="between" style={{ fontSize: 12, padding: "4px 0" }}>
                        <span>
                          <span className={`pill ${d.outcome === "allow" ? "ok" : d.outcome === "deny" ? "bad" : "warn"}`}>
                            <i /> {d.outcome}
                          </span>{" "}
                          {d.tool}
                        </span>
                        <span className="mono faint">{fmt(d.amountUsdc)}</span>
                      </div>
                    ))}
                  {!((detail.recentDecisions as unknown[]) ?? []).length && (
                    <div className="faint" style={{ fontSize: 12 }}>No decisions yet.</div>
                  )}
                </div>

                <div className="muted" style={{ fontSize: 12, margin: "14px 0 6px" }}>
                  Recent runs
                </div>
                <div style={{ maxHeight: 140, overflow: "auto" }}>
                  {((detail.recentRuns as { id: string; status: string; startedAt: string; title?: string }[]) ?? [])
                    .slice(0, 8)
                    .map((r) => (
                      <div key={r.id} className="between" style={{ fontSize: 12, padding: "4px 0" }}>
                        <span>
                          <span className={`pill ${r.status === "completed" ? "ok" : r.status === "failed" ? "bad" : "warn"}`}>
                            <i /> {r.status}
                          </span>{" "}
                          {r.title ?? r.id.slice(0, 12)}
                        </span>
                        <span className="faint mono">
                          {r.startedAt ? new Date(r.startedAt).toLocaleString() : ""}
                        </span>
                      </div>
                    ))}
                  {!((detail.recentRuns as unknown[]) ?? []).length && (
                    <div className="faint" style={{ fontSize: 12 }}>No runs yet — try Playground missions.</div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "groups" && (
        <div className="card">
          {!rosterReady && (
            <div className="faint" style={{ fontSize: 12, marginBottom: 8 }}>Loading roster…</div>
          )}
          <div className="card-head">
            <div>
              <h2>Agent groups</h2>
              <div className="sub">
                Desks / swarms with real controls — freeze the whole desk, fund members equally,
                or assign agents in bulk. Membership is stored on each agent&apos;s profile.
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input
                placeholder="e.g. Research Desk"
                value={groupName}
                disabled={readOnly}
                onChange={(e) => setGroupName(e.target.value)}
              />
              <button
                className="sm"
                disabled={locked || !groupName.trim()}
                onClick={() => void createGroup()}
              >
                Create group
              </button>
            </div>
          </div>
          <div
            className="banner info"
            style={{ marginBottom: 14 }}
          >
            <span className="txt">
              <b>Why groups exist</b>
              <span>
                A group is an operating unit: one kill-switch for every member, one stipend split
                when you fund the desk, and a label for Insights / activity. Without actions it
                would only be a tag — use Freeze desk / Fund members below.
              </span>
            </span>
          </div>
          {groups.length === 0 ? (
            <Empty icon="robot">
              No groups yet — create <b>Research Desk</b> or <b>Writer Swarm</b>, then assign
              agents from a profile or with Assign here.
            </Empty>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {groups.map((g) => {
                const ungrouped = agents.filter(
                  (a) => a.status !== "archived" && a.groupName !== g.name,
                );
                return (
                  <div
                    key={g.id}
                    style={{
                      padding: "14px 16px",
                      borderRadius: 10,
                      border: "1px solid var(--border)",
                      background: "var(--surface-2)",
                    }}
                  >
                    <div className="between" style={{ marginBottom: 10, gap: 10 }}>
                      <div>
                        <b style={{ fontSize: 14 }}>{g.name}</b>{" "}
                        <span className={`pill ${statusTone(g.status)}`}>
                          <i /> {g.status}
                        </span>
                        <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
                          {g.members.length
                            ? g.members.map((m) => m.name).join(", ")
                            : "No members yet"}
                        </div>
                      </div>
                      {g.status === "active" && (
                        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                          <button
                            className="sm danger"
                            disabled={locked || !g.members.length}
                            onClick={() =>
                              void act("Freeze desk", async () => {
                                const res = await gFetch(
                                  `/v1/guardian/agent-groups/${g.id}/freeze`,
                                  {
                                    method: "POST",
                                    body: JSON.stringify({ reason: "desk_kill_switch" }),
                                  },
                                );
                                const d = await res.json();
                                if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
                                await refresh();
                                return `Froze ${d.frozen?.length ?? 0} agent(s) in ${g.name}.`;
                              })
                            }
                          >
                            Freeze desk
                          </button>
                          <button
                            className="sm ghost"
                            disabled={locked || !g.members.length}
                            onClick={() =>
                              void act("Unfreeze desk", async () => {
                                const res = await gFetch(
                                  `/v1/guardian/agent-groups/${g.id}/unfreeze`,
                                  { method: "POST", body: "{}" },
                                );
                                const d = await res.json();
                                if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
                                await refresh();
                                return `Unfroze ${d.unfrozen?.length ?? 0} agent(s).`;
                              })
                            }
                          >
                            Unfreeze
                          </button>
                          <button
                            className="sm"
                            disabled={
                              locked ||
                              !g.members.length ||
                              !Number(fundAmounts[g.id] ?? "10")
                            }
                            onClick={() =>
                              void act("Fund desk", async () => {
                                const each = (fundAmounts[g.id] ?? "10").trim();
                                if (!each) return;
                                const res = await gFetch(
                                  `/v1/guardian/agent-groups/${g.id}/fund`,
                                  {
                                    method: "POST",
                                    body: JSON.stringify({ amountUsdcEach: each }),
                                  },
                                );
                                const d = await res.json();
                                if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
                                await refresh();
                                return `Funded ${d.funded?.length ?? 0} agents · $${d.amountUsdcEach} each ($${d.totalUsdc} total).`;
                              })
                            }
                          >
                            Fund members
                          </button>
                          <input
                            className="sm"
                            style={{ width: 72 }}
                            disabled={locked || !g.members.length}
                            value={fundAmounts[g.id] ?? "10"}
                            onChange={(e) =>
                              setFundAmounts((m) => ({ ...m, [g.id]: e.target.value }))
                            }
                            placeholder="USDC"
                            title="USDC per member"
                          />
                          <button
                            className="sm ghost"
                            disabled={locked}
                            onClick={() =>
                              void act("Archive group", async () => {
                                await gFetch(`/v1/guardian/agent-groups/${g.id}/archive`, {
                                  method: "POST",
                                });
                                await refresh();
                                return `${g.name} archived.`;
                              })
                            }
                          >
                            Archive
                          </button>
                        </div>
                      )}
                    </div>
                    {g.status === "active" && ungrouped.length > 0 && (
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <select
                          id={`assign-${g.id}`}
                          defaultValue=""
                          disabled={readOnly}
                          style={{ minWidth: 160 }}
                        >
                          <option value="">Assign agent…</option>
                          {ungrouped.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                        <button
                          className="sm ghost"
                          disabled={locked}
                          onClick={() =>
                            void act("Assign to group", async () => {
                              const el = document.getElementById(
                                `assign-${g.id}`,
                              ) as HTMLSelectElement | null;
                              const agentId = el?.value;
                              if (!agentId) throw new Error("Pick an agent first");
                              const res = await gFetch(
                                `/v1/guardian/agent-groups/${g.id}/assign`,
                                {
                                  method: "POST",
                                  body: JSON.stringify({ agentIds: [agentId] }),
                                },
                              );
                              const d = await res.json();
                              if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
                              if (el) el.value = "";
                              await refresh();
                              return `Assigned to ${g.name}.`;
                            })
                          }
                        >
                          Assign
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "sessions" && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Session keys</h2>
              <div className="sub">
                Short-lived <code>pv_sess_…</code> tokens — revoked on freeze/archive
              </div>
            </div>
          </div>
          {sessions.length === 0 ? (
            <Empty icon="zap">No session keys. Open an agent detail and mint a 24h session.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Agent</th>
                  <th>Scopes</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const agent = agents.find((a) => a.id === s.agentId);
                  const dead = Boolean(s.revokedAt) || new Date(s.expiresAt).getTime() < Date.now();
                  return (
                    <tr key={s.id}>
                      <td>{s.label ?? "—"}</td>
                      <td>{agent?.name ?? s.agentId.slice(0, 10)}</td>
                      <td className="faint">{s.scopes.join(", ")}</td>
                      <td className="mono faint" style={{ fontSize: 11 }}>
                        {new Date(s.expiresAt).toLocaleString()}
                      </td>
                      <td>
                        <span className={`pill ${dead ? "bad" : "ok"}`}>
                          <i /> {s.revokedAt ? "revoked" : dead ? "expired" : "live"}
                        </span>
                      </td>
                      <td>
                        {!s.revokedAt && (
                          <button
                            className="sm ghost"
                            disabled={locked}
                            onClick={() =>
                              void act("Revoke session", async () => {
                                await gFetch(`/v1/guardian/session-keys/${s.id}/revoke`, {
                                  method: "POST",
                                });
                                await refresh();
                              })
                            }
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "freezes" && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Freeze & key audit</h2>
              <div className="sub">Kill-switch events, rotations, revokes, archives</div>
            </div>
            <Icon name="clock" />
          </div>
          {freezes.length === 0 ? (
            <Empty icon="clock">No freeze events yet.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Scope</th>
                  <th>Target</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {freezes.map((f) => (
                  <tr key={f.id}>
                    <td className="mono faint" style={{ fontSize: 11 }}>
                      {new Date(f.at).toLocaleString()}
                    </td>
                    <td>{f.scope}</td>
                    <td>{f.agentName ?? (f.scope === "org" ? "Organization" : "—")}</td>
                    <td>{f.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
