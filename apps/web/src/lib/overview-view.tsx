"use client";

import { useMemo, useState } from "react";
import { AIPanel } from "./views";
import type { InvoiceStats, Summary } from "./views";
import { BarChart, BarLine, Calendar, Donut, Empty, Icon, Stat, fmtTime, fmtUsd } from "./ui";
import type { AgentKey, Alert, Approval, Decision, Escrow, Metrics, Session, Shared, View } from "./console-types";
import type { Policy } from "./policy-view";
import { Button } from "@/components/ui/button";
import { SegTabs } from "@/components/ui/seg-tabs";

export function Overview({
  org,
  readOnly,
  metrics,
  decisions,
  approvals,
  escrows,
  policy,
  busy,
  act,
  gFetch,
  agentName,
  setView,
  session,
  updateSession,
  alerts,
  summary,
  invStats,
}: Shared & {
  metrics: Metrics | null;
  decisions: Decision[];
  approvals: Approval[];
  escrows: Escrow[];
  policy: Policy | null;
  session: Session;
  updateSession: (patch: Partial<Session>) => void;
  alerts: Alert[];
  summary: Summary | null;
  invStats: InvoiceStats | null;
}) {
  const [range, setRange] = useState<"24h" | "7d" | "all">("all");
  const [newAgent, setNewAgent] = useState("");
  const [revealed, setRevealed] = useState<AgentKey | null>(null);

  const orgAvail = org?.balances.find((b) => b.kind === "org_available")?.usdc;
  const spendDecisions = useMemo(
    () => decisions.filter((d) => d.outcome === "allow" && Number(d.amountUsdc) > 0),
    [decisions],
  );

  const windowed = useMemo(() => {
    const cut =
      range === "24h" ? Date.now() - 864e5 : range === "7d" ? Date.now() - 6048e5 : 0;
    return spendDecisions.filter((d) => new Date(d.at).getTime() >= cut);
  }, [spendDecisions, range]);

  // Spend grouped into 12 buckets across the observed window
  const buckets = useMemo(() => {
    if (!windowed.length) return [];
    const times = windowed.map((d) => new Date(d.at).getTime());
    const min = Math.min(...times);
    const max = Math.max(...times, min + 1);
    const span = max - min;
    const n = 12;
    const size = span / n || 1;
    // Pick a label granularity that actually distinguishes the buckets: a run
    // that happened inside a minute needs seconds, a week needs dates.
    const fmt: Intl.DateTimeFormatOptions =
      span < 6 * 60_000
        ? { minute: "2-digit", second: "2-digit" }
        : span < 36 * 3600_000
          ? { hour: "2-digit", minute: "2-digit" }
          : { month: "short", day: "numeric" };
    const out = Array.from({ length: n }, (_, i) => ({
      label: new Date(min + size * i).toLocaleString([], { ...fmt, hour12: false }),
      value: 0,
    }));
    for (const d of windowed) {
      const i = Math.min(n - 1, Math.floor((new Date(d.at).getTime() - min) / size));
      out[i].value += Number(d.amountUsdc);
    }
    // Blank out repeated labels so the axis stays readable.
    let prev = "";
    for (const b of out) {
      if (b.label === prev) b.label = "";
      else prev = b.label;
    }
    return out;
  }, [windowed]);

  const peak = buckets.reduce((best, b, i) => (b.value > (buckets[best]?.value ?? 0) ? i : best), 0);
  const totalSpend = windowed.reduce((a, d) => a + Number(d.amountUsdc), 0);

  const byDest = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of windowed) {
      const key = d.destination.replace(/^https?:\/\//, "").split("/")[0];
      m.set(key, (m.get(key) ?? 0) + Number(d.amountUsdc));
    }
    const colors = ["var(--orange)", "var(--green)", "var(--yellow)", "var(--accent)", "var(--purple)", "#64748b"];
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value], i) => ({ label, value, color: colors[i % colors.length] }));
  }, [windowed]);

  const marks = useMemo(
    () => [...new Set(decisions.map((d) => d.at.slice(0, 10)).filter(Boolean))],
    [decisions],
  );

  const createAgent = () =>
    act("Create agent", async () => {
      const res = await gFetch("/v1/guardian/agents", {
        method: "POST",
        body: JSON.stringify({ name: newAgent.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(d.error));
      const entry = { agentId: d.agentId, name: newAgent.trim(), key: d.apiKey };
      setRevealed(entry);
      updateSession({ agentKeys: [...session.agentKeys, entry] });
      setNewAgent("");
      return "Agent created — key saved to the Playground and shown once below.";
    });

  /**
   * Move funds lives under Treasury → Move so Overview stays a glance surface.
   */

  const rotateKey = (agentId: string) =>
    act("Rotate key", async () => {
      const res = await gFetch(`/v1/guardian/agents/${agentId}/rotate-key`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(d.error));
      setRevealed({ agentId, name: `${agentName(agentId)} (rotated)`, key: d.apiKey });
      updateSession({
        agentKeys: session.agentKeys.map((k) =>
          k.agentId === agentId ? { ...k, key: d.apiKey } : k,
        ),
      });
      return "Key rotated — the old key is dead. Copy the new one below.";
    });

  const freeze = (id: string, on: boolean) =>
    act("Freeze", async () => {
      await gFetch(`/v1/guardian/${on ? "freeze" : "unfreeze"}`, {
        method: "POST",
        body: JSON.stringify({ agentId: id, ...(on ? { reason: "guardian kill switch" } : {}) }),
      });
      return `${agentName(id)} ${on ? "frozen — all spending stopped" : "unfrozen"}.`;
    });

  return (
    <>
      <div className="grid g-4">
        <Stat
          label="Org treasury"
          value={fmtUsd(orgAvail)}
          foot="unallocated USDC"
          delta={{ dir: "flat", text: "vault" }}
        />
        <Stat
          label="With agents"
          value={fmtUsd(metrics?.balancesUsdc?.agentAvailable)}
          foot={`${fmtUsd(metrics?.balancesUsdc?.escrow ?? "0")} locked in escrow`}
        />
        <Stat
          label="Spent externally"
          value={fmtUsd(metrics?.balancesUsdc?.external)}
          foot={`${metrics?.journals ?? 0} ledger entries`}
          delta={totalSpend > 0 ? { dir: "up", text: fmtUsd(totalSpend) } : undefined}
        />
        <Stat
          label="Blocked attempts"
          value={String(metrics?.decisions?.deny ?? 0)}
          foot="policy denials — safety working"
          delta={
            (metrics?.decisions?.deny ?? 0) > 0 ? { dir: "down", text: "denied" } : { dir: "flat", text: "none" }
          }
        />
      </div>

      <div className="grid g-main fill">
        <div className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="card-head">
            <div>
              <h2>Agent spend</h2>
              <div className="sub">
                {fmtUsd(totalSpend)} across {windowed.length} settled payments
              </div>
            </div>
            <SegTabs
              value={range}
              onValueChange={(v) => setRange(v as typeof range)}
              items={
                [
                  { value: "24h", label: "24 hours" },
                  { value: "7d", label: "7 days" },
                  { value: "all", label: "All time" },
                ] as const
              }
            />
          </div>
          <div style={{ flex: 1, minHeight: 220 }}>
            {buckets.length ? (
              <BarChart
                data={buckets.map((b, i) => ({ ...b, caption: i === peak ? "peak" : undefined }))}
                highlightIndex={peak}
              />
            ) : (
              <Empty icon="play">
                No spending yet. Open the <b>Agent Playground</b> and run a mission to see money
                move under policy.
              </Empty>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div className="card">
            <Calendar marks={marks} />
          </div>
          <div className="card" style={{ flex: 1 }}>
            <div className="between" style={{ marginBottom: 12 }}>
              <span className="muted" style={{ fontSize: 12.5 }}>
                Daily cap headroom
              </span>
              <span className="pill info">
                <i /> {fmtUsd(policy?.dailyMaxUsdc)}/agent
              </span>
            </div>
            {(org?.agents ?? []).slice(0, 4).map((a) => (
              <div key={a.id} style={{ marginBottom: 13 }}>
                <div className="between" style={{ marginBottom: 5 }}>
                  <span style={{ fontSize: 12.5 }}>{a.name}</span>
                  <span className="mono faint" style={{ fontSize: 11.5 }}>
                    {fmtUsd(a.spent24hUsdc)}
                  </span>
                </div>
                <BarLine value={Number(a.spent24hUsdc)} max={Number(org?.dailyMaxUsdc ?? 1)} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid g-thirds fill">
        <AIPanel summary={summary} gFetch={gFetch} onGoto={(v) => setView(v as View)} />

        <div className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="card-head">
            <div>
              <h2>Where the money went</h2>
              <div className="sub">Last {range === "24h" ? "24 hours" : range === "7d" ? "7 days" : "all time"}</div>
            </div>
          </div>
          {byDest.length ? (
            <>
              <div className="donut-wrap">
                <Donut
                  slices={byDest}
                  total={fmtUsd(totalSpend, totalSpend < 100 ? 2 : 0)}
                  caption="settled"
                />
                <div className="legend">
                  {byDest.map((s) => (
                    <div className="legend-row" key={s.label}>
                      <i style={{ background: s.color }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>
                      <span className="amt">{fmtUsd(s.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="divider" />
              <div className="between" style={{ fontSize: 12.5 }}>
                <span className="muted">Revenue collected</span>
                <b className="mono" style={{ color: "var(--green)" }}>
                  {fmtUsd(invStats?.paidUsdc ?? "0")}
                </b>
              </div>
              <div className="between" style={{ fontSize: 12.5, marginTop: 8 }}>
                <span className="muted">Net position</span>
                <b
                  className="mono"
                  style={{
                    color: Number(invStats?.paidUsdc ?? 0) - totalSpend >= 0 ? "var(--green)" : "var(--warn)",
                  }}
                >
                  {fmtUsd(Number(invStats?.paidUsdc ?? 0) - totalSpend)}
                </b>
              </div>
            </>
          ) : (
            <Empty icon="wallet">
              No settled payments yet. Run a mission to see where agent money goes.
            </Empty>
          )}
        </div>

        <div className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="card-head">
            <h2>{alerts.length ? "Needs you" : "Recent decisions"}</h2>
            <button
              className="round"
              onClick={() => setView(alerts.length ? alerts[0].goto : "activity")}
              aria-label="Open"
            >
              <Icon name="arrowRight" />
            </button>
          </div>
          {alerts.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 9, flex: 1 }}>
              {alerts.slice(0, 4).map((al) => (
                <button key={al.id} className="mission-card" onClick={() => setView(al.goto)}>
                  <b>{al.title}</b>
                  <p>{al.body}</p>
                </button>
              ))}
            </div>
          ) : decisions.length === 0 ? (
            <Empty icon="shield">
              Everything is inside policy — no approvals pending, no drift, no failed deliveries.
            </Empty>
          ) : (
            <div style={{ flex: 1 }}>
              {decisions.slice(0, 6).map((d) => (
                <div className="lrow" key={d.intentId + d.at}>
                  <div className="when">
                    <b>{fmtTime(d.at)}</b>
                    <span>{agentName(d.agentId)}</span>
                  </div>
                  <div className="who">
                    <span className="mono">{d.destination.replace(/^https?:\/\//, "").slice(0, 24)}</span>
                    <div className="faint" style={{ fontSize: 11 }}>
                      {d.ruleIds[0]}
                    </div>
                  </div>
                  <span
                    className={`pill ${d.outcome === "allow" ? "ok" : d.outcome === "deny" ? "bad" : "warn"}`}
                  >
                    {d.outcome}
                  </span>
                  <span className="amt">{fmtUsd(d.amountUsdc)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid g-main fill">
        <div className="card" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div className="card-head">
            <div>
              <h2>Agents</h2>
              <div className="sub">Each agent has its own stipend wallet and pays under policy</div>
            </div>
            <div className="row">
              <input
                style={{ width: 160 }}
                placeholder="New agent name"
                value={newAgent}
                disabled={readOnly}
                onChange={(e) => setNewAgent(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && newAgent.trim() && void createAgent()}
              />
              <Button size="sm" disabled={busy || readOnly || !newAgent.trim()} onClick={() => void createAgent()}>
                <Icon name="plus" size={13} /> Create
              </Button>
            </div>
          </div>
          {revealed && (
            <div className="code" style={{ marginBottom: 14 }}>
              <b style={{ color: "var(--text)" }}>{revealed.name}</b> API key — shown once, already
              loaded into the Playground:
              <div style={{ marginTop: 6, color: "var(--accent)" }}>{revealed.key}</div>
              <Button variant="ghost" size="sm" style={{ marginTop: 9 }} onClick={() => setRevealed(null)}>
                I saved it
              </Button>
            </div>
          )}
          <div className="tbl-wrap" style={{ flex: 1 }}>
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Status</th>
                  <th className="num">Available</th>
                  <th className="num">Held</th>
                  <th>Spent today</th>
                  <th>Key</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(org?.agents ?? []).map((a) => {
                  const av = org?.balances.find((b) => b.kind === "agent_available" && b.agentId === a.id)?.usdc;
                  const held = org?.balances.find((b) => b.kind === "agent_held" && b.agentId === a.id)?.usdc;
                  const frozen = a.status === "frozen";
                  const hasKey = session.agentKeys.some((k) => k.agentId === a.id);
                  return (
                    <tr key={a.id}>
                      <td>
                        <b style={{ fontWeight: 600 }}>{a.name}</b>{" "}
                        <span className="faint mono" style={{ fontSize: 11 }}>
                          {a.id.slice(0, 12)}
                        </span>
                      </td>
                      <td>
                        <span className={`pill ${frozen ? "bad" : "ok"}`}>
                          <i /> {a.status}
                        </span>
                      </td>
                      <td className="num mono">{fmtUsd(av ?? "0")}</td>
                      <td className="num mono">{fmtUsd(held ?? "0")}</td>
                      <td style={{ minWidth: 110 }}>
                        <BarLine value={Number(a.spent24hUsdc)} max={Number(org?.dailyMaxUsdc ?? 1)} />
                      </td>
                      <td>
                        <span className={`pill ${hasKey ? "info" : "mute"}`}>
                          {hasKey ? "ready" : "—"}
                        </span>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                          <button
                            className={`sm ${frozen ? "ghost" : "danger"}`}
                            disabled={busy || readOnly}
                            onClick={() => void freeze(a.id, !frozen)}
                          >
                            {frozen ? "Unfreeze" : "Freeze"}
                          </button>
                          <Button variant="bare" size="sm"
                            disabled={busy || readOnly}
                            title="Issue a new API key — the old one stops working immediately"
                            onClick={() => void rotateKey(a.id)}
                          >
                            Rotate
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card move-cta-card" style={{ minWidth: 0 }}>
          <div className="card-head" style={{ marginBottom: 0 }}>
            <div>
              <h2>Move funds</h2>
              <div className="sub">Vault → budget → agent stipend</div>
            </div>
          </div>
          <ol className="move-cta-steps">
            <li>
              <span className="move-cta-num">1</span>
              <span>
                <b>Fill a budget</b> from the org vault
              </span>
            </li>
            <li>
              <span className="move-cta-num">2</span>
              <span>
                <b>Fund an agent</b> stipend from that budget
              </span>
            </li>
            <li>
              <span className="move-cta-num">3</span>
              <span>
                <b>Pull back or peer-move</b> when you need to rebalance
              </span>
            </li>
          </ol>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Button
              disabled={readOnly}
              onClick={() => {
                try {
                  sessionStorage.setItem("abi_treasury_tab", "move");
                } catch {
                  /* ignore */
                }
                setView("treasury");
              }}
            >
              <Icon name="swap" size={13} /> Open Treasury → Move
            </Button>
            <p className="faint" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.55 }}>
              Org vault has <b className="mono">{fmtUsd(orgAvail)}</b>. Large moves may park for
              multi-guardian approval.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

