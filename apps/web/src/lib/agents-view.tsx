"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { BarLine, Empty, Icon } from "./ui";
import { Button } from "@/components/ui/button";
import { SegTabs } from "@/components/ui/seg-tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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
  groupIds?: string[];
  groupNames?: string[];
};

type AutoFundConfig = {
  enabled: boolean;
  thresholdUsdc: string;
  topUpUsdc: string;
  minIntervalMinutes: number;
};

type GroupRow = {
  id: string;
  name: string;
  status: string;
  memberCount: number;
  members: { id: string; name: string; status: string }[];
  budgetId?: string;
  autoFund?: AutoFundConfig;
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

/** Overview-style vertical bars — click a column to set the dollar height. */
function AutoFundBars({
  thresholdUsdc,
  topUpUsdc,
  disabled,
  onChange,
}: {
  thresholdUsdc: string;
  topUpUsdc: string;
  disabled?: boolean;
  onChange: (next: { thresholdUsdc: string; topUpUsdc: string }) => void;
}) {
  const th = Math.max(0, Number(thresholdUsdc) || 0);
  const up = Math.max(0, Number(topUpUsdc) || 0);
  const scale = Math.max(th, up, 50) * 1.15;
  const cols = [
    { key: "threshold" as const, label: "If below", value: th, caption: "trigger" },
    { key: "topUp" as const, label: "Top up", value: up, caption: "peak" },
  ];
  const peak = up >= th ? 1 : 0;

  function setFromClick(
    key: "threshold" | "topUp",
    e: MouseEvent<HTMLDivElement>,
  ) {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = 1 - Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const raw = Math.round(pct * scale);
    const clamped = Math.max(key === "topUp" ? 1 : 0, Math.min(500, raw));
    if (key === "threshold") onChange({ thresholdUsdc: String(clamped), topUpUsdc });
    else onChange({ thresholdUsdc, topUpUsdc: String(clamped) });
  }

  return (
    <div className="ops-af-chart" aria-disabled={disabled}>
      <div className="ops-af-chart-head">
        <span className="muted" style={{ fontSize: 12.5 }}>
          Auto-fund levels
        </span>
        <span className="faint" style={{ fontSize: 11.5 }}>
          Click a column to set the amount
        </span>
      </div>
      <div className="ops-af-bars">
        {cols.map((c, i) => {
          const pct = Math.max((c.value / scale) * 100, c.value > 0 ? 6 : 2);
          const on = i === peak;
          return (
            <div className={`bar-col ${on ? "on" : ""}`} key={c.key}>
              <div
                className="bar-track"
                role="slider"
                tabIndex={disabled ? -1 : 0}
                aria-valuemin={0}
                aria-valuemax={Math.round(scale)}
                aria-valuenow={c.value}
                aria-label={c.label}
                title={`${c.label}: ${fmt(String(c.value))} — click to set`}
                onClick={(e) => setFromClick(c.key, e)}
                onKeyDown={(e) => {
                  if (disabled) return;
                  const step = e.shiftKey ? 10 : 1;
                  if (e.key === "ArrowUp" || e.key === "ArrowRight") {
                    e.preventDefault();
                    const next = Math.min(500, c.value + step);
                    if (c.key === "threshold") onChange({ thresholdUsdc: String(next), topUpUsdc });
                    else onChange({ thresholdUsdc, topUpUsdc: String(next) });
                  } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    const next = Math.max(c.key === "topUp" ? 1 : 0, c.value - step);
                    if (c.key === "threshold") onChange({ thresholdUsdc: String(next), topUpUsdc });
                    else onChange({ thresholdUsdc, topUpUsdc: String(next) });
                  }
                }}
              >
                <div className="bar-fill" style={{ height: `${pct}%` }}>
                  {on && <span className="bar-tag">{c.caption}</span>}
                  <span className="bar-val">{fmt(String(c.value))}</span>
                </div>
              </div>
              <div className="bar-x">{c.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AgentsView({
  gFetch,
  busy,
  act,
  onKeyRevealed,
  readOnly = false,
  onContextChange,
}: {
  gFetch: (path: string, init?: RequestInit) => Promise<Response>;
  busy: boolean;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  onKeyRevealed?: (entry: { agentId: string; name: string; key: string }) => void;
  readOnly?: boolean;
  onContextChange?: (label: string | null) => void;
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
  const [editGroupIds, setEditGroupIds] = useState<string[]>([]);
  const [sessionLabel, setSessionLabel] = useState("");
  const [sessionScopes, setSessionScopes] = useState<Array<"read" | "pay" | "escrow">>([
    "read",
    "pay",
    "escrow",
  ]);
  const [revealedSession, setRevealedSession] = useState<string | null>(null);

  const [rosterReady, setRosterReady] = useState(false);
  const [fundAmounts, setFundAmounts] = useState<Record<string, string>>({});
  const [fundFrom, setFundFrom] = useState<Record<string, string>>({});
  const [budgets, setBudgets] = useState<{ id: string; name: string; availableUsdc: string }[]>([]);
  /** Draft auto-fund knobs keyed by group id — drag to tune, save to persist. */
  const [afDraft, setAfDraft] = useState<
    Record<string, { thresholdUsdc: string; topUpUsdc: string; minIntervalMinutes: number }>
  >({});
  /** Which ops-label cards are expanded — collapsed by default to cut clutter. */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const refreshRoster = useCallback(async () => {
    const [a, g, b] = await Promise.all([
      gFetch("/v1/guardian/agents").then((x) => x.json()),
      gFetch("/v1/guardian/agent-groups").then((x) => x.json()),
      gFetch("/v1/guardian/budgets").then((x) => x.json()).catch(() => ({ budgets: [] })),
    ]);
    setAgents(a.agents ?? []);
    setGroups(g.groups ?? []);
    setBudgets(b.budgets ?? []);
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

  // Poll while viewing ops labels so request-path auto-fund sweeps show up.
  useEffect(() => {
    if (tab !== "groups") return;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refreshRoster();
    };
    const t = window.setInterval(tick, 15_000);
    return () => window.clearInterval(t);
  }, [tab, refreshRoster]);

  useEffect(() => {
    setAfDraft((prev) => {
      const next = { ...prev };
      for (const g of groups) {
        if (next[g.id]) continue;
        next[g.id] = {
          thresholdUsdc: g.autoFund?.thresholdUsdc ?? "5",
          topUpUsdc: g.autoFund?.topUpUsdc ?? "25",
          minIntervalMinutes: g.autoFund?.minIntervalMinutes ?? 5,
        };
      }
      return next;
    });
  }, [groups]);

  const agentBal = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of agents) m.set(a.id, Number(a.availableUsdc ?? 0) || 0);
    return m;
  }, [agents]);

  const loadDetail = useCallback(
    async (id: string) => {
      setSelected(id);
      const agentName = agents.find((a) => a.id === id)?.name;
      onContextChange?.(agentName ?? id.slice(0, 8));
      const [d, an] = await Promise.all([
        gFetch(`/v1/guardian/agents/${id}`).then((x) => x.json()),
        gFetch(`/v1/guardian/agents/${id}/analytics`).then((x) => x.json()),
      ]);
      setDetail(d);
      setAnalytics(an);
      const ident = d.identity as AgentRow | undefined;
      onContextChange?.(ident?.name ?? agentName ?? id.slice(0, 8));
      setRename(ident?.name ?? "");
      const profile = (ident?.profile ?? {}) as Record<string, unknown>;
      setTags(Array.isArray(profile.tags) ? (profile.tags as string[]).join(", ") : "");
      setRuntime(typeof profile.runtime === "string" ? profile.runtime : "");
      setOwnerId(
        typeof profile.ownerGuardianId === "string" ? profile.ownerGuardianId : "owner",
      );
      setEditGroupIds(
        groups.filter((g) => g.members.some((m) => m.id === id)).map((g) => g.id),
      );
    },
    [gFetch, agents, groups, onContextChange],
  );

  useEffect(() => {
    if (tab !== "roster" || !selected) onContextChange?.(null);
  }, [tab, selected, onContextChange]);

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
    act("Create ops label", async () => {
      const res = await gFetch("/v1/guardian/agent-groups", {
        method: "POST",
        body: JSON.stringify({ name: groupName.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d.error));
      setGroupName("");
      await refresh();
      return `Ops label ${d.group.name} ready.`;
    });

  const selectedAgent = agents.find((a) => a.id === selected);

  return (
    <>
      <div className="card-head" style={{ marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Agents</h2>
          <div className="sub">Identity, ops labels, keys, sessions, freeze audit</div>
        </div>
        <SegTabs
          value={tab}
          onValueChange={(v) => setTab(v as typeof tab)}
          items={
            [
              { value: "roster", label: "Roster" },
              { value: "groups", label: "Ops labels" },
              { value: "sessions", label: "Sessions" },
              { value: "freezes", label: "Freezes" },
            ] as const
          }
        />
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
                <Button size="sm"
                  disabled={locked || !newName.trim()}
                  onClick={() => void createAgent()}
                >
                  Create
                </Button>
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
                    <th>Ops label</th>
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
                        <Button variant="ghost" size="sm"
                          style={{ padding: 0, fontWeight: 600 }}
                          onClick={() => void loadDetail(a.id)}
                        >
                          {a.name}
                        </Button>
                      </td>
                      <td>
                        <span className={`pill ${statusTone(a.status)}`}>
                          <i /> {a.status}
                        </span>
                      </td>
                      <td className="faint">{(a.groupNames?.length ? a.groupNames.join(", ") : a.groupName) ?? "—"}</td>
                      <td className="mono">{fmt(a.availableUsdc)}</td>
                      <td className="mono faint">{fmt(a.spent24hUsdc)}</td>
                      <td className="faint">{a.apiKeyLive ? "live" : "revoked"}</td>
                      <td>
                        <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                          {a.status === "active" && (
                            <Button variant="ghost" size="sm"
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
                            </Button>
                          )}
                          {a.status === "frozen" && (
                            <Button variant="ghost" size="sm"
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
                            </Button>
                          )}
                          {a.status !== "archived" && (
                            <Button variant="ghost" size="sm"
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
                            </Button>
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
                    Ops labels (multi)
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                      {groups
                        .filter((g) => g.status === "active")
                        .map((g) => (
                          <label key={g.id} className="row" style={{ gap: 6, fontSize: 12.5 }}>
                            <input
                              type="checkbox"
                              disabled={readOnly}
                              checked={editGroupIds.includes(g.id)}
                              onChange={(e) =>
                                setEditGroupIds((prev) =>
                                  e.target.checked
                                    ? [...prev, g.id]
                                    : prev.filter((x) => x !== g.id),
                                )
                              }
                            />
                            {g.name}
                          </label>
                        ))}
                      {!groups.some((g) => g.status === "active") && (
                        <span className="faint">No ops labels yet — create a budget or label first.</span>
                      )}
                    </div>
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
                          groupId: editGroupIds[0] ?? "",
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
                        const desired = new Set(editGroupIds);
                        const current = new Set(
                          groups
                            .filter((g) => g.members.some((m) => m.id === selected))
                            .map((g) => g.id),
                        );
                        for (const gid of desired) {
                          if (!current.has(gid)) {
                            await gFetch(`/v1/guardian/agent-groups/${gid}/assign`, {
                              method: "POST",
                              body: JSON.stringify({ agentIds: [selected] }),
                            });
                          }
                        }
                        for (const gid of current) {
                          if (!desired.has(gid)) {
                            await gFetch(`/v1/guardian/agent-groups/${gid}/unassign`, {
                              method: "POST",
                              body: JSON.stringify({ agentIds: [selected] }),
                            });
                          }
                        }
                        await refresh();
                        await loadDetail(selected!);
                        return "Profile + ops labels saved.";
                      })
                    }
                  >
                    Save identity
                  </button>
                </div>

                <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                  <Button variant="ghost" size="sm"
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
                  </Button>
                  {selectedAgent?.status !== "archived" ? (
                    <Button variant="ghost" size="sm"
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
                    </Button>
                  ) : (
                    <Button size="sm"
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
                    </Button>
                  )}
                  <div className="field" style={{ margin: "0 0 10px", flex: "1 1 160px" }}>
                    <label>Session label</label>
                    <input
                      value={sessionLabel}
                      disabled={locked || selectedAgent?.status !== "active"}
                      onChange={(e) => setSessionLabel(e.target.value)}
                      placeholder="console"
                    />
                  </div>
                  <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                    {(["read", "pay", "escrow"] as const).map((scope) => (
                      <label key={scope} className="row" style={{ gap: 6, fontSize: 12.5 }}>
                        <input
                          type="checkbox"
                          disabled={locked || selectedAgent?.status !== "active"}
                          checked={sessionScopes.includes(scope)}
                          onChange={(e) =>
                            setSessionScopes((prev) =>
                              e.target.checked
                                ? [...prev, scope]
                                : prev.filter((s) => s !== scope),
                            )
                          }
                        />
                        {scope}
                      </label>
                    ))}
                  </div>
                  <Button size="sm"
                    disabled={locked || selectedAgent?.status !== "active" || sessionScopes.length === 0}
                    onClick={() =>
                      void act("Mint session", async () => {
                        const res = await gFetch(
                          `/v1/guardian/agents/${selected}/session-keys`,
                          {
                            method: "POST",
                            body: JSON.stringify({
                              label: sessionLabel.trim() || "console",
                              ttlHours: 24,
                              scopes: sessionScopes,
                            }),
                          },
                        );
                        const d = await res.json();
                        if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d.error));
                        setRevealedSession(d.sessionKey.token);
                        setSessionLabel("");
                        await refresh();
                        return `Session minted with scopes: ${sessionScopes.join(", ")}.`;
                      })
                    }
                  >
                    Mint 24h session
                  </Button>
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
              <h2>Ops labels</h2>
              <div className="sub">
                Roster tags paired with Treasury budgets for freeze / bulk stipend —{" "}
                <b>not wallets</b>. Creating a budget auto-creates a matching label. Prefer
                separate agents per job (writer-finance vs writer-research) instead of one agent
                in many money clubs.
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input
                placeholder="e.g. research-ops"
                value={groupName}
                disabled={readOnly}
                onChange={(e) => setGroupName(e.target.value)}
              />
              <Button size="sm"
                disabled={locked || !groupName.trim()}
                onClick={() => void createGroup()}
              >
                Create label
              </Button>
            </div>
          </div>
          <div
            className="banner info"
            style={{ marginBottom: 14 }}
          >
            <span className="txt">
              <b>Budget → ops label</b>
              <span>
                Create Finance under Treasury → Budgets — a Finance ops label is created and linked
                automatically. Assign agents here, then fund them from that budget.
              </span>
            </span>
          </div>
          {groups.length === 0 ? (
            <Empty icon="robot">
              No ops labels yet — optional. Create agents and fund them from a budget in Treasury.
            </Empty>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {groups.map((g) => {
                const memberIdSet = new Set(g.members.map((m) => m.id));
                const ungrouped = agents.filter(
                  (a) => a.status !== "archived" && !memberIdSet.has(a.id),
                );
                const linkedBudget = g.budgetId
                  ? budgets.find((b) => b.id === g.budgetId)
                  : budgets.find((b) => b.name.toLowerCase() === g.name.toLowerCase());
                const defaultFund = linkedBudget?.id ?? "org";
                const fundSrc = fundFrom[g.id] ?? defaultFund;
                const open = Boolean(openGroups[g.id]);
                const draft = afDraft[g.id] ?? {
                  thresholdUsdc: "5",
                  topUpUsdc: "25",
                  minIntervalMinutes: 5,
                };
                const th = Math.max(0, Number(draft.thresholdUsdc) || 0);
                return (
                  <Collapsible
                    key={g.id}
                    open={open}
                    onOpenChange={(next) =>
                      setOpenGroups((m) => ({ ...m, [g.id]: next }))
                    }
                    className={`ops-card ${open ? "is-open" : ""}`}
                  >
                    <div className="ops-card-head">
                      <CollapsibleTrigger asChild>
                        <button type="button" className="ops-card-toggle" aria-expanded={open}>
                          <span className={`ops-card-chevron ${open ? "open" : ""}`} aria-hidden>
                            <Icon name="chevronRight" size={14} />
                          </span>
                          <span className="ops-card-title">
                            <b>{g.name}</b>
                            <span className={`pill ${statusTone(g.status)}`}>
                              <i /> {g.status}
                            </span>
                            {linkedBudget && (
                              <span className="pill mute">
                                <i /> {linkedBudget.name} · {fmt(linkedBudget.availableUsdc)}
                              </span>
                            )}
                            {g.autoFund?.enabled && (
                              <span className="pill info">
                                <i /> auto-fund
                              </span>
                            )}
                          </span>
                          <span className="ops-card-meta faint">
                            {g.members.length
                              ? `${g.members.length} agent${g.members.length === 1 ? "" : "s"}`
                              : "No members"}
                          </span>
                        </button>
                      </CollapsibleTrigger>
                    </div>

                    <CollapsibleContent className="ops-card-body">
                      {g.status === "active" && (
                        <div className="ops-card-panel">
                          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={locked || !g.members.length}
                              onClick={() =>
                                void act("Freeze labeled agents", async () => {
                                  const res = await gFetch(
                                    `/v1/guardian/agent-groups/${g.id}/freeze`,
                                    {
                                      method: "POST",
                                      body: JSON.stringify({ reason: "ops_label_kill_switch" }),
                                    },
                                  );
                                  const d = await res.json();
                                  if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
                                  await refresh();
                                  return `Froze ${d.frozen?.length ?? 0} agent(s) under ${g.name}.`;
                                })
                              }
                            >
                              Freeze
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={locked || !g.members.length}
                              onClick={() =>
                                void act("Unfreeze labeled agents", async () => {
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
                            </Button>
                            <Button
                              size="sm"
                              disabled={
                                locked ||
                                !g.members.length ||
                                !Number(fundAmounts[g.id] ?? "10")
                              }
                              onClick={() =>
                                void act("Fund members", async () => {
                                  const each = (fundAmounts[g.id] ?? "10").trim();
                                  if (!each) return;
                                  const src = fundFrom[g.id] ?? defaultFund;
                                  const body: {
                                    amountUsdcEach: string;
                                    fromScope: "org" | "department";
                                    fromId?: string;
                                  } = {
                                    amountUsdcEach: each,
                                    fromScope: src === "org" ? "org" : "department",
                                  };
                                  if (src !== "org") body.fromId = src;
                                  const res = await gFetch(
                                    `/v1/guardian/agent-groups/${g.id}/fund`,
                                    {
                                      method: "POST",
                                      body: JSON.stringify(body),
                                    },
                                  );
                                  const d = await res.json();
                                  if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
                                  await refresh();
                                  return `Funded ${d.funded?.length ?? 0} agents · $${d.amountUsdcEach} each from ${d.sourceLabel} ($${d.totalUsdc} total).`;
                                })
                              }
                            >
                              Fund
                            </Button>
                            <select
                              className="sm"
                              style={{ minWidth: 140 }}
                              disabled={locked || !g.members.length}
                              value={fundSrc}
                              onChange={(e) =>
                                setFundFrom((m) => ({ ...m, [g.id]: e.target.value }))
                              }
                              title="Where the stipend comes from"
                            >
                              <option value="org">From org vault</option>
                              {budgets.map((b) => (
                                <option key={b.id} value={b.id}>
                                  From budget · {b.name} (${b.availableUsdc})
                                </option>
                              ))}
                            </select>
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
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={locked}
                              onClick={() =>
                                void act("Archive ops label", async () => {
                                  await gFetch(`/v1/guardian/agent-groups/${g.id}/archive`, {
                                    method: "POST",
                                  });
                                  await refresh();
                                  return `${g.name} archived.`;
                                })
                              }
                            >
                              Archive
                            </Button>
                          </div>

                          <div className="ops-autofund">
                            <div className="ops-member-cap">
                              <div className="between" style={{ marginBottom: 10 }}>
                                <span className="muted" style={{ fontSize: 12.5 }}>
                                  Member stipends
                                </span>
                                <span className="pill mute">
                                  <i /> trigger {fmt(String(th))}
                                </span>
                              </div>
                              {g.members.length === 0 ? (
                                <span className="faint" style={{ fontSize: 12 }}>
                                  Assign agents below — their available balance shows as a bar.
                                </span>
                              ) : (
                                g.members.map((m) => {
                                  const bal = agentBal.get(m.id) ?? 0;
                                  const low = bal < th;
                                  const barMax = Math.max(th * 2, bal, (Number(draft.topUpUsdc) || 0), 25);
                                  return (
                                    <div key={m.id} className="ops-member-bar">
                                      <div className="between" style={{ marginBottom: 5 }}>
                                        <span style={{ fontSize: 12.5 }}>
                                          {m.name}
                                          {low ? (
                                            <span className="pill warn" style={{ marginLeft: 6 }}>
                                              <i /> low
                                            </span>
                                          ) : null}
                                        </span>
                                        <span className="row" style={{ gap: 8 }}>
                                          <span className="mono faint" style={{ fontSize: 11.5 }}>
                                            {fmt(String(bal))}
                                          </span>
                                          <Button
                                            variant="bare"
                                            style={{ fontSize: 11, padding: 0, minWidth: 0 }}
                                            disabled={locked}
                                            onClick={() =>
                                              void act("Remove from label", async () => {
                                                await gFetch(
                                                  `/v1/guardian/agent-groups/${g.id}/unassign`,
                                                  {
                                                    method: "POST",
                                                    body: JSON.stringify({ agentIds: [m.id] }),
                                                  },
                                                );
                                                await refresh();
                                                return `Removed ${m.name} from ${g.name}.`;
                                              })
                                            }
                                          >
                                            ×
                                          </Button>
                                        </span>
                                      </div>
                                      <BarLine value={bal} max={barMax} />
                                    </div>
                                  );
                                })
                              )}
                            </div>

                            <div className="ops-autofund-head">
                              <label className="row" style={{ gap: 8, fontSize: 13 }}>
                                <button
                                  type="button"
                                  className={`switch ${g.autoFund?.enabled ? "on" : ""}`}
                                  disabled={locked || !linkedBudget}
                                  onClick={() =>
                                    void act("Auto-fund", async () => {
                                      const enabled = !g.autoFund?.enabled;
                                      const res = await gFetch(
                                        `/v1/guardian/agent-groups/${g.id}/auto-fund`,
                                        {
                                          method: "PATCH",
                                          body: JSON.stringify({
                                            enabled,
                                            ...draft,
                                          }),
                                        },
                                      );
                                      const d = await res.json();
                                      if (!res.ok) {
                                        throw new Error(d.error?.message ?? JSON.stringify(d));
                                      }
                                      await refresh();
                                      if (enabled && d.toppedUp > 0) {
                                        return `Auto-fund on — topped up ${d.toppedUp} agent(s) just now.`;
                                      }
                                      return enabled
                                        ? `Auto-fund on for ${g.name} (from linked budget).`
                                        : `Auto-fund off for ${g.name}.`;
                                    })
                                  }
                                  aria-label="Toggle auto-fund"
                                />
                                Auto-fund when stipend is low
                              </label>
                              {linkedBudget ? (
                                <span className="pill mute">
                                  <i /> from {linkedBudget.name}
                                </span>
                              ) : (
                                <span className="faint" style={{ fontSize: 11.5 }}>
                                  Create a matching Treasury budget to enable auto-fund.
                                </span>
                              )}
                            </div>

                            <AutoFundBars
                              thresholdUsdc={draft.thresholdUsdc}
                              topUpUsdc={draft.topUpUsdc}
                              disabled={locked || !linkedBudget}
                              onChange={(next) =>
                                setAfDraft((m) => ({
                                  ...m,
                                  [g.id]: { ...draft, ...next },
                                }))
                              }
                            />

                            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                              <Button
                                size="sm"
                                disabled={locked || !linkedBudget}
                                onClick={() =>
                                  void act("Save auto-fund", async () => {
                                    const res = await gFetch(
                                      `/v1/guardian/agent-groups/${g.id}/auto-fund`,
                                      {
                                        method: "PATCH",
                                        body: JSON.stringify({
                                          enabled: g.autoFund?.enabled ?? true,
                                          thresholdUsdc: draft.thresholdUsdc,
                                          topUpUsdc: draft.topUpUsdc,
                                          minIntervalMinutes: draft.minIntervalMinutes,
                                        }),
                                      },
                                    );
                                    const d = await res.json();
                                    if (!res.ok) {
                                      throw new Error(d.error?.message ?? JSON.stringify(d));
                                    }
                                    await refresh();
                                    const n = typeof d.toppedUp === "number" ? d.toppedUp : 0;
                                    return n > 0
                                      ? `Saved — topped up ${n} agent(s) immediately (below $${draft.thresholdUsdc} → +$${draft.topUpUsdc}).`
                                      : `Auto-fund: if below $${draft.thresholdUsdc} → top up $${draft.topUpUsdc} from budget.`;
                                  })
                                }
                              >
                                Save rule
                              </Button>
                              <span className="faint" style={{ fontSize: 11.5, alignSelf: "center" }}>
                                Runs on console refresh when enabled — no Fund click needed.
                              </span>
                            </div>

                            {ungrouped.length > 0 && (
                              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                                <select
                                  id={`assign-${g.id}`}
                                  defaultValue=""
                                  disabled={readOnly}
                                  style={{ minWidth: 180 }}
                                >
                                  <option value="">Assign agent…</option>
                                  {ungrouped.map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {a.name} · {fmt(a.availableUsdc)}
                                    </option>
                                  ))}
                                </select>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={locked}
                                  onClick={() =>
                                    void act("Assign to ops label", async () => {
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
                                      if (!res.ok) {
                                        throw new Error(d.error?.message ?? JSON.stringify(d));
                                      }
                                      if (el) el.value = "";
                                      await refresh();
                                      return `Assigned to ${g.name}.`;
                                    })
                                  }
                                >
                                  Assign
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
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
                Short-lived <code>pv_sess_…</code> tokens — scopes enforced on agent API routes;
                revoked on freeze/archive
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
                          <Button variant="ghost" size="sm"
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
                          </Button>
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
              <h2>Freeze audit</h2>
              <div className="sub">Kill-switch events, rotations, revokes, archives</div>
            </div>
          </div>
          {freezes.length === 0 ? (
            <p className="faint" style={{ margin: "8px 0 4px", fontSize: 13 }}>
              No freeze events yet. Freeze an agent from the Roster tab.
            </p>
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
