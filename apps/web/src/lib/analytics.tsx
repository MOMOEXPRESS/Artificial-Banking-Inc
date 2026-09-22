"use client";

import { useEffect, useMemo, useState } from "react";
import { BarLine, Empty, Icon, Sparkline, Stat, fmtUsd, relTime } from "./ui";
import { Activity } from "./activity-view";
import type { Decision } from "./console-types";
import { Button } from "@/components/ui/button";
import { SegTabs } from "@/components/ui/seg-tabs";

/* ==================================================================== types */

export type Vendor = {
  vendor: string;
  totalUsdc: string;
  payments: number;
  blocked: number;
  firstSeen: string;
  lastSeen: string;
  avgUsdc: string;
  maxUsdc: string;
  trend: number[];
  allowlisted: boolean;
  sharePct: number;
};

export type Burn = {
  perAgent: {
    agentId: string;
    name: string;
    spentTodayUsdc: string;
    dailyCapUsdc: string;
    burnPerHourUsdc: string;
    hoursToCap: number | null;
    exhaustsAt: string | null;
    balanceUsdc: string;
    hoursToEmpty: number | null;
  }[];
  orgRunwayDays: number | null;
  orgBurnPerDayUsdc: string;
  note: string;
};

export type Anomaly = {
  intentId: string;
  at: string;
  agentName: string;
  amountUsdc: string;
  destination: string;
  score: number;
  signals: string[];
};

export type Economics = {
  runs: {
    runId: string;
    title: string;
    costUsdc: string;
    revenueUsdc: string;
    marginUsdc: string;
    multiple: number | null;
    invoiceNumber?: string;
    invoiceStatus?: string;
    finishedAt?: string;
  }[];
  totalCostUsdc: string;
  totalRevenueUsdc: string;
  netUsdc: string;
  avgCostUsdc: string;
  avgMultiple: number | null;
  billedCount: number;
  unbilledCount: number;
};

export type Simulation = {
  sampled: number;
  windowHours: number;
  current: Record<string, number>;
  proposed: Record<string, number>;
  changed: {
    at: string;
    agentName: string;
    tool: string;
    amountUsdc: string;
    destination: string;
    from: string;
    to: string;
    reason: string;
  }[];
  extraApprovalsPerDay: number;
  valueNewlyBlockedUsdc: string;
  valueNewlyAllowedUsdc: string;
  verdict: string;
};

type GFetch = (p: string, i?: RequestInit) => Promise<Response>;

/* ================================================================= insights */

/**
 * One screen for the four derived views: where money goes (vendors), where it
 * is going (burn), what looks wrong (anomalies) and whether the work pays for
 * itself (economics).
 */
export function InsightsView({
  gFetch,
  setView,
  decisions,
  agentName,
  setToast,
  query,
  initialTab,
  activitySeed,
}: {
  gFetch: GFetch;
  setView: (v: string) => void;
  decisions?: Decision[];
  agentName?: (id: string) => string;
  setToast?: (m: string, k?: "ok" | "err" | "info") => void;
  query?: string;
  initialTab?: "economics" | "vendors" | "burn" | "anomalies" | "trail";
  activitySeed?: {
    filter?: "all" | "allow" | "deny" | "review";
    dest?: string;
    key: number;
  };
}) {
  const [tab, setTab] = useState<"economics" | "vendors" | "burn" | "anomalies" | "trail">(
    initialTab ?? "economics",
  );
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [concentration, setConcentration] = useState(0);
  const [burn, setBurn] = useState<Burn | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [scanned, setScanned] = useState(0);
  const [econ, setEcon] = useState<Economics | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (activitySeed?.key) setTab("trail");
  }, [activitySeed?.key]);

  useEffect(() => {
    let alive = true;
    const sig = { current: "" };
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const [v, b, a, e] = await Promise.all([
          gFetch("/v1/guardian/vendors").then((r) => r.json()),
          gFetch("/v1/guardian/burn").then((r) => r.json()),
          gFetch("/v1/guardian/anomalies").then((r) => r.json()),
          gFetch("/v1/guardian/economics").then((r) => r.json()),
        ]);
        if (!alive) return;
        const next = {
          vendors: v.vendors ?? [],
          concentrationPct: v.concentrationPct ?? 0,
          burn: b.forecast ?? null,
          anomalies: a.anomalies ?? [],
          scanned: a.scanned ?? 0,
          econ: e.economics ?? null,
        };
        const fingerprint = JSON.stringify(next);
        if (fingerprint === sig.current) return;
        sig.current = fingerprint;
        setVendors(next.vendors);
        setConcentration(next.concentrationPct);
        setBurn(next.burn);
        setAnomalies(next.anomalies);
        setScanned(next.scanned);
        setEcon(next.econ);
        setLoaded(true);
      } catch {
        /* the shell owns the connection indicator */
      }
    };
    void load();
    const t = setInterval(load, 20000);
    const onVis = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [gFetch]);

  if (!loaded) {
    return (
      <>
        <div className="grid g-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 104 }} />
          ))}
        </div>
        <div className="skeleton" style={{ height: 320 }} />
      </>
    );
  }

  const net = Number(econ?.netUsdc ?? 0);

  return (
    <div className="console-page insights-page">
      <div className="grid g-4">
        <Stat
          label="Net position"
          value={fmtUsd(econ?.netUsdc)}
          foot={`${fmtUsd(econ?.totalRevenueUsdc)} billed − ${fmtUsd(econ?.totalCostUsdc)} spent`}
          delta={net >= 0 ? { dir: "up", text: "profit" } : { dir: "down", text: "loss" }}
        />
        <Stat
          label="Avg return"
          value={econ?.avgMultiple ? `${econ.avgMultiple}×` : "—"}
          foot={`${econ?.billedCount ?? 0} billed · ${econ?.unbilledCount ?? 0} unbilled`}
        />
        <Stat
          label="Daily burn"
          value={fmtUsd(burn?.orgBurnPerDayUsdc)}
          foot={
            burn?.orgRunwayDays !== null && burn?.orgRunwayDays !== undefined
              ? `${burn.orgRunwayDays} days of runway`
              : "no spend to project from"
          }
        />
        <Stat
          label="Flagged"
          value={String(anomalies.length)}
          foot={`of ${scanned} settled payments`}
          delta={anomalies.length ? { dir: "down", text: "review" } : { dir: "up", text: "clean" }}
        />
      </div>

      <div className="card-head" style={{ marginBottom: 12, padding: 0, border: "none", background: "transparent" }}>
        <SegTabs
          value={tab}
          onValueChange={(v) => setTab(v as typeof tab)}
          items={
            [
              { value: "economics", label: "P&L" },
              { value: "vendors", label: "Vendors" },
              { value: "burn", label: "Forecast" },
              { value: "anomalies", label: "Anomalies" },
              { value: "trail", label: "Activity" },
            ] as const
          }
        />
      </div>

      {tab === "trail" && decisions && agentName && setToast ? (
        <Activity
          decisions={decisions}
          agentName={agentName}
          setToast={setToast}
          query={query ?? ""}
          gFetch={gFetch}
          seedFilter={activitySeed?.filter}
          seedDest={activitySeed?.dest}
          seedKey={activitySeed?.key}
        />
      ) : (
      <div className="card fill" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div className="card-head">
          <div>
            <h2>
              {tab === "economics"
                ? "Does the work pay for itself?"
                : tab === "vendors"
                  ? "Who your agents buy from"
                  : tab === "burn"
                    ? "Where spending is heading"
                    : "What looks unusual"}
            </h2>
            <div className="sub">
              {tab === "economics"
                ? "Every mission's cost against what it was billed for"
                : tab === "vendors"
                  ? `${vendors.length} counterparties · top vendor is ${concentration}% of spend`
                  : tab === "burn"
                    ? burn?.note
                    : "Payments that passed policy but stand out — tighten a rule if warranted"}
            </div>
          </div>
        </div>

        {tab === "economics" &&
          (!econ?.runs.length ? (
            <Empty icon="book">
              No missions run yet. Every completed run lands here with what it cost and what it
              earned.
            </Empty>
          ) : (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Deliverable</th>
                    <th className="num">Cost</th>
                    <th className="num">Billed</th>
                    <th className="num">Margin</th>
                    <th className="num">Return</th>
                    <th>Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {econ.runs.map((r) => (
                    <tr key={r.runId}>
                      <td>
                        {r.title}
                        <div className="faint" style={{ fontSize: 11 }}>
                          {r.finishedAt ? relTime(r.finishedAt) : "in flight"}
                        </div>
                      </td>
                      <td className="num mono">{fmtUsd(r.costUsdc)}</td>
                      <td className="num mono">{fmtUsd(r.revenueUsdc)}</td>
                      <td
                        className="num mono"
                        style={{ color: Number(r.marginUsdc) >= 0 ? "var(--green)" : "var(--red)" }}
                      >
                        {fmtUsd(r.marginUsdc)}
                      </td>
                      <td className="num mono">{r.multiple ? `${r.multiple}×` : "—"}</td>
                      <td>
                        {r.invoiceNumber ? (
                          <span className={`pill ${r.invoiceStatus === "paid" ? "ok" : "warn"}`}>
                            {r.invoiceNumber}
                          </span>
                        ) : (
                          <Button variant="bare" size="sm" onClick={() => setView("work")}>
                            bill it
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {tab === "vendors" &&
          (!vendors.length ? (
            <Empty icon="wallet">No counterparties yet.</Empty>
          ) : (
            <>
              {concentration >= 60 && (
                <div className="banner" style={{ marginBottom: 14 }}>
                  <span className="ico">
                    <Icon name="alert" size={16} />
                  </span>
                  <span className="txt">
                    <b>Concentrated on one supplier</b>
                    <span>
                      {concentration}% of spend goes to {vendors[0].vendor}. An outage or price
                      change there hits you hard.
                    </span>
                  </span>
                </div>
              )}
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th>Status</th>
                      <th className="num">Total</th>
                      <th className="num">Payments</th>
                      <th className="num">Avg</th>
                      <th className="num">Largest</th>
                      <th className="num">Blocked</th>
                      <th>Share</th>
                      <th>Recent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendors.map((v) => (
                      <tr key={v.vendor}>
                        <td>
                          {v.vendor}
                          <div className="faint" style={{ fontSize: 11 }}>
                            first seen {relTime(v.firstSeen)}
                          </div>
                        </td>
                        <td>
                          <span className={`pill ${v.allowlisted ? "ok" : "mute"}`}>
                            {v.allowlisted ? "allowlisted" : "not listed"}
                          </span>
                        </td>
                        <td className="num mono">{fmtUsd(v.totalUsdc)}</td>
                        <td className="num mono">{v.payments}</td>
                        <td className="num mono">{fmtUsd(v.avgUsdc)}</td>
                        <td className="num mono">{fmtUsd(v.maxUsdc)}</td>
                        <td className="num mono" style={{ color: v.blocked ? "var(--red)" : undefined }}>
                          {v.blocked || "—"}
                        </td>
                        <td style={{ minWidth: 90 }}>
                          <BarLine value={v.sharePct} max={100} />
                          <span className="faint" style={{ fontSize: 10.5 }}>
                            {v.sharePct}%
                          </span>
                        </td>
                        <td style={{ width: 90 }}>
                          {v.trend.length > 1 ? <Sparkline values={v.trend} /> : <span className="faint">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ))}

        {tab === "burn" &&
          (!burn?.perAgent.length ? (
            <Empty icon="clock">No agents to project.</Empty>
          ) : (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th className="num">Burn / hour</th>
                    <th className="num">Spent today</th>
                    <th>Against cap</th>
                    <th>Hits cap</th>
                    <th className="num">Balance</th>
                    <th>Runs dry</th>
                  </tr>
                </thead>
                <tbody>
                  {burn.perAgent.map((a) => (
                    <tr key={a.agentId}>
                      <td>{a.name}</td>
                      <td className="num mono">{fmtUsd(a.burnPerHourUsdc)}</td>
                      <td className="num mono">{fmtUsd(a.spentTodayUsdc)}</td>
                      <td style={{ minWidth: 110 }}>
                        <BarLine value={Number(a.spentTodayUsdc)} max={Number(a.dailyCapUsdc)} />
                      </td>
                      <td>
                        {a.exhaustsAt ? (
                          <span className="pill warn">
                            <i /> in {a.hoursToCap}h
                          </span>
                        ) : (
                          <span className="faint">not at this rate</span>
                        )}
                      </td>
                      <td className="num mono">{fmtUsd(a.balanceUsdc)}</td>
                      <td className="faint mono">
                        {a.hoursToEmpty !== null ? `${a.hoursToEmpty}h` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {tab === "anomalies" &&
          (!anomalies.length ? (
            <Empty icon="shield">
              Nothing unusual in {scanned} settled payments. Amounts, timing, counterparties and
              bursts all look normal.
            </Empty>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {anomalies.map((a) => (
                <div
                  key={a.intentId}
                  className="card tight"
                  style={{
                    background: "var(--surface-3)",
                    borderColor: a.score >= 70 ? "rgba(248,113,113,0.3)" : "rgba(251,191,36,0.25)",
                  }}
                >
                  <div className="between" style={{ flexWrap: "wrap", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                        <b style={{ fontSize: 14.5 }}>{fmtUsd(a.amountUsdc)}</b>
                        <span className={`pill ${a.score >= 70 ? "bad" : "warn"}`}>
                          score {a.score}
                        </span>
                        <span className="faint mono" style={{ fontSize: 11.5 }}>
                          {a.agentName} → {a.destination.replace(/^https?:\/\//, "")}
                        </span>
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--muted)" }}>
                        {a.signals.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                    <span className="faint mono" style={{ fontSize: 11.5 }}>
                      {relTime(a.at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ))}
      </div>
      )}
    </div>
  );
}

/* ================================================================ simulator */

/**
 * Replays real history against a candidate ruleset. This is the answer to
 * "if I tighten this, what breaks?" — computed from your own traffic rather
 * than guessed.
 */
export function PolicySimulator({
  gFetch,
  current,
  draft,
}: {
  gFetch: GFetch;
  current: {
    hitlAboveUsdc: string;
    perTxMaxUsdc: string;
    dailyMaxUsdc: string;
    maxPaysPerMinute: number;
    vendorAllowlist?: string[];
    domainAllowlist?: string[];
    addressAllowlist?: string[];
    blocklist?: string[];
  };
  draft: {
    hitlAboveUsdc: string;
    perTxMaxUsdc: string;
    dailyMaxUsdc: string;
    maxPaysPerMinute: string;
    vendorAllowlist?: string[];
    domainAllowlist?: string[];
    addressAllowlist?: string[];
    blocklist?: string[];
    newCounterpartyCooldownHours?: string;
    quietHours?: { startHour: number; endHour: number; action: "review" | "deny" } | null;
  };
}) {
  const [sim, setSim] = useState<Simulation | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty = useMemo(
    () =>
      draft.hitlAboveUsdc !== current.hitlAboveUsdc ||
      draft.perTxMaxUsdc !== current.perTxMaxUsdc ||
      draft.dailyMaxUsdc !== current.dailyMaxUsdc ||
      Number(draft.maxPaysPerMinute) !== current.maxPaysPerMinute ||
      (draft.vendorAllowlist ?? []).join() !== (current.vendorAllowlist ?? []).join() ||
      (draft.domainAllowlist ?? []).join() !== (current.domainAllowlist ?? []).join() ||
      (draft.addressAllowlist ?? []).join() !== (current.addressAllowlist ?? []).join() ||
      (draft.blocklist ?? []).join() !== (current.blocklist ?? []).join(),
    [draft, current],
  );

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await gFetch("/v1/guardian/policy/simulate", {
        method: "POST",
        body: JSON.stringify({
          hitlAboveUsdc: draft.hitlAboveUsdc,
          perTxMaxUsdc: draft.perTxMaxUsdc,
          dailyMaxUsdc: draft.dailyMaxUsdc,
          maxPaysPerMinute: Number(draft.maxPaysPerMinute) || 1,
          newCounterpartyCooldownHours:
            draft.newCounterpartyCooldownHours !== undefined
              ? Number(draft.newCounterpartyCooldownHours) || 0
              : undefined,
          vendorAllowlist: draft.vendorAllowlist,
          domainAllowlist: draft.domainAllowlist,
          addressAllowlist: draft.addressAllowlist,
          blocklist: draft.blocklist,
          quietHours: draft.quietHours,
          windowHours: 24 * 7,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "simulation failed");
      setSim(d.simulation);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Simulate before you save</h2>
          <div className="sub">
            Replays last week’s real payments against your draft — no save, no money moved.
          </div>
        </div>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run()}>
          {busy ? "Replaying…" : dirty ? "Simulate my changes" : "Simulate current rules"}
        </Button>
      </div>

      {err && (
        <div className="ask-answer" style={{ borderLeftColor: "var(--red)" }}>
          {err}
        </div>
      )}

      {!sim && !err && (
        <div className="sim-explain">
          <p className="muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.7 }}>
            <b>What this does:</b> takes real payments from the last 7 days and re-judges them with
            your <em>unsaved</em> draft bands / allowlists — without saving or moving money.
          </p>
          <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0", lineHeight: 1.7 }}>
            Use it to answer: “If I raise Ask me above, how many more approvals would I get?” or
            “Would last week’s spends still settle?”
          </p>
        </div>
      )}

      {sim && (
        <>
          <div className="ask-answer" style={{ marginTop: 0 }}>
            {sim.verdict}
          </div>
          <div className="grid g-4" style={{ marginTop: 12 }}>
            <div className="ai-chip">
              <div className="k">Decisions replayed</div>
              <div className="v">{sim.sampled}</div>
              <div className="h">last 7 days</div>
            </div>
            <div className="ai-chip">
              <div className="k">Would change</div>
              <div className="v">{sim.changed.length}</div>
              <div className="h">different outcome</div>
            </div>
            <div className="ai-chip">
              <div className="k">Extra approvals</div>
              <div className="v">
                {sim.extraApprovalsPerDay > 0 ? "+" : ""}
                {sim.extraApprovalsPerDay}
              </div>
              <div className="h">interruptions per day</div>
            </div>
            <div className="ai-chip">
              <div className="k">Spend stopped</div>
              <div className="v">{fmtUsd(sim.valueNewlyBlockedUsdc)}</div>
              <div className="h">would not have settled</div>
            </div>
          </div>

          {sim.changed.length > 0 && (
            <div className="tbl-wrap" style={{ marginTop: 14 }}>
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Agent</th>
                    <th className="num">Amount</th>
                    <th>Destination</th>
                    <th>Change</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {sim.changed.map((c, i) => (
                    <tr key={i}>
                      <td className="faint mono">{relTime(c.at)}</td>
                      <td>{c.agentName}</td>
                      <td className="num mono">{fmtUsd(c.amountUsdc)}</td>
                      <td className="mono">{c.destination.replace(/^https?:\/\//, "").slice(0, 28)}</td>
                      <td>
                        <span className={`pill ${c.from === "allow" ? "ok" : c.from === "deny" ? "bad" : "warn"}`}>
                          {c.from}
                        </span>
                        <span className="faint" style={{ margin: "0 6px" }}>
                          →
                        </span>
                        <span className={`pill ${c.to === "allow" ? "ok" : c.to === "deny" ? "bad" : "warn"}`}>
                          {c.to}
                        </span>
                      </td>
                      <td className="muted wrap">{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
