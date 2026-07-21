"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ABAppIcon } from "../../lib/brand";
import { Icon, fmtUsd, relTime } from "../../lib/ui";
import { InsightsView } from "../../lib/analytics";
import { ChatView } from "../../lib/chat-view";
import { PolicyView, type Policy } from "../../lib/policy-view";
import { SettingsView } from "../../lib/settings-view";
import { MISSIONS } from "../../lib/mission";
import { PageTour } from "../../lib/page-tour";
import { WorkView, type Invoice, type InvoiceStats, type Run, type Summary } from "../../lib/views";
import { AgentsView } from "../../lib/agents-view";
import { PaymentsView } from "../../lib/payments-view";
import { TreasuryView } from "../../lib/treasury-view";
import {
  KeyboardHelp,
  useConsoleShortcuts,
  useKeyboardHelp,
  type ShortcutView,
} from "../../lib/keyboard-shortcuts";
import { ConsoleCommandPalette } from "../../lib/command-palette";
import { toast } from "../../lib/toast";
import { useTheme } from "../../lib/theme-provider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sidebar, SidebarGroup, SidebarItem } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConsoleSkeleton } from "@/components/ui/skeleton";
import type {
  Approval,
  Decision,
  Delivery,
  Escrow,
  Journal,
  Metrics,
  OrgView,
  Prefs,
  Recon,
  Session,
  Setup,
  View,
  Webhook,
  Alert as ConsoleAlert,
} from "../../lib/console-types";
import type { MissionState } from "../../lib/playground-view";
import { Login } from "../../lib/login-view";
import { Overview } from "../../lib/overview-view";
import { Playground } from "../../lib/playground-view";
import { Approvals } from "../../lib/approvals-view";
import { Ledger } from "../../lib/ledger-view";
import { Webhooks } from "../../lib/webhooks-view";
import { Activity } from "../../lib/activity-view";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/abi-api";
const SELLER = process.env.NEXT_PUBLIC_SELLER_URL ?? "http://localhost:9402/report";

const NAV: { key: View; label: string; icon: string; group: string }[] = [
  { key: "overview", label: "Overview", icon: "home", group: "Money" },
  { key: "treasury", label: "Treasury", icon: "wallet", group: "Money" },
  { key: "payments", label: "Payments", icon: "zap", group: "Money" },
  { key: "approvals", label: "Approvals", icon: "check", group: "Money" },
  { key: "agents", label: "Agents", icon: "robot", group: "Agents" },
  { key: "playground", label: "Agent Playground", icon: "play", group: "Agents" },
  { key: "chat", label: "ABI Chat", icon: "bell", group: "Agents" },
  { key: "work", label: "Work & deliverables", icon: "book", group: "Agents" },
  { key: "ledger", label: "Ledger", icon: "list", group: "Records" },
  { key: "insights", label: "Insights", icon: "spark", group: "Records" },
  { key: "activity", label: "Activity", icon: "clock", group: "Records" },
  { key: "policy", label: "Policy", icon: "sliders", group: "Config" },
  { key: "webhooks", label: "Webhooks", icon: "zap", group: "Config" },
];

const NAV_GROUPS = ["Money", "Agents", "Records", "Config"] as const;

function navGroupOf(view: View): string {
  if (view === "settings") return "Config";
  return NAV.find((n) => n.key === view)?.group ?? "Console";
}

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
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(true);
  const [notifOpen, setNotifOpen] = useState(false);
  const [banner, setBanner] = useState<ConsoleAlert | null>(null);
  const [query, setQuery] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navContext, setNavContext] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const help = useKeyboardHelp();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const theme = useTheme();

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
  const seenApprovals = useRef<Set<string>>(new Set());
  /** Approvals already pending at sign-in are not "new" — do not hijack the view. */
  const firstApprovalLoad = useRef(true);
  /** Lives in the shell so Stop still works after navigating away and back. */
  const missionCancel = useRef(false);

  const setToast = useCallback((msg: string, kind: "ok" | "err" | "info" = "info") => {
    toast(msg, kind);
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
  const alerts = useMemo<ConsoleAlert[]>(() => {
    const out: ConsoleAlert[] = [];
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
    const alert: ConsoleAlert = {
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

  const goView = useCallback((v: ShortcutView) => {
    setView(v as View);
    if (v !== "agents") setNavContext(null);
  }, []);

  useConsoleShortcuts({
    enabled: hydrated && Boolean(session),
    onGo: goView,
    onOpenPalette: () => setPaletteOpen(true),
    onToggleHelp: help.toggle,
  });

  if (!hydrated) return null;
  if (!session)
    return <Login onLogin={saveSession} setToast={setToast} />;

  const readOnly = org?.actor?.role === "viewer";
  const shared = { busy, act, gFetch, agentName, org, setToast, setView, readOnly };
  const viewLabel = view === "settings" ? "Settings" : NAV.find((n) => n.key === view)?.label ?? view;
  const groupLabel = navGroupOf(view);

  return (
    <TooltipProvider delayDuration={250}>
    <div className={`app ${railOpen ? "rail-open" : ""}`}>
      <button
        type="button"
        className="rail-burger"
        aria-label={railOpen ? "Close navigation" : "Open navigation"}
        onClick={() => setRailOpen((v) => !v)}
      >
        <Icon name="list" />
      </button>
      {railOpen && <button type="button" className="rail-scrim" aria-label="Close navigation" onClick={() => setRailOpen(false)} />}
      <Sidebar className="rail" label="Console navigation">
        <Link href="/" className="rail-logo" title="Back to landing" style={{ textDecoration: "none" }}>
          <ABAppIcon size={38} />
        </Link>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group} title={group}>
            {NAV.filter((n) => n.group === group).map((n) => (
              <Tooltip key={n.key}>
                <TooltipTrigger asChild>
                  <SidebarItem
                    active={view === n.key}
                    label={n.label}
                    onClick={() => {
                      setView(n.key);
                      if (n.key !== "agents") setNavContext(null);
                      setRailOpen(false);
                    }}
                  >
                    <Icon name={n.icon} />
                    {n.key === "approvals" && pending.length > 0 && <span className="dot-badge" />}
                    {n.key === "chat" && pending.length > 0 && <span className="dot-badge" />}
                    {n.key === "playground" && mission.running && (
                      <span className="dot-badge" style={{ background: "var(--accent)" }} />
                    )}
                  </SidebarItem>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {n.label}
                  {n.key === "playground" && mission.running ? " · running" : ""}
                </TooltipContent>
              </Tooltip>
            ))}
          </SidebarGroup>
        ))}
        <div className="rail-spacer" />
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarItem
              active={view === "settings"}
              label="Settings"
              onClick={() => setView("settings")}
            >
              <Icon name="gear" />
            </SidebarItem>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      </Sidebar>

      <main className="main">
        <header className="topbar">
          <div className="topbar-title-block">
            <nav className="crumb" aria-label="Breadcrumb">
              <span className="crumb-group">{groupLabel}</span>
              <span className="crumb-sep" aria-hidden>
                /
              </span>
              <span className="crumb-current">{viewLabel}</span>
              {navContext ? (
                <>
                  <span className="crumb-sep" aria-hidden>
                    /
                  </span>
                  <span className="crumb-drill">{navContext}</span>
                </>
              ) : null}
            </nav>
            <h1>{viewLabel}</h1>
          </div>
          <div className="spacer" />
          <button
            type="button"
            className="search search-btn"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette"
          >
            <Icon name="search" />
            <span className="search-placeholder">
              {query || "Search agents, destinations…"}
            </span>
            <kbd className="search-kbd">⌘K</kbd>
          </button>
          <input
            ref={searchRef}
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="user-chip" aria-label="Account menu">
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
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{org?.org.name ?? "Organization"}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setView("settings")}>Settings</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPaletteOpen(true)}>Command palette</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => help.setOpen(true)}>Keyboard shortcuts</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => theme.toggle()}>
                Theme: {theme.resolved === "dark" ? "Dark" : "Light"} (toggle)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => saveSession(null)}>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Popover open={notifOpen} onOpenChange={setNotifOpen}>
            <PopoverTrigger asChild>
              <button className="icon-btn" aria-label="Alerts">
                <Icon name="bell" />
                {alerts.length > 0 && <span className="ping" />}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(360px,calc(100vw-24px))] p-0">
              <div className="notif-head">
                <span>Needs attention ({alerts.length})</span>
                {alerts.length > 0 && (
                  <button type="button" className="bare sm" onClick={() => setNotifOpen(false)}>
                    Mark reviewed
                  </button>
                )}
              </div>
              <ScrollArea className="max-h-80">
                {alerts.length === 0 ? (
                  <div style={{ padding: 26, textAlign: "center", fontSize: 12.5 }} className="muted">
                    All clear. Nothing is waiting on you.
                  </div>
                ) : (
                  alerts.slice(0, 8).map((al) => (
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
              </ScrollArea>
            </PopoverContent>
          </Popover>
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
            <ConsoleSkeleton />
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
                  onContextChange={setNavContext}
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
                (policy ? <PolicyView {...shared} policy={policy} /> : <ConsoleSkeleton />)}
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

      <ConsoleCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        agents={(org?.agents ?? []).map((a) => ({ id: a.id, name: a.name, status: a.status }))}
        decisions={decisions}
        onGo={goView}
        onSelectAgent={() => setView("agents")}
        onFocusSearch={() => searchRef.current?.focus()}
      />
      <KeyboardHelp open={help.open} onClose={() => help.setOpen(false)} />
    </div>
    </TooltipProvider>
  );
}

