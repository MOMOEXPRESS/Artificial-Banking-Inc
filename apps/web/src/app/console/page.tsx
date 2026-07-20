"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ABAppIcon, ABLockup } from "../../lib/brand";
import {
  BarChart,
  BarLine,
  Calendar,
  Donut,
  Empty,
  Icon,
  Meter,
  Sparkline,
  Stat,
  fmtDate,
  fmtTime,
  fmtUsd,
  relTime,
} from "../../lib/ui";
import { InsightsView } from "../../lib/analytics";
import { ChatView } from "../../lib/chat-view";
import { PolicyView, type Policy } from "../../lib/policy-view";
import { SettingsView } from "../../lib/settings-view";
import { MISSIONS, runMission, missionsForMode, RUN_MODES, type Mission, type RunMode, type RunStep } from "../../lib/mission";
import { PageTour } from "../../lib/page-tour";
import {
  AIPanel,
  WorkView,
  type Invoice,
  type InvoiceStats,
  type Run,
  type Summary,
} from "../../lib/views";
import { AgentsView } from "../../lib/agents-view";
import { PaymentsView } from "../../lib/payments-view";
import { TreasuryView } from "../../lib/treasury-view";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
const SELLER = process.env.NEXT_PUBLIC_SELLER_URL ?? "http://localhost:9402/report";

/* ==================================================================== types */

type AgentKey = { agentId: string; name: string; key: string };

type Session = {
  guardianKey: string;
  orgId?: string;
  agentKeys: AgentKey[];
};

type Prefs = { autoJump: boolean; sound: boolean };

type OrgView = {
  org: { id: string; name: string; status: string; settings?: Record<string, unknown> };
  actor?: { role: "owner" | "approver" | "viewer"; guardianId: string };
  agents: { id: string; name: string; status: string; spent24hUsdc: string }[];
  dailyMaxUsdc: string;
  balances: { id: string; kind: string; agentId?: string; usdc: string }[];
  vaultAddress: string;
};

type Decision = {
  intentId: string;
  outcome: string;
  ruleIds: string[];
  reasons: string[];
  tool: string;
  amountUsdc: string;
  destination: string;
  at: string;
  agentId: string;
};

type Approval = {
  id: string;
  intentId: string;
  agentId: string;
  tool: string;
  amountUsdc: string;
  destination: string;
  memo?: string;
  reasons: string[];
  status: string;
  createdAt: string;
  expiresAt: string;
  resolvedBy?: string;
};

type Escrow = {
  id: string;
  payerAgentId: string;
  payeeAgentId: string;
  amountUsdc: string;
  state: string;
  jobId?: string;
  memo?: string;
  timeoutAt: string;
};

type Webhook = { id: string; url: string; createdAt: string };
type Delivery = {
  id: number;
  event: string;
  url: string;
  status: string;
  attempts: number;
  lastError?: string;
  createdAt: string;
};
type Journal = {
  id: string;
  intentId?: string;
  memo: string;
  createdAt: string;
  lines: { accountId: string; deltaMicro: string }[];
};
type Metrics = {
  agents: number;
  decisions: Record<string, number>;
  approvals: { pending: number; total: number };
  escrows: { locked: number; total: number };
  journals: number;
  webhookDeliveries: number;
  balancesUsdc: Record<string, string>;
};
type Setup = {
  custody: string;
  network: string;
  settlement: string;
  telegram: boolean;
  rateLimitPerMin: number;
  approvalTtlMinutes: number;
  cdpApiKeyConfigured?: boolean;
  cdpWired?: boolean;
  note?: string;
};
type Recon = { ok: boolean; accountsChecked: number; journalsReplayed: number; drift: unknown[] };

type View =
  | "overview"
  | "treasury"
  | "agents"
  | "payments"
  | "playground"
  | "chat"
  | "work"
  | "approvals"
  | "insights"
  | "invoices"
  | "escrows"
  | "ledger"
  | "policy"
  | "webhooks"
  | "activity"
  | "settings";

const NAV: { key: View; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "home" },
  { key: "treasury", label: "Treasury", icon: "wallet" },
  { key: "agents", label: "Agents", icon: "robot" },
  { key: "payments", label: "Payments", icon: "zap" },
  { key: "playground", label: "Agent Playground", icon: "play" },
  { key: "chat", label: "ABI Chat", icon: "bell" },
  { key: "work", label: "Work & deliverables", icon: "book" },
  { key: "approvals", label: "Approvals", icon: "check" },
  { key: "insights", label: "Insights", icon: "spark" },
  { key: "ledger", label: "Ledger", icon: "list" },
  { key: "policy", label: "Policy", icon: "sliders" },
  { key: "webhooks", label: "Webhooks", icon: "zap" },
  { key: "activity", label: "Activity", icon: "clock" },
];

type Alert = {
  id: string;
  kind: "approval" | "escrow" | "webhook" | "drift" | "fund";
  title: string;
  body: string;
  tone: "warn" | "bad" | "info";
  goto: View;
};

type MissionState = {
  missionId: string;
  steps: RunStep[];
  log: string[];
  running: boolean;
  actorId: string;
};

/* ===================================================================== page */

export default function Console() {
  const [session, setSession] = useState<Session | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({ autoJump: true, sound: false });
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("overview");
  const [org, setOrg] = useState<OrgView | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recon, setRecon] = useState<Recon | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invStats, setInvStats] = useState<InvoiceStats | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [toast, setToastRaw] = useState<{ msg: string; kind: "ok" | "err" | "info" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(true);
  const [notifOpen, setNotifOpen] = useState(false);
  const [banner, setBanner] = useState<Alert | null>(null);
  const [query, setQuery] = useState("");

  // Mission state lives in the shell so a run survives navigating between
  // views — the agent keeps working while you go approve something.
  const [mission, setMission] = useState<MissionState>({
    missionId: MISSIONS[0].id,
    steps: [],
    log: [],
    running: false,
    actorId: "",
  });

  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const viewRef = useRef<View>(view);
  viewRef.current = view;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenApprovals = useRef<Set<string>>(new Set());
  /** Approvals already pending at sign-in are not "new" — do not hijack the view. */
  const firstApprovalLoad = useRef(true);
  /** Lives in the shell so Stop still works after navigating away and back. */
  const missionCancel = useRef(false);

  const setToast = useCallback((msg: string, kind: "ok" | "err" | "info" = "info") => {
    setToastRaw({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastRaw(null), kind === "err" ? 11000 : 6000);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("pv_session");
      if (raw) setSession(JSON.parse(raw));
      const p = localStorage.getItem("pv_prefs");
      if (p) setPrefs(JSON.parse(p));
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  /** Sign in / sign out. Resets view state — use updateSession for edits. */
  const saveSession = useCallback((s: Session | null) => {
    setSession(s);
    setLoading(true);
    // Only forget seen approvals when the identity actually changes — otherwise
    // an unrelated session edit re-raises alerts for approvals already reviewed.
    if (s?.guardianKey !== sessionRef.current?.guardianKey) {
      seenApprovals.current = new Set();
      firstApprovalLoad.current = true;
    }
    if (s) localStorage.setItem("pv_session", JSON.stringify(s));
    else localStorage.removeItem("pv_session");
  }, []);

  /**
   * Merge into the existing session without tearing the UI down. Routing agent
   * key changes through saveSession showed the loading skeleton, which
   * unmounted the view holding the one-time API key — destroying it before it
   * could be copied.
   */
  const updateSession = useCallback((patch: Partial<Session>) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      localStorage.setItem("pv_session", JSON.stringify(next));
      return next;
    });
  }, []);

  const savePrefs = useCallback((p: Prefs) => {
    setPrefs(p);
    localStorage.setItem("pv_prefs", JSON.stringify(p));
  }, []);

  const gFetch = useCallback(async (path: string, init?: RequestInit) => {
    const s = sessionRef.current;
    return fetch(`${API}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s?.guardianKey ?? ""}`,
        ...(init?.headers ?? {}),
      },
    });
  }, []);

  /**
   * Two-tier polling. The fast tier carries anything that drives reactivity —
   * a parked approval must surface within seconds. The slow tier carries
   * analytics and config, which are expensive to compute and rarely change.
   * Refetching everything every 4s was pointless load on both ends.
   */
  const refreshFast = useCallback(async () => {
    if (!sessionRef.current) return;
    try {
      const res = await Promise.all(
        ["/v1/guardian/org", "/v1/guardian/approvals", "/v1/guardian/activity", "/v1/guardian/escrows"].map(
          (p) => gFetch(p),
        ),
      );
      if (res[0].status === 401) {
        saveSession(null);
        setToast("Guardian key rejected — signed out.", "err");
        return;
      }
      const [o, ap, a, es] = await Promise.all(res.map((r) => r.json()));
      setConnected(true);
      setOrg(o);
      setApprovals(ap.approvals ?? []);
      setDecisions(a.decisions ?? []);
      setEscrows(es.escrows ?? []);
      setLoading(false);
    } catch {
      setConnected(false);
    }
  }, [gFetch, saveSession, setToast]);

  const refreshSlow = useCallback(async () => {
    if (!sessionRef.current) return;
    try {
      const res = await Promise.all(
        [
          "/v1/guardian/journals?limit=200",
          "/v1/guardian/policy",
          "/v1/guardian/webhooks",
          "/v1/guardian/webhooks/deliveries",
          "/v1/guardian/metrics",
          "/v1/guardian/setup",
          "/v1/guardian/reconcile",
          "/v1/guardian/summary",
          "/v1/guardian/invoices",
          "/v1/guardian/runs",
        ].map((p) => gFetch(p)),
      );
      const [jo, po, wh, de, me, st, rc, su, inv, rn] = await Promise.all(res.map((r) => r.json()));
      setJournals(jo.journals ?? []);
      setPolicy(po.policy ?? null);
      setWebhooks(wh.webhooks ?? []);
      setDeliveries(de.deliveries ?? []);
      setMetrics(me.metrics ?? null);
      setSetup(st.setup ?? null);
      setRecon(rc.reconciliation ?? null);
      setSummary(su.summary ?? null);
      setInvoices(inv.invoices ?? []);
      setInvStats(inv.stats ?? null);
      setRuns(rn.runs ?? []);
    } catch {
      /* the fast tier owns the connection indicator */
    }
  }, [gFetch]);

  /** After a mutation, pull both tiers so the whole console reflects it at once. */
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshFast(), refreshSlow()]);
  }, [refreshFast, refreshSlow]);

  useEffect(() => {
    if (!session) return;
    void refreshAll();
    const fast = setInterval(() => void refreshFast(), 4000);
    const slow = setInterval(() => void refreshSlow(), 15000);
    return () => {
      clearInterval(fast);
      clearInterval(slow);
    };
  }, [session, refreshAll, refreshFast, refreshSlow]);

  const pending = useMemo(() => approvals.filter((a) => a.status === "pending"), [approvals]);
  const agentName = useCallback(
    (id: string) => org?.agents.find((x) => x.id === id)?.name ?? id.slice(0, 12),
    [org],
  );

  /* ---- alerts: the system telling you what needs you, and where ---- */
  const alerts = useMemo<Alert[]>(() => {
    const out: Alert[] = [];
    for (const a of pending) {
      out.push({
        id: `apr_${a.id}`,
        kind: "approval",
        tone: "warn",
        title: `${agentName(a.agentId)} needs ${fmtUsd(a.amountUsdc)} approved`,
        body: `${a.destination} · ${a.reasons[0] ?? "awaiting your decision"} · expires ${relTime(a.expiresAt)}`,
        goto: "chat",
      });
    }
    for (const e of escrows.filter((x) => x.state === "locked")) {
      const mins = (new Date(e.timeoutAt).getTime() - Date.now()) / 60000;
      if (mins < 10) {
        out.push({
          id: `esc_${e.id}`,
          kind: "escrow",
          tone: "info",
          title: `Escrow ${fmtUsd(e.amountUsdc)} auto-refunds ${relTime(e.timeoutAt)}`,
          body: `${agentName(e.payerAgentId)} → ${agentName(e.payeeAgentId)} · release it if the work landed`,
          goto: "payments",
        });
      }
    }
    const failed = deliveries.filter((d) => d.status === "failed");
    if (failed.length) {
      out.push({
        id: "wh_failed",
        kind: "webhook",
        tone: "bad",
        title: `${failed.length} webhook ${failed.length === 1 ? "delivery" : "deliveries"} failed`,
        body: failed[0].lastError?.slice(0, 90) ?? "Endpoint unreachable after 3 attempts",
        goto: "webhooks",
      });
    }
    if (recon && !recon.ok) {
      out.push({
        id: "drift",
        kind: "drift",
        tone: "bad",
        title: "Ledger drift detected",
        body: `${recon.drift.length} account(s) disagree with the journal replay — investigate now`,
        goto: "ledger",
      });
    }
    const broke = (org?.agents ?? []).filter((ag) => {
      const bal = org?.balances.find((b) => b.kind === "agent_available" && b.agentId === ag.id);
      return Number(bal?.usdc ?? 0) < 1 && ag.status === "active";
    });
    if (broke.length) {
      out.push({
        id: "fund",
        kind: "fund",
        tone: "info",
        title: `${broke.length} agent${broke.length > 1 ? "s have" : " has"} no funds`,
        body: `${broke.map((b) => b.name).join(", ")} can't pay for anything — allocate a stipend`,
        goto: "overview",
      });
    }
    return out;
  }, [pending, escrows, deliveries, recon, org, agentName]);

  /* ---- autonomous handoff: new approval → alert + optional auto-jump ---- */
  useEffect(() => {
    if (loading) return;
    const fresh = pending.filter((a) => !seenApprovals.current.has(a.id));
    pending.forEach((a) => seenApprovals.current.add(a.id));
    // On the very first load, everything pending is pre-existing. Record it as
    // seen but do not alert — otherwise every page refresh throws you into
    // Approvals for decisions you already knew about.
    if (firstApprovalLoad.current) {
      firstApprovalLoad.current = false;
      return;
    }
    if (!fresh.length) return;
    const a = fresh[0];
    const alert: Alert = {
      id: `apr_${a.id}`,
      kind: "approval",
      tone: "warn",
      title: `${agentName(a.agentId)} is waiting on you`,
      body: `${fmtUsd(a.amountUsdc)} → ${a.destination} · ${a.reasons[0] ?? ""} · expires ${relTime(a.expiresAt)}`,
      goto: "approvals",
    };
    setBanner(alert);
    // Don't yank you off the Playground — it already shows inline Approve/Deny
    // right where you're watching the agent. Jump from anywhere else.
    if (prefsRef.current.autoJump && viewRef.current !== "approvals" && viewRef.current !== "playground" && viewRef.current !== "chat") {
      setView("chat");
      setToast(`Agent parked a ${fmtUsd(a.amountUsdc)} payment — opened ABI Chat.`, "info");
    } else if (viewRef.current === "playground") {
      setToast(`Agent parked ${fmtUsd(a.amountUsdc)} — approve or deny it right in the timeline.`, "info");
    } else if (viewRef.current === "chat") {
      setToast(`New approval in chat · ${fmtUsd(a.amountUsdc)}`, "info");
    }
  }, [pending, loading, agentName, setToast]);

  useEffect(() => {
    if (banner && !pending.some((p) => `apr_${p.id}` === banner.id)) setBanner(null);
  }, [pending, banner]);

  async function act(label: string, fn: () => Promise<string | void>) {
    setBusy(true);
    try {
      const msg = await fn();
      await refreshAll();
      if (msg) setToast(msg, "ok");
    } catch (e) {
      setToast(`${label} failed: ${e instanceof Error ? e.message : String(e)}`, "err");
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated) return null;
  if (!session)
    return <Login onLogin={saveSession} setToast={setToast} toast={toast} clear={() => setToastRaw(null)} />;

  const readOnly = org?.actor?.role === "viewer";
  const shared = { busy, act, gFetch, agentName, org, setToast, setView, readOnly };

  return (
    <div className="app">
      <nav className="rail">
        <Link href="/" className="rail-logo" title="Back to landing" style={{ textDecoration: "none" }}>
          <ABAppIcon size={38} />
        </Link>
        {NAV.map((n) => (
          <button
            key={n.key}
            className={`rail-btn ${view === n.key ? "active" : ""}`}
            onClick={() => setView(n.key)}
            aria-label={n.label}
          >
            <Icon name={n.icon} />
            {n.key === "approvals" && pending.length > 0 && <span className="dot-badge" />}
            {n.key === "chat" && pending.length > 0 && <span className="dot-badge" />}
            {n.key === "playground" && mission.running && (
              <span className="dot-badge" style={{ background: "var(--accent)" }} />
            )}
            <span className="rail-tip">
              {n.label}
              {n.key === "playground" && mission.running ? " · running" : ""}
            </span>
          </button>
        ))}
        <div className="rail-spacer" />
        <button
          className={`rail-btn ${view === "settings" ? "active" : ""}`}
          onClick={() => setView("settings")}
          aria-label="Settings"
        >
          <Icon name="gear" />
          <span className="rail-tip">Settings</span>
        </button>
        <button className="rail-btn" onClick={() => saveSession(null)} aria-label="Sign out">
          <Icon name="logout" />
          <span className="rail-tip">Sign out</span>
        </button>
      </nav>

      <main className="main">
        <header className="topbar">
          <h1>{view === "settings" ? "Settings" : NAV.find((n) => n.key === view)?.label}</h1>
          <div className="spacer" />
          <div className="search">
            <Icon name="search" />
            <input
              placeholder="Search agents, destinations…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="user-chip" onClick={() => setView("settings")}>
            <div className="avatar">{(org?.org.name ?? "PV").slice(0, 2).toUpperCase()}</div>
            <div className="who">
              <b>{org?.org.name ?? "Loading…"}</b>
              <span>
                {org?.actor?.role === "viewer"
                  ? "Viewer · read-only"
                  : org?.actor?.role === "approver"
                    ? "Approver · live"
                    : connected
                      ? "Guardian · live"
                      : "reconnecting…"}
                {org?.org.status === "frozen" ? " · FROZEN" : ""}
              </span>
            </div>
          </div>
          <div style={{ position: "relative" }}>
            <button className="icon-btn" onClick={() => setNotifOpen((v) => !v)} aria-label="Alerts">
              <Icon name="bell" />
              {alerts.length > 0 && <span className="ping" />}
            </button>
            {notifOpen && (
              <div className="notif-panel">
                <div className="notif-head">
                  <span>Needs attention ({alerts.length})</span>
                  <button className="bare sm" onClick={() => setNotifOpen(false)}>
                    <Icon name="x" size={13} />
                  </button>
                </div>
                {alerts.length === 0 ? (
                  <div style={{ padding: 26, textAlign: "center", fontSize: 12.5 }} className="muted">
                    All clear. Nothing is waiting on you.
                  </div>
                ) : (
                  alerts.slice(0, 6).map((al) => (
                    <button
                      key={al.id}
                      className="notif-item"
                      onClick={() => {
                        setView(al.goto);
                        setNotifOpen(false);
                      }}
                    >
                      <span
                        className="ico"
                        style={{
                          background:
                            al.tone === "bad" ? "var(--red-soft)" : al.tone === "warn" ? "var(--orange-soft)" : "var(--accent-soft)",
                          color: al.tone === "bad" ? "var(--red)" : al.tone === "warn" ? "var(--orange)" : "var(--accent)",
                        }}
                      >
                        <Icon name={al.kind === "approval" ? "check" : al.kind === "drift" ? "alert" : "zap"} size={15} />
                      </span>
                      <span className="body">
                        <b>{al.title}</b>
                        <span>{al.body}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </header>

        <div className="scroll">
          {banner && view !== "approvals" && (
            <div className="banner" style={{ marginBottom: 12 }}>
              <span className="ico">
                <Icon name="alert" size={16} />
              </span>
              <span className="txt">
                <b>{banner.title}</b>
                <span>{banner.body}</span>
              </span>
              <button className="light sm" onClick={() => setView(banner.goto)}>
                Review now
              </button>
              <button className="bare sm" onClick={() => setBanner(null)}>
                <Icon name="x" size={14} />
              </button>
            </div>
          )}

          {loading ? (
            <Skeleton />
          ) : (
            <div className="view" key={view}>
              <PageTour view={view === "invoices" || view === "escrows" ? "payments" : view} />
              {view === "overview" && (
                <Overview
                  {...shared}
                  metrics={metrics}
                  decisions={decisions}
                  approvals={approvals}
                  escrows={escrows}
                  policy={policy}
                  session={session}
                  updateSession={updateSession}
                  alerts={alerts}
                  summary={summary}
                  invStats={invStats}
                />
              )}
              {view === "treasury" && <TreasuryView gFetch={gFetch} busy={busy} act={act} readOnly={readOnly} />}
              {view === "agents" && (
                <AgentsView
                  gFetch={gFetch}
                  busy={busy}
                  act={act}
                  readOnly={readOnly}
                  onKeyRevealed={(entry) => {
                    updateSession({
                      agentKeys: [
                        ...session!.agentKeys.filter((k) => k.agentId !== entry.agentId),
                        entry,
                      ],
                    });
                  }}
                />
              )}
              {view === "payments" && (
                <PaymentsView
                  gFetch={gFetch}
                  busy={busy}
                  act={act}
                  readOnly={readOnly}
                  invoices={invoices}
                  invStats={invStats}
                  escrows={escrows}
                  agents={(org?.agents ?? []).map((a) => ({
                    id: a.id,
                    name: a.name,
                    status: a.status,
                  }))}
                />
              )}
              {(view === "invoices" || view === "escrows") && (
                <PaymentsView
                  gFetch={gFetch}
                  busy={busy}
                  act={act}
                  readOnly={readOnly}
                  invoices={invoices}
                  invStats={invStats}
                  escrows={escrows}
                  initialTab={view}
                  agents={(org?.agents ?? []).map((a) => ({
                    id: a.id,
                    name: a.name,
                    status: a.status,
                  }))}
                />
              )}
              {view === "playground" && (
                <Playground
                  {...shared}
                  session={session}
                  updateSession={updateSession}
                  policy={policy}
                  pending={pending}
                  mission={mission}
                  setMission={setMission}
                  cancelRef={missionCancel}
                />
              )}
              {view === "chat" && (
                <ChatView
                  gFetch={gFetch}
                  act={act}
                  busy={busy}
                  readOnly={readOnly}
                  pending={pending}
                  agentName={agentName}
                  onGoto={(v) => setView(v as View)}
                />
              )}
              {view === "work" && (
                <WorkView runs={runs} busy={busy} act={act} gFetch={gFetch} />
              )}
              {view === "insights" && (
                <InsightsView gFetch={gFetch} setView={(v) => setView(v as View)} />
              )}
{view === "approvals" && <Approvals {...shared} approvals={approvals} pending={pending} />}
{view === "ledger" && <Ledger journals={journals} metrics={metrics} recon={recon} />}
              {view === "policy" &&
                (policy ? <PolicyView {...shared} policy={policy} /> : <Skeleton />)}
              {view === "webhooks" && <Webhooks {...shared} webhooks={webhooks} deliveries={deliveries} />}
              {view === "activity" && (
                <Activity
                  decisions={decisions}
                  agentName={agentName}
                  setToast={setToast}
                  query={query}
                  gFetch={gFetch}
                />
              )}
              {view === "settings" && (
                <SettingsView
                  setup={setup}
                  recon={recon}
                  prefs={prefs}
                  savePrefs={savePrefs}
                  session={session}
                  org={org}
                  metrics={metrics}
                  agents={org?.agents ?? []}
                  busy={busy}
                  act={act}
                  gFetch={gFetch}
                  api={API}
                  sellerUrl={SELLER}
                  actorRole={org?.actor?.role ?? "owner"}
                  onGoto={(v) => setView(v as View)}
                />
              )}
            </div>
          )}
        </div>
      </main>

      {toast && (
        <div
          className={`toast ${toast.kind === "err" ? "err" : toast.kind === "ok" ? "ok" : ""}`}
          onClick={() => setToastRaw(null)}
          role="status"
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="view">
      <div className="grid g-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 104 }} />
        ))}
      </div>
      <div className="grid g-main fill">
        <div className="skeleton" style={{ minHeight: 320 }} />
        <div className="skeleton" style={{ minHeight: 320 }} />
      </div>
    </div>
  );
}

/* ==================================================================== login */

function Login({
  onLogin,
  setToast,
  toast,
  clear,
}: {
  onLogin: (s: Session) => void;
  setToast: (m: string, k?: "ok" | "err" | "info") => void;
  toast: { msg: string; kind: string } | null;
  clear: () => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    try {
      const res = await fetch(`${API}/v1/guardian/org`, {
        headers: { Authorization: `Bearer ${key.trim()}` },
      });
      if (!res.ok) throw new Error(`Key rejected (HTTP ${res.status})`);
      const data = await res.json();
      onLogin({ guardianKey: key.trim(), orgId: data.org.id, agentKeys: [] });
    } catch (e) {
      setToast(`Connect failed: ${String(e)}. Is the API running on ${API}?`, "err");
    } finally {
      setBusy(false);
    }
  }

  async function bootstrap() {
    setBusy(true);
    try {
      const res = await fetch(`${API}/v1/demo/bootstrap`, { method: "POST" });
      const d = await res.json();
      onLogin({
        guardianKey: d.guardianKey,
        orgId: d.orgId,
        agentKeys: [
          { agentId: d.researcherAgentId, name: "Researcher", key: d.agentApiKey },
          { agentId: d.writerAgentId, name: "Writer", key: d.writerApiKey },
        ],
      });
    } catch (e) {
      setToast(`Bootstrap failed: ${String(e)}. Is the API running on ${API}?`, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand" style={{ flexDirection: "column", gap: 14 }}>
          <ABLockup size={56} tone="#fff" />
        </div>
        <p className="login-sub">
          Financial infrastructure for autonomous AI. Programmable wallets, spending policies and
          human approvals — the authorization layer between your agents and real money.
        </p>
        <ul className="login-points">
          <li>
            <Icon name="shield" /> Hard budgets, allowlists and a one-tap kill switch
          </li>
          <li>
            <Icon name="check" /> Anything large parks and waits for your approval
          </li>
          <li>
            <Icon name="swap" /> Escrowed agent-to-agent hiring over real x402 payments
          </li>
        </ul>
        <div className="field">
          <label>Guardian key</label>
          <input
            placeholder="pv_guardian_…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && key.trim() && void connect()}
          />
        </div>
        <button style={{ width: "100%" }} disabled={busy || !key.trim()} onClick={() => void connect()}>
          Open console
        </button>
        <div className="or">or</div>
        <button className="ghost" style={{ width: "100%" }} disabled={busy} onClick={() => void bootstrap()}>
          Launch demo org with $100 float
        </button>
        <p className="faint" style={{ fontSize: 11.5, marginTop: 20, lineHeight: 1.6 }}>
          The demo wipes the local database and seeds a fresh org with two agents and keys loaded
          into the Playground. Not a bank. Not FDIC insured.
        </p>
      </div>
      {toast && (
        <div className={`toast ${toast.kind === "err" ? "err" : ""}`} onClick={clear}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

/* ================================================================= overview */

type Shared = {
  busy: boolean;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
  agentName: (id: string) => string;
  org: OrgView | null;
  setToast: (m: string, k?: "ok" | "err" | "info") => void;
  setView: (v: View) => void;
  readOnly: boolean;
};

function Overview({
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
  const [allocTo, setAllocTo] = useState("");
  const [allocFrom, setAllocFrom] = useState("");
  const [allocAmt, setAllocAmt] = useState("25");
  const [moveMode, setMoveMode] = useState<"allocate" | "reclaim" | "transfer">("allocate");

  const orgAvail = org?.balances.find((b) => b.kind === "org_available")?.usdc;
  const spendDecisions = decisions.filter((d) => d.outcome === "allow" && Number(d.amountUsdc) > 0);

  const cutoff =
    range === "24h" ? Date.now() - 864e5 : range === "7d" ? Date.now() - 6048e5 : 0;
  const windowed = spendDecisions.filter((d) => new Date(d.at).getTime() >= cutoff);

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
    () => [...new Set(decisions.map((d) => new Date(d.at).getDate()))],
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
   * Money can move three ways, and the form adapts: treasury → agent,
   * agent → treasury, and agent → agent (the "I funded the wrong one" fix).
   */
  const moveMoney = () =>
    act("Move funds", async () => {
      const amount = allocAmt.trim();
      if (moveMode === "allocate") {
        const res = await gFetch("/v1/guardian/allocate", {
          method: "POST",
          body: JSON.stringify({ agentId: allocTo, amountUsdc: amount }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d.error));
        return `Allocated ${fmtUsd(amount)} from treasury to ${agentName(allocTo)}.`;
      }
      if (moveMode === "reclaim") {
        const res = await gFetch("/v1/guardian/reclaim", {
          method: "POST",
          body: JSON.stringify({ agentId: allocFrom, ...(amount ? { amountUsdc: amount } : {}) }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d.error));
        return `Pulled ${fmtUsd(d.amountUsdc)} back from ${agentName(allocFrom)} to the treasury.`;
      }
      const res = await gFetch("/v1/guardian/transfer", {
        method: "POST",
        body: JSON.stringify({
          fromAgentId: allocFrom,
          toAgentId: allocTo,
          ...(amount ? { amountUsdc: amount } : {}),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d.error));
      return `Moved ${fmtUsd(d.amountUsdc)} from ${d.from} to ${d.to}.`;
    });

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
            <div className="seg">
              {(["24h", "7d", "all"] as const).map((r) => (
                <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>
                  {r === "24h" ? "24 hours" : r === "7d" ? "7 days" : "All time"}
                </button>
              ))}
            </div>
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
              <div className="sub">Each agent holds its own stipend and spends only through the vault</div>
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
              <button className="sm" disabled={busy || readOnly || !newAgent.trim()} onClick={() => void createAgent()}>
                <Icon name="plus" size={13} /> Create
              </button>
            </div>
          </div>
          {revealed && (
            <div className="code" style={{ marginBottom: 14 }}>
              <b style={{ color: "var(--text)" }}>{revealed.name}</b> API key — shown once, already
              loaded into the Playground:
              <div style={{ marginTop: 6, color: "var(--accent)" }}>{revealed.key}</div>
              <button className="ghost sm" style={{ marginTop: 9 }} onClick={() => setRevealed(null)}>
                I saved it
              </button>
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
                          <button
                            className="bare sm"
                            disabled={busy || readOnly}
                            title="Issue a new API key — the old one stops working immediately"
                            onClick={() => void rotateKey(a.id)}
                          >
                            Rotate
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div className="card-head">
            <div>
              <h2>Move funds</h2>
              <div className="sub">Treasury ↔ agents · double-entry</div>
            </div>
          </div>
          <div className="seg" style={{ marginBottom: 14 }}>
            {(
              [
                ["allocate", "Treasury → agent"],
                ["reclaim", "Agent → treasury"],
                ["transfer", "Agent → agent"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={moveMode === k ? "on" : ""} onClick={() => setMoveMode(k)}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
            {moveMode !== "allocate" && (
              <label className="field" style={{ margin: 0 }}>
                <span className="muted" style={{ fontSize: 12 }}>From agent</span>
                <select value={allocFrom} disabled={readOnly} onChange={(e) => setAllocFrom(e.target.value)}>
                  <option value="">Choose…</option>
                  {(org?.agents ?? []).map((a) => {
                    const bal = org?.balances.find(
                      (b) => b.kind === "agent_available" && b.agentId === a.id,
                    )?.usdc;
                    return (
                      <option key={a.id} value={a.id}>
                        {a.name} ({fmtUsd(bal ?? "0")})
                      </option>
                    );
                  })}
                </select>
              </label>
            )}
            {moveMode !== "reclaim" && (
              <label className="field" style={{ margin: 0 }}>
                <span className="muted" style={{ fontSize: 12 }}>To agent</span>
                <select value={allocTo} disabled={readOnly} onChange={(e) => setAllocTo(e.target.value)}>
                  <option value="">Choose…</option>
                  {(org?.agents ?? [])
                    .filter((a) => moveMode !== "transfer" || a.id !== allocFrom)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label className="field" style={{ margin: 0 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Amount USDC {moveMode !== "allocate" ? "(blank = all available)" : ""}
              </span>
              <input
                value={allocAmt}
                disabled={readOnly}
                onChange={(e) => setAllocAmt(e.target.value)}
                placeholder={moveMode === "allocate" ? "25" : "blank = all"}
                aria-label="Amount USDC"
              />
            </label>
            <button
              className="sm"
              style={{ alignSelf: "stretch" }}
              disabled={
                busy ||
                readOnly ||
                (moveMode === "allocate" && (!allocTo || !allocAmt.trim())) ||
                (moveMode === "reclaim" && !allocFrom) ||
                (moveMode === "transfer" && (!allocFrom || !allocTo))
              }
              onClick={() => void moveMoney()}
            >
              {moveMode === "allocate"
                ? "Allocate stipend"
                : moveMode === "reclaim"
                  ? "Pull back to treasury"
                  : "Transfer between agents"}
            </button>
            <p className="faint" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.55 }}>
              Org treasury has <b className="mono">{fmtUsd(orgAvail)}</b>. For department /
              shared wallets and on-chain deposit address, open <button className="bare" style={{ fontSize: 11.5 }} onClick={() => setView("treasury")}>Treasury</button>.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

/* =============================================================== playground */

function Playground({
  session,
  updateSession,
  policy,
  busy,
  act,
  gFetch,
  setView,
  setToast,
  pending,
  mission: ms,
  setMission,
  cancelRef,
  readOnly,
}: Shared & {
  session: Session;
  updateSession: (patch: Partial<Session>) => void;
  policy: Policy | null;
  pending: Approval[];
  mission: MissionState;
  setMission: React.Dispatch<React.SetStateAction<MissionState>>;
  /** Owned by the shell so Stop still works after navigating away and back. */
  cancelRef: React.MutableRefObject<boolean>;
}) {
  const [pasteKey, setPasteKey] = useState("");
  const [shownRaw, setShownRaw] = useState<Record<string, boolean>>({});
  const [runMode, setRunMode] = useState<RunMode>("once");
  const [catFilter, setCatFilter] = useState<"all" | Mission["category"]>("all");

  const { missionId, steps, log, running, actorId } = ms;
  const patch = (p: Partial<MissionState>) => setMission((m) => ({ ...m, ...p }));

  const mission = MISSIONS.find((m) => m.id === missionId) ?? MISSIONS[0];
  const actor = session.agentKeys.find((k) => k.agentId === actorId) ?? session.agentKeys[0];
  const peer = session.agentKeys.find((k) => k.agentId !== actor?.agentId);
  const visibleMissions =
    catFilter === "all" ? MISSIONS : MISSIONS.filter((m) => m.category === catFilter);

  useEffect(() => {
    if (!actorId && session.agentKeys[0]) patch({ actorId: session.agentKeys[0].agentId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.agentKeys, actorId]);

  const blockedStep = steps.find((s) => s.status === "blocked");

  async function start() {
    if (!actor) return;
    cancelRef.current = false;
    setShownRaw({});
    patch({ running: true, steps: [], log: [] });
    const queue = missionsForMode(runMode, missionId);
    try {
      for (let qi = 0; qi < queue.length; qi++) {
        if (cancelRef.current) break;
        const m = queue[qi];
        const runId = `run_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
        setMission((prev) => ({
          ...prev,
          missionId: m.id,
          log: [
            ...prev.log,
            `${new Date().toLocaleTimeString([], { hour12: false })}  ▶ ${m.title} (${qi + 1}/${queue.length})`,
          ],
        }));
        await runMission(m, {
          api: API,
          agentKey: actor.key,
          guardianKey: session.guardianKey,
          agentId: actor.agentId,
          agentName: actor.name,
          runId,
          payeeAgentId: peer?.agentId,
          sellerUrl: SELLER,
          emit: (steps) => setMission((prev) => ({ ...prev, steps })),
          log: (line) =>
            setMission((prev) => ({
              ...prev,
              log: [...prev.log, `${new Date().toLocaleTimeString([], { hour12: false })}  ${line}`],
            })),
          onBlocked: () => {
            /* the shell's approval watcher raises the alert + banner */
          },
          onUnblocked: (_s, outcome) =>
            setToast(
              outcome === "approved"
                ? "Approved — the agent picked straight back up."
                : `Agent was told: ${outcome}. It is replanning without that spend.`,
              outcome === "approved" ? "ok" : "info",
            ),
          cancelled: () => cancelRef.current,
        });
      }
    } finally {
      setMission((m) => ({ ...m, running: false }));
    }
  }

  const addKey = () =>
    act("Add key", async () => {
      const res = await fetch(`${API}/v1/agent/budget`, {
        headers: { Authorization: `Bearer ${pasteKey.trim()}` },
      });
      if (!res.ok) throw new Error("That agent key was rejected by the API");
      updateSession({
        agentKeys: [
          ...session.agentKeys,
          { agentId: `manual_${session.agentKeys.length}`, name: "Pasted agent", key: pasteKey.trim() },
        ],
      });
      setPasteKey("");
      return "Agent key added to the Playground.";
    });

  const resolveInline = (approvalId: string, approve: boolean) =>
    act("Approval", async () => {
      const res = await gFetch(`/v1/guardian/approvals/${approvalId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ approve, resolvedBy: "playground" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(d.error ?? d));
      return approve ? "Approved — watch the agent continue." : "Denied — the agent will replan.";
    });

  const done = steps.filter((s) => s.status === "done").length;

  return (
    <>
      <div className="banner info">
        <span className="ico">
          <Icon name="robot" size={16} />
        </span>
        <span className="txt">
          <b>Test it yourself — no coding required</b>
          <span>
            Pick a mission, hit Run, and watch a real agent spend real balances through the real
            policy engine. Every call below is the same API your production agents would use.
          </span>
        </span>
      </div>

      <div className="grid g-main fill">
        <div className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="card-head">
            <div>
              <h2>{running ? "Mission running" : "Mission timeline"}</h2>
              <div className="sub">
                {steps.length
                  ? `${done}/${steps.length} steps complete${blockedStep ? " · parked for your decision" : ""}`
                  : "Select a mission and press Run to begin"}
              </div>
            </div>
            <div className="row">
              {running ? (
                <button
                  className="danger sm"
                  onClick={() => {
                    cancelRef.current = true;
                    setToast("Mission cancelled.", "info");
                  }}
                >
                  Stop
                </button>
              ) : (
                <button className="sm" disabled={!actor || busy || readOnly} onClick={() => void start()}>
                  <Icon name="play" size={13} /> Run mission
                </button>
              )}
            </div>
          </div>

          {blockedStep?.approvalId && (
            <div className="banner" style={{ marginBottom: 14 }}>
              <span className="ico">
                <Icon name="clock" size={16} />
              </span>
              <span className="txt">
                <b>The agent is blocked, waiting on you</b>
                <span>
                  It cannot continue until you decide. Approve or deny right here — or open the
                  Approvals screen.
                </span>
              </span>
              <button className="light sm" disabled={busy || readOnly} onClick={() => void resolveInline(blockedStep.approvalId!, true)}>
                Approve
              </button>
              <button className="danger sm" disabled={busy || readOnly} onClick={() => void resolveInline(blockedStep.approvalId!, false)}>
                Deny
              </button>
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto", minHeight: 260 }}>
            {steps.length === 0 ? (
              <Empty icon="play">
                Nothing running. Pick a mission on the right — <b>{mission.title}</b> is selected.
              </Empty>
            ) : (
              <div className="steps">
                {steps.map((s, i) => (
                  <div
                    key={s.id + i}
                    className={`step ${
                      s.status === "done"
                        ? "done"
                        : s.status === "running"
                          ? "run"
                          : s.status === "blocked"
                            ? "block"
                            : s.status === "failed"
                              ? "fail"
                              : ""
                    }`}
                  >
                    <div className="bullet">
                      {s.status === "running" ? (
                        <span className="spinner" />
                      ) : s.status === "done" ? (
                        <Icon name="check" size={13} />
                      ) : s.status === "blocked" ? (
                        <Icon name="clock" size={13} />
                      ) : s.status === "failed" ? (
                        <Icon name="x" size={13} />
                      ) : (
                        i + 1
                      )}
                    </div>
                    <div className="sbody">
                      <b>{s.title}</b>
                      {s.status === "running" ? (
                        <div className="thinking">
                          <span className="bar" /> {s.detail}
                        </div>
                      ) : s.summary ? (
                        <p className="sum">{s.summary}</p>
                      ) : (
                        <p>{s.detail}</p>
                      )}
                      {s.output && (
                        <>
                          <button
                            className="step-toggle"
                            onClick={() =>
                              setShownRaw((r) => ({ ...r, [s.id + i]: !r[s.id + i] }))
                            }
                          >
                            {shownRaw[s.id + i] ? "▾ hide raw response" : "▸ raw response"}
                          </button>
                          {shownRaw[s.id + i] && <div className="out">{s.output}</div>}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {steps.length > 0 && !running && (
            <>
              <div className="divider" />
              <div className="between">
                <span className="faint" style={{ fontSize: 11.5 }}>
                  Run archived — the deliverable and full step history are in Work &amp; deliverables.
                </span>
                <button className="ghost sm" onClick={() => setView("work")}>
                  Open deliverable <Icon name="arrowRight" size={12} />
                </button>
              </div>
            </>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Choose a mission</h2>
                <div className="sub">{mission.persona}</div>
              </div>
            </div>
            <div className="seg" style={{ marginBottom: 12, flexWrap: "wrap" }}>
              {(
                [
                  ["all", "All"],
                  ["commerce", "Commerce"],
                  ["governance", "Governance"],
                  ["security", "Security"],
                  ["ops", "Ops"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  className={catFilter === k ? "on" : ""}
                  disabled={running}
                  onClick={() => setCatFilter(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {visibleMissions.map((m) => (
                <button
                  key={m.id}
                  className={`mission-card ${m.id === missionId ? "sel" : ""}`}
                  onClick={() => patch({ missionId: m.id })}
                  disabled={running}
                >
                  <b>{m.title}</b>
                  <p>
                    <span className="faint" style={{ display: "block", marginBottom: 4 }}>
                      {m.persona} · {m.category}
                    </span>
                    {m.brief}
                  </p>
                </button>
              ))}
            </div>
            <div className="divider" />
            <div className="card-head" style={{ padding: 0, marginBottom: 8 }}>
              <h2 style={{ fontSize: 14 }}>How to run it</h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {RUN_MODES.map((mode) => (
                <button
                  key={mode.id}
                  className={`mission-card ${runMode === mode.id ? "sel" : ""}`}
                  disabled={running}
                  onClick={() => setRunMode(mode.id)}
                >
                  <b>{mode.label}</b>
                  <p>{mode.detail}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Run as</h2>
            </div>
            {session.agentKeys.length === 0 ? (
              <>
                <p className="muted" style={{ fontSize: 12.5, marginTop: 0, lineHeight: 1.6 }}>
                  No agent keys stored yet. Create an agent on the Overview screen — its key is
                  saved here automatically — or paste one below.
                </p>
                <div className="row">
                  <input
                    placeholder="pv_agent_…"
                    value={pasteKey}
                    onChange={(e) => setPasteKey(e.target.value)}
                  />
                  <button className="ghost sm" disabled={!pasteKey.trim() || busy || readOnly} onClick={() => void addKey()}>
                    Add
                  </button>
                </div>
              </>
            ) : (
              <>
                <select
                  value={actorId}
                  onChange={(e) => patch({ actorId: e.target.value })}
                  disabled={running}
                >
                  {session.agentKeys.map((k) => (
                    <option key={k.agentId} value={k.agentId}>
                      {k.name} · {k.key.slice(0, 16)}…
                    </option>
                  ))}
                </select>
                <div className="divider" />
                <div className="between" style={{ fontSize: 12.5 }}>
                  <span className="muted">Approval threshold</span>
                  <b className="mono">{fmtUsd(policy?.hitlAboveUsdc)}</b>
                </div>
                <div className="between" style={{ fontSize: 12.5, marginTop: 8 }}>
                  <span className="muted">Per-payment ceiling</span>
                  <b className="mono">{fmtUsd(policy?.perTxMaxUsdc)}</b>
                </div>
                <div className="between" style={{ fontSize: 12.5, marginTop: 8 }}>
                  <span className="muted">Peer for escrow</span>
                  <b>{peer ? peer.name : "none"}</b>
                </div>
                <div className="divider" />
                <p className="faint" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.6 }}>
                  Tip: run <b>Large purchase</b> to watch the agent park and wait for you, then
                  approve it and see it resume by itself.
                </p>
              </>
            )}
          </div>

          <div className="card" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div className="card-head">
              <h2>Agent log</h2>
              {pending.length > 0 && (
                <button className="ghost sm" onClick={() => setView("approvals")}>
                  {pending.length} pending <Icon name="arrowRight" size={12} />
                </button>
              )}
            </div>
            <div
              className="code"
              style={{ flex: 1, overflowY: "auto", minHeight: 110, whiteSpace: "pre-wrap" }}
            >
              {log.length ? log.join("\n") : "Waiting for the agent to say something…"}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ================================================================ approvals */

function Approvals({
  approvals,
  pending,
  busy,
  act,
  gFetch,
  agentName,
  readOnly,
}: Shared & { approvals: Approval[]; pending: Approval[] }) {
  const resolve = (id: string, approve: boolean) =>
    act("Approval", async () => {
      const res = await gFetch(`/v1/guardian/approvals/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ approve, resolvedBy: "guardian-web" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(d.error ?? d));
      return approve
        ? "Approved — the payment executed and the agent was told to continue."
        : "Denied — the agent has been told to replan.";
    });

  const history = approvals.filter((a) => a.status !== "pending");
  const approved = history.filter((h) => h.status === "approved").length;

  return (
    <>
      <div className="grid g-4">
        <Stat label="Waiting on you" value={String(pending.length)} foot="agents parked right now" />
        <Stat label="Approved" value={String(approved)} foot="you let these through" />
        <Stat
          label="Denied or expired"
          value={String(history.length - approved)}
          foot="agents replanned without the spend"
        />
        <Stat
          label="Total value held"
          value={fmtUsd(pending.reduce((a, p) => a + Number(p.amountUsdc), 0))}
          foot="frozen until you decide"
        />
      </div>

      <div className="card fill" style={{ display: "flex", flexDirection: "column" }}>
        <div className="card-head">
          <div>
            <h2>Pending decisions</h2>
            <div className="sub">
              Agents are blocked here. Approving runs the payment immediately; denying makes them replan.
            </div>
          </div>
        </div>
        {pending.length === 0 ? (
          <Empty icon="shield">
            Inbox zero — nothing is waiting on you. Anything above your approval threshold will
            appear here and alert you automatically.
          </Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pending.map((a) => (
              <div
                key={a.id}
                className="card tight"
                style={{ background: "var(--surface-3)", borderColor: "rgba(251,146,60,0.28)" }}
              >
                <div className="between" style={{ flexWrap: "wrap", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8, marginBottom: 5 }}>
                      <b style={{ fontSize: 15.5 }}>{fmtUsd(a.amountUsdc)}</b>
                      <span className="pill warn">
                        <i /> {a.tool}
                      </span>
                      <span className="pill mute">expires {relTime(a.expiresAt)}</span>
                    </div>
                    <div style={{ fontSize: 12.5 }} className="muted">
                      <b style={{ color: "var(--text-2)" }}>{agentName(a.agentId)}</b> wants to pay{" "}
                      <span className="mono">{a.destination}</span>
                      {a.memo ? ` — “${a.memo}”` : ""}
                    </div>
                    <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
                      Held because: {a.reasons.join("; ")}
                    </div>
                  </div>
                  <div className="row" style={{ flexWrap: "nowrap" }}>
                    <button disabled={busy} onClick={() => void resolve(a.id, true)}>
                      Approve payment
                    </button>
                    <button className="danger" disabled={busy} onClick={() => void resolve(a.id, false)}>
                      Deny
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="divider" />
        <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>History</h2>
        {history.length === 0 ? (
          <div className="muted" style={{ fontSize: 12.5 }}>
            No resolved approvals yet.
          </div>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th className="num">Amount</th>
                  <th>Destination</th>
                  <th>Outcome</th>
                  <th>Decided by</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {history.map((a) => (
                  <tr key={a.id}>
                    <td>{agentName(a.agentId)}</td>
                    <td className="num mono">{fmtUsd(a.amountUsdc)}</td>
                    <td className="mono">{a.destination}</td>
                    <td>
                      <span
                        className={`pill ${
                          a.status === "approved" ? "ok" : a.status === "expired" ? "warn" : "bad"
                        }`}
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="muted">{a.resolvedBy ?? "—"}</td>
                    <td className="mono faint">{relTime(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* =================================================================== ledger */

function Ledger({
  journals,
  metrics,
  recon,
}: {
  journals: Journal[];
  metrics: Metrics | null;
  recon: Recon | null;
}) {
  const short = (id: string) =>
    id.replace(/^org:[^:]+:/, "treasury ").replace(/^agent:/, "").replace(/^escrow:/, "escrow ");
  const delta = (m: string) => {
    const n = Number(m) / 1e6;
    return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
  };

  return (
    <>
      <div className="grid g-4">
        <Stat label="Journal entries" value={String(metrics?.journals ?? 0)} foot="every balanced movement" />
        <Stat label="In escrow" value={fmtUsd(metrics?.balancesUsdc?.escrow ?? "0")} foot="locked between agents" />
        <Stat label="In flight" value={fmtUsd(metrics?.balancesUsdc?.agentHeld ?? "0")} foot="held mid-payment" />
        <Stat
          label="Reconciliation"
          value={recon?.ok ? "Clean" : "DRIFT"}
          foot={`${recon?.journalsReplayed ?? 0} entries replayed · ${recon?.accountsChecked ?? 0} accounts`}
          delta={recon?.ok ? { dir: "up", text: "0 drift" } : { dir: "down", text: `${recon?.drift.length} bad` }}
        />
      </div>

      <div className="card fill" style={{ display: "flex", flexDirection: "column" }}>
        <div className="card-head">
          <div>
            <h2>Double-entry journal</h2>
            <div className="sub">
              The source of truth. Every entry sums to zero; a watchdog replays all of them each
              minute and screams if a cent is off.
            </div>
          </div>
        </div>
        {journals.length === 0 ? (
          <Empty icon="book">No entries yet.</Empty>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Entry</th>
                  <th>Movements</th>
                </tr>
              </thead>
              <tbody>
                {journals.map((j) => (
                  <tr key={j.id}>
                    <td className="mono faint">{fmtTime(j.createdAt)}</td>
                    <td>
                      <span className="pill mute">{j.memo}</span>
                    </td>
                    <td className="wrap">
                      {j.lines.map((l, i) => (
                        <span key={i} className="mono" style={{ marginRight: 16, whiteSpace: "nowrap" }}>
                          <span className="muted">{short(l.accountId)}</span>{" "}
                          <b style={{ color: Number(l.deltaMicro) >= 0 ? "var(--green)" : "var(--red)" }}>
                            {delta(l.deltaMicro)}
                          </b>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* =================================================================== policy */

/* ================================================================= webhooks */

function Webhooks({
  webhooks,
  deliveries,
  busy,
  act,
  gFetch,
  readOnly,
}: Shared & { webhooks: Webhook[]; deliveries: Delivery[] }) {
  const locked = busy || readOnly;
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);

  const add = () =>
    act("Webhook", async () => {
      const res = await gFetch("/v1/guardian/webhooks", {
        method: "POST",
        body: JSON.stringify({ url: url.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
      setSecret(d.secret);
      setUrl("");
      return "Endpoint registered — signing secret shown once below.";
    });

  const del = (id: string) =>
    act("Delete", async () => {
      await gFetch(`/v1/guardian/webhooks/${id}`, { method: "DELETE" });
      return "Endpoint removed.";
    });

  const test = (id: string) =>
    act("Test", async () => {
      const res = await gFetch(`/v1/guardian/webhooks/${id}/test`, { method: "POST" });
      if (!res.ok) throw new Error(JSON.stringify(await res.json()));
      return "Test event dispatched — watch the delivery table below.";
    });

  const rotate = (id: string) =>
    act("Rotate secret", async () => {
      const res = await gFetch(`/v1/guardian/webhooks/${id}/rotate`, { method: "POST", body: "{}" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
      setSecret(d.secret);
      return "Webhook signing secret rotated — shown once below.";
    });

  const ok = deliveries.filter((d) => d.status === "delivered").length;
  const rate = deliveries.length ? Math.round((ok / deliveries.length) * 100) : 100;

  return (
    <>
      <div className="grid g-4">
        <Stat label="Endpoints" value={String(webhooks.length)} foot="receiving money events" />
        <Stat label="Deliveries" value={String(deliveries.length)} foot="signed and retried 3×" />
        <Stat label="Success rate" value={`${rate}%`} foot={`${ok} delivered`} delta={{ dir: rate === 100 ? "up" : "down", text: `${rate}%` }} />
        <Stat
          label="Failed"
          value={String(deliveries.filter((d) => d.status === "failed").length)}
          foot="gave up after 3 attempts"
        />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Endpoints</h2>
            <div className="sub">
              Every payment, denial, approval and escrow event POSTs here — HMAC-SHA256 signed.
            </div>
          </div>
          <div className="row">
            <input
              style={{ width: 300 }}
              placeholder="https://your-server/policyvault-hook"
              value={url}
              disabled={readOnly}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && url.trim() && void add()}
            />
            <button className="sm" disabled={locked || !url.trim()} onClick={() => void add()}>
              <Icon name="plus" size={13} /> Add
            </button>
          </div>
        </div>
        {secret && (
          <div className="code" style={{ marginBottom: 14 }}>
            Signing secret (shown once) — verify <b style={{ color: "var(--text)" }}>x-policyvault-signature</b> with it:
            <div style={{ marginTop: 6, color: "var(--accent)" }}>{secret}</div>
            <button className="ghost sm" style={{ marginTop: 9 }} onClick={() => setSecret(null)}>
              I saved it
            </button>
          </div>
        )}
        {webhooks.length === 0 ? (
          <Empty icon="zap">
            No endpoints yet. Add one to stream every money event into your own systems.
          </Empty>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Added</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {webhooks.map((w) => (
                  <tr key={w.id}>
                    <td className="mono">{w.url}</td>
                    <td className="faint mono">{relTime(w.createdAt)}</td>
                    <td>
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        <button className="ghost sm" disabled={locked} onClick={() => void test(w.id)}>
                          Send test
                        </button>
                        <button className="ghost sm" disabled={locked} onClick={() => void rotate(w.id)}>
                          Rotate secret
                        </button>
                        <button className="danger sm" disabled={locked} onClick={() => void del(w.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card fill" style={{ display: "flex", flexDirection: "column" }}>
        <div className="card-head">
          <h2>Delivery log</h2>
        </div>
        {deliveries.length === 0 ? (
          <Empty icon="inbox">No deliveries yet.</Empty>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Status</th>
                  <th className="num">Attempts</th>
                  <th>Error</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="mono">{d.event}</td>
                    <td>
                      <span
                        className={`pill ${
                          d.status === "delivered" ? "ok" : d.status === "pending" ? "warn" : "bad"
                        }`}
                      >
                        <i /> {d.status}
                      </span>
                    </td>
                    <td className="num mono">{d.attempts}</td>
                    <td className="muted wrap">{d.lastError ?? "—"}</td>
                    <td className="faint mono">{relTime(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ================================================================= activity */

function Activity({
  decisions,
  agentName,
  setToast,
  query,
  gFetch,
}: {
  decisions: Decision[];
  agentName: (id: string) => string;
  setToast: (m: string, k?: "ok" | "err" | "info") => void;
  query: string;
  gFetch: (path: string, init?: RequestInit) => Promise<Response>;
}) {
  const [filter, setFilter] = useState<"all" | "allow" | "deny" | "review">("all");
  const [agentF, setAgentF] = useState("all");
  const [toolF, setToolF] = useState("all");
  const [destF, setDestF] = useState("all");

  // Facet options come from the data itself, so they always match what exists.
  const agentOpts = useMemo(
    () => [...new Set(decisions.map((d) => d.agentId))].map((id) => ({ id, name: agentName(id) })),
    [decisions, agentName],
  );
  const toolOpts = useMemo(() => [...new Set(decisions.map((d) => d.tool))], [decisions]);
  const destOpts = useMemo(
    () => [...new Set(decisions.map((d) => d.destination.replace(/^https?:\/\//, "").split("/")[0]))],
    [decisions],
  );

  const rows = useMemo(
    () =>
      decisions.filter((d) => {
        const dest = d.destination.replace(/^https?:\/\//, "").split("/")[0];
        return (
          (filter === "all" || d.outcome === filter) &&
          (agentF === "all" || d.agentId === agentF) &&
          (toolF === "all" || d.tool === toolF) &&
          (destF === "all" || dest === destF) &&
          (!query ||
            d.destination.toLowerCase().includes(query.toLowerCase()) ||
            agentName(d.agentId).toLowerCase().includes(query.toLowerCase()) ||
            d.ruleIds.join(" ").toLowerCase().includes(query.toLowerCase()))
        );
      }),
    [decisions, filter, agentF, toolF, destF, query, agentName],
  );

  const shownTotal = rows
    .filter((d) => d.outcome === "allow")
    .reduce((a, d) => a + Number(d.amountUsdc), 0);
  const filtersActive = filter !== "all" || agentF !== "all" || toolF !== "all" || destF !== "all";

  const counts = {
    allow: decisions.filter((d) => d.outcome === "allow").length,
    deny: decisions.filter((d) => d.outcome === "deny").length,
    review: decisions.filter((d) => d.outcome === "review").length,
  };

  async function exportCsv() {
    try {
      const res = await gFetch("/v1/guardian/audit/export?limit=2000", {
        headers: { Accept: "text/csv" },
      });
      if (!res.ok) throw new Error("export failed");
      const text = await res.text();
      const blob = new Blob([text], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `abi-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      setToast("Exported server audit CSV (decisions + freezes).", "ok");
    } catch {
      // Fallback to filtered client CSV if the server export is unavailable.
      const head = "time,agent,outcome,tool,amount_usdc,destination,rules,reasons";
      const body = rows.map((d) =>
        [
          d.at,
          agentName(d.agentId),
          d.outcome,
          d.tool,
          d.amountUsdc,
          d.destination,
          d.ruleIds.join("|"),
          `"${d.reasons.join("; ").replace(/"/g, '""')}"`,
        ].join(","),
      );
      const blob = new Blob([[head, ...body].join("\n")], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `policyvault-activity-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      setToast(`Exported ${rows.length} filtered decisions (client fallback).`, "ok");
    }
  }

  return (
    <>
      <div className="grid g-4">
        <Stat label="Total decisions" value={String(decisions.length)} foot="every intent, ever" />
        <Stat label="Allowed" value={String(counts.allow)} foot="settled under policy" />
        <Stat label="Denied" value={String(counts.deny)} foot="refused by a rule" />
        <Stat label="Sent for review" value={String(counts.review)} foot="escalated to you" />
      </div>

      <div className="card fill" style={{ display: "flex", flexDirection: "column" }}>
        <div className="card-head">
          <div>
            <h2>Decision trail</h2>
            <div className="sub">
              {rows.length} of {decisions.length} shown · {fmtUsd(shownTotal)} settled in this view
              {query ? ` · matching “${query}”` : ""}
            </div>
          </div>
          <div className="row">
            <div className="seg">
              {(["all", "allow", "review", "deny"] as const).map((k) => (
                <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
                  {k}
                </button>
              ))}
            </div>
            <button className="ghost sm" onClick={() => void exportCsv()} disabled={!decisions.length}>
              <Icon name="download" size={13} /> CSV
            </button>
          </div>
        </div>

        <div className="row" style={{ marginBottom: 14, gap: 8 }}>
          <select style={{ width: 170 }} value={agentF} onChange={(e) => setAgentF(e.target.value)}>
            <option value="all">All agents</option>
            {agentOpts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select style={{ width: 170 }} value={toolF} onChange={(e) => setToolF(e.target.value)}>
            <option value="all">All tools</option>
            {toolOpts.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select style={{ width: 210 }} value={destF} onChange={(e) => setDestF(e.target.value)}>
            <option value="all">All destinations</option>
            {destOpts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          {filtersActive && (
            <button
              className="bare sm"
              onClick={() => {
                setFilter("all");
                setAgentF("all");
                setToolF("all");
                setDestF("all");
              }}
            >
              <Icon name="x" size={12} /> Clear filters
            </button>
          )}
        </div>
        {rows.length === 0 ? (
          <Empty icon="list">Nothing matches. Run a mission in the Playground to generate activity.</Empty>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Agent</th>
                  <th>Outcome</th>
                  <th>Tool</th>
                  <th className="num">Amount</th>
                  <th>Destination</th>
                  <th>Rule fired</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.intentId + d.at}>
                    <td className="mono faint">{fmtTime(d.at)}</td>
                    <td>{agentName(d.agentId)}</td>
                    <td>
                      <span
                        className={`pill ${
                          d.outcome === "allow" ? "ok" : d.outcome === "deny" ? "bad" : "warn"
                        }`}
                      >
                        <i /> {d.outcome}
                      </span>
                    </td>
                    <td className="mono">{d.tool}</td>
                    <td className="num mono">{fmtUsd(d.amountUsdc)}</td>
                    <td className="mono">{d.destination.replace(/^https?:\/\//, "")}</td>
                    <td className="mono faint">{d.ruleIds.join(", ")}</td>
                    <td className="muted wrap">{d.reasons[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

