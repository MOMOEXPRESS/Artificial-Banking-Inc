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
import { useStepUp } from "../../lib/step-up";
import { useTheme } from "../../lib/theme-provider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar, SidebarFolder, SidebarItem } from "@/components/ui/sidebar";
import { RailQuietClock } from "../../lib/quiet-hours-clock";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConsoleSkeleton } from "@/components/ui/skeleton";
import {
  sessionForPersistentStorage,
  type Approval,
  type Decision,
  type Delivery,
  type Escrow,
  type Journal,
  type Metrics,
  type OrgView,
  type Prefs,
  type Recon,
  type Session,
  type Setup,
  type View,
  type Webhook,
  type Alert as ConsoleAlert,
} from "../../lib/console-types";
import type { MissionState } from "../../lib/playground-view";
import { Login } from "../../lib/login-view";
import { Overview } from "../../lib/overview-view";
import { Playground } from "../../lib/playground-view";
import { Ledger } from "../../lib/ledger-view";
import { Webhooks } from "../../lib/webhooks-view";
import { Button } from "@/components/ui/button";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/abi-api";
const SELLER = process.env.NEXT_PUBLIC_SELLER_URL ?? "http://localhost:9402/report";

const NAV: { key: View; label: string; icon: string; group: string }[] = [
  { key: "overview", label: "Overview", icon: "home", group: "Home" },
  { key: "insights", label: "Insights", icon: "spark", group: "Home" },
  { key: "treasury", label: "Treasury", icon: "wallet", group: "Money" },
  { key: "payments", label: "Transactions", icon: "zap", group: "Money" },
  { key: "ledger", label: "Ledger", icon: "list", group: "Money" },
  { key: "agents", label: "Agents", icon: "robot", group: "Agents" },
  { key: "work", label: "Work", icon: "book", group: "Agents" },
  { key: "approvals", label: "Approvals", icon: "check", group: "Controls" },
  { key: "policy", label: "Policies", icon: "sliders", group: "Controls" },
  { key: "playground", label: "Playground", icon: "play", group: "Developers" },
  { key: "webhooks", label: "Webhooks", icon: "zap", group: "Developers" },
];

const NAV_GROUPS = ["Home", "Money", "Agents", "Controls", "Developers"] as const;

const MOBILE_NAV: { key: View; label: string; icon: string }[] = [
  { key: "overview", label: "Home", icon: "home" },
  { key: "treasury", label: "Money", icon: "wallet" },
  { key: "agents", label: "Agents", icon: "robot" },
  { key: "approvals", label: "Approvals", icon: "check" },
];

const VIEW_META: Partial<
  Record<View, { eyebrow: string; title: string; description: string; icon: string }>
> = {
  insights: {
    eyebrow: "Home intelligence",
    title: "Understand where the money is going.",
    description:
      "Track economics, vendor concentration, burn, anomalies, and the complete decision trail.",
    icon: "spark",
  },
  treasury: {
    eyebrow: "Money · Treasury",
    title: "Put every dollar in the right place.",
    description:
      "Fund the vault, assign operating budgets, move USDC, and keep book balances reconciled with the chain.",
    icon: "wallet",
  },
  payments: {
    eyebrow: "Money · Transactions",
    title: "Operate every payment from one queue.",
    description:
      "Review approvals, transactions, invoices, escrows, schedules, batches, and settlement rails together.",
    icon: "zap",
  },
  approvals: {
    eyebrow: "Controls · Approvals",
    title: "Resolve exceptions without slowing agents down.",
    description:
      "See why a payment needs a human, inspect the policy trace, and make a controlled decision.",
    icon: "check",
  },
  invoices: {
    eyebrow: "Money · Invoices",
    title: "Connect work delivered to money earned.",
    description:
      "Issue, monitor, and reconcile invoices without losing the agent and policy context behind them.",
    icon: "book",
  },
  escrows: {
    eyebrow: "Money · Escrows",
    title: "Protect funds until the work is complete.",
    description:
      "Monitor locked balances, settlement state, release conditions, and refunds in one operational view.",
    icon: "shield",
  },
  ledger: {
    eyebrow: "Money · Ledger",
    title: "A finance-grade record of every movement.",
    description:
      "Inspect double-entry journals, account balances, reconciliation health, and the source of every posting.",
    icon: "list",
  },
  agents: {
    eyebrow: "Agents · Directory",
    title: "Manage the workforce that can spend.",
    description:
      "Create identities, assign operating context, control sessions, inspect activity, and stop an agent instantly.",
    icon: "robot",
  },
  work: {
    eyebrow: "Agents · Work",
    title: "Connect agent output to financial results.",
    description:
      "Review runs, attribution, delivered work, and the revenue or cost attached to each outcome.",
    icon: "book",
  },
  policy: {
    eyebrow: "Controls · Policies",
    title: "Turn financial intent into deterministic rules.",
    description:
      "Set limits, destinations, timing, and review bands—then simulate the outcome before agents encounter it.",
    icon: "sliders",
  },
  playground: {
    eyebrow: "Developers · Playground",
    title: "Prove the complete payment path.",
    description:
      "Run a real agent request through policy, approval, settlement, and receipt without leaving the console.",
    icon: "play",
  },
  webhooks: {
    eyebrow: "Developers · Webhooks",
    title: "Send financial events into your systems.",
    description:
      "Manage signed endpoints, delivery health, retries, and the event history your applications depend on.",
    icon: "zap",
  },
  activity: {
    eyebrow: "Money · Activity",
    title: "Trace every financial decision.",
    description:
      "Search the complete allow, review, deny, and settlement history with the policy context intact.",
    icon: "list",
  },
  settings: {
    eyebrow: "Organization · Settings",
    title: "Configure ABI around your operating model.",
    description:
      "Manage launch readiness, people, security, merchants, data controls, integrations, and console behavior.",
    icon: "gear",
  },
  chat: {
    eyebrow: "Assistant",
    title: "Ask ABI about the operation.",
    description:
      "Investigate activity, policy, and risk with an assistant that cannot move money on its own.",
    icon: "spark",
  },
};

const ALL_VIEWS = new Set<View>([
  "overview",
  "treasury",
  "agents",
  "payments",
  "playground",
  "chat",
  "work",
  "approvals",
  "insights",
  "invoices",
  "escrows",
  "ledger",
  "policy",
  "webhooks",
  "activity",
  "settings",
]);

const TREASURY_TAB_SET = new Set(["fund", "wallets", "move", "analytics", "recovery"]);
const PAYMENTS_TAB_SET = new Set([
  "approvals",
  "recent",
  "subs",
  "rails",
  "invoices",
  "escrows",
  "batch",
  "schedule",
]);

function isView(v: string | null | undefined): v is View {
  return Boolean(v && ALL_VIEWS.has(v as View));
}

/** Alias views still deep-link; they open a parent surface + tab. */
function canonicalView(view: View): View {
  if (view === "approvals" || view === "invoices" || view === "escrows") return "payments";
  if (view === "activity") return "insights";
  if (view === "webhooks") return "webhooks";
  return view;
}

function tabForAliasView(view: View): string | null {
  if (view === "approvals") return "approvals";
  if (view === "invoices") return "invoices";
  if (view === "escrows") return "escrows";
  if (view === "activity") return "trail";
  return null;
}

function readConsoleQuery(): { view: View | null; tab: string | null } {
  if (typeof window === "undefined") return { view: null, tab: null };
  const params = new URLSearchParams(window.location.search);
  const viewRaw = params.get("view");
  const tabRaw = params.get("tab");
  return {
    view: isView(viewRaw) ? viewRaw : null,
    tab: tabRaw && tabRaw.trim() ? tabRaw.trim() : null,
  };
}

function writeConsoleQuery(view: View, tab: string | null) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.set("view", view);
  if (tab) params.set("tab", tab);
  else params.delete("tab");
  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", next);
}

function navGroupOf(view: View): string {
  if (view === "settings") return "Organization";
  if (view === "webhooks" || view === "playground") return "Developers";
  if (view === "approvals") return "Controls";
  if (view === "invoices" || view === "escrows" || view === "activity") return "Money";
  if (view === "chat") return "Assistant";
  return NAV.find((n) => n.key === view)?.group ?? "Console";
}

function viewLabelOf(view: View): string {
  if (view === "settings") return "Settings";
  if (view === "approvals") return "Approvals";
  if (view === "activity") return "Transactions";
  if (view === "webhooks") return "Webhooks";
  if (view === "invoices") return "Payments · Invoices";
  if (view === "escrows") return "Payments · Escrows";
  return NAV.find((n) => n.key === view)?.label ?? view;
}

/* ===================================================================== page */

export default function Console() {
  const [session, setSession] = useState<Session | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({ autoJump: true });
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setViewState] = useState<View>("overview");
  const [tabHint, setTabHint] = useState<string | null>(null);
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
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => new Set());
  const [banner, setBanner] = useState<ConsoleAlert | null>(null);
  const [query, setQuery] = useState("");
  const [activitySeed, setActivitySeed] = useState<{
    filter?: "all" | "allow" | "deny" | "review";
    dest?: string;
    key: number;
  } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navContext, setNavContext] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [folderOpen, setFolderOpen] = useState<Record<string, boolean>>({
    Home: true,
    Money: true,
    Agents: true,
    Controls: true,
    Developers: true,
  });
  const help = useKeyboardHelp();
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
      if (raw) {
        const safe = sessionForPersistentStorage(JSON.parse(raw) as Session);
        if (safe) setSession(safe);
        else localStorage.removeItem("pv_session");
      }
      const p = localStorage.getItem("pv_prefs");
      if (p) {
        const parsed = JSON.parse(p) as Partial<Prefs> & { sound?: boolean };
        setPrefs({ autoJump: parsed.autoJump ?? true });
      }
      setRailCollapsed(localStorage.getItem("abi_nav_collapsed") === "1");
    } catch {
      /* ignore */
    }
    const q = readConsoleQuery();
    if (q.view) setViewState(q.view);
    if (q.tab) setTabHint(q.tab);
    else if (q.view) {
      const aliasTab = tabForAliasView(q.view);
      if (aliasTab) setTabHint(aliasTab);
    }
    setHydrated(true);
  }, []);

  const setView = useCallback((v: View, tab?: string) => {
    setViewState(v);
    if (tab !== undefined) {
      setTabHint(tab);
      return;
    }
    const aliasTab = tabForAliasView(v);
    if (aliasTab) {
      setTabHint(aliasTab);
      return;
    }
    setTabHint((prev) => {
      if (!prev) return null;
      const canon = canonicalView(v);
      if (canon === "treasury" && TREASURY_TAB_SET.has(prev)) return prev;
      if (canon === "payments" && PAYMENTS_TAB_SET.has(prev)) return prev;
      if ((v === "insights" || v === "activity") && (prev === "trail" || prev === "activity"))
        return prev;
      return null;
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const alias = tabForAliasView(view);
    const canon = canonicalView(view);
    let effective = tabHint ?? alias;
    if (effective) {
      if (canon === "treasury" && !TREASURY_TAB_SET.has(effective)) effective = alias;
      else if (canon === "payments" && !PAYMENTS_TAB_SET.has(effective)) effective = alias;
      else if (
        canon !== "treasury" &&
        canon !== "payments" &&
        view !== "insights" &&
        view !== "activity"
      ) {
        effective = alias;
      }
    }
    writeConsoleQuery(view, effective);
  }, [hydrated, view, tabHint]);

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
    const persistent = sessionForPersistentStorage(s);
    if (persistent) localStorage.setItem("pv_session", JSON.stringify(persistent));
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
      const persistent = sessionForPersistentStorage(next);
      if (persistent) localStorage.setItem("pv_session", JSON.stringify(persistent));
      else localStorage.removeItem("pv_session");
      return next;
    });
  }, []);

  const savePrefs = useCallback((p: Prefs) => {
    setPrefs(p);
    localStorage.setItem("pv_prefs", JSON.stringify(p));
  }, []);

  /** Read the CSRF cookie the API set alongside the session cookie. */
  const readCsrf = useCallback(() => {
    if (typeof document === "undefined") return "";
    const hit = document.cookie.split(";").find((c) => c.trim().startsWith("abi_csrf="));
    return hit ? decodeURIComponent(hit.trim().slice("abi_csrf=".length)) : "";
  }, []);

  /** Authenticated fetch, before the step-up interceptor wraps it. */
  const rawFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const s = sessionRef.current;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...((init?.headers as Record<string, string>) ?? {}),
      };
      if (s?.mode === "session") {
        // The credential is an httpOnly cookie the browser attaches itself.
        // Because it rides along automatically, mutations need a token a
        // cross-site page cannot read — hence the double-submit header.
        const csrf = readCsrf();
        if (csrf) headers["x-abi-csrf"] = csrf;
        if (s.orgId) headers["x-abi-org"] = s.orgId;
      } else if (s?.guardianKey) {
        headers.Authorization = `Bearer ${s.guardianKey}`;
      }
      return fetch(`${API}${path}`, {
        ...init,
        credentials: "include",
        headers,
      });
    },
    [readCsrf],
  );

  // A high-value approval is refused until identity is re-proven. Handling that
  // here means every caller inherits it — including the four separate places
  // that resolve approvals, and whichever is written next. See lib/step-up.tsx.
  const { guard, stepUpModal } = useStepUp(rawFetch);

  const gFetch = useCallback(
    (path: string, init?: RequestInit) => guard(() => rawFetch(path, init)),
    [guard, rawFetch],
  );

  /**
   * Two-tier polling. Fast = approvals/activity; slow = journals/config.
   * Fingerprints skip setState when nothing meaningful changed. Prefer cheap
   * list signatures over full JSON.stringify of large decision/journal trees.
   * Polling pauses while the tab is hidden.
   */
  const snapRef = useRef<Record<string, string>>({});
  const setIfChanged = useCallback(<T,>(key: string, value: T, setter: (v: T) => void) => {
    let sig: string;
    try {
      if (Array.isArray(value)) {
        const rows = value as Record<string, unknown>[];
        const n = rows.length;
        if (n === 0) sig = "0";
        else {
          // id+status only — avoids serializing nested journal lines / decision payloads
          sig = `${n}|${rows
            .map(
              (r) =>
                `${String(r.id ?? r.intentId ?? "")}:${String(r.status ?? r.outcome ?? "")}:${String(r.at ?? r.createdAt ?? r.updatedAt ?? "")}`,
            )
            .join(",")}`;
        }
      } else {
        sig = JSON.stringify(value);
      }
    } catch {
      setter(value);
      return;
    }
    if (snapRef.current[key] === sig) return;
    snapRef.current[key] = sig;
    setter(value);
  }, []);

  const refreshFast = useCallback(async () => {
    if (!sessionRef.current) return;
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const res = await Promise.all(
        [
          "/v1/guardian/org",
          "/v1/guardian/approvals",
          "/v1/guardian/activity?limit=80",
          "/v1/guardian/escrows",
        ].map((p) => gFetch(p)),
      );
      if (res[0].status === 401) {
        saveSession(null);
        setToast("Guardian key rejected — signed out.", "err");
        return;
      }
      const [o, ap, a, es] = await Promise.all(res.map((r) => r.json()));
      setConnected(true);
      setIfChanged("org", o, setOrg);
      setIfChanged("approvals", ap.approvals ?? [], setApprovals);
      setIfChanged("decisions", a.decisions ?? [], setDecisions);
      setIfChanged("escrows", es.escrows ?? [], setEscrows);
      setLoading(false);
    } catch {
      setConnected(false);
    }
  }, [gFetch, saveSession, setToast, setIfChanged]);

  const refreshSlow = useCallback(async () => {
    if (!sessionRef.current) return;
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const res = await Promise.all(
        [
          "/v1/guardian/journals?limit=80",
          "/v1/guardian/policy",
          "/v1/guardian/webhooks",
          "/v1/guardian/webhooks/deliveries",
          "/v1/guardian/metrics",
          "/v1/guardian/setup",
          "/v1/guardian/summary",
          "/v1/guardian/invoices",
          "/v1/guardian/runs",
        ].map((p) => gFetch(p)),
      );
      const [jo, po, wh, de, me, st, su, inv, rn] = await Promise.all(res.map((r) => r.json()));
      setIfChanged("journals", jo.journals ?? [], setJournals);
      setIfChanged("policy", po.policy ?? null, setPolicy);
      setIfChanged("webhooks", wh.webhooks ?? [], setWebhooks);
      setIfChanged("deliveries", de.deliveries ?? [], setDeliveries);
      setIfChanged("metrics", me.metrics ?? null, setMetrics);
      setIfChanged("setup", st.setup ?? null, setSetup);
      setIfChanged("summary", su.summary ?? null, setSummary);
      setIfChanged("invoices", inv.invoices ?? [], setInvoices);
      setIfChanged("invStats", inv.stats ?? null, setInvStats);
      setIfChanged("runs", rn.runs ?? [], setRuns);
    } catch {
      /* the fast tier owns the connection indicator */
    }
  }, [gFetch, setIfChanged]);

  /** Full refresh — login / tab focus. Mutations use the lighter path below. */
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshFast(), refreshSlow()]);
  }, [refreshFast, refreshSlow]);

  useEffect(() => {
    if (!session) return;
    void refreshAll();
    const fast = setInterval(() => void refreshFast(), 8000);
    const slow = setInterval(() => void refreshSlow(), 30000);
    const onVis = () => {
      if (!document.hidden) void refreshAll();
    };
    document.addEventListener("visibilitychange", onVis);

    /** Reconcile is expensive server-side — keep it rare, not on every slow tick. */
    const refreshRecon = async () => {
      if (document.hidden || !sessionRef.current) return;
      try {
        const r = await gFetch("/v1/guardian/reconcile");
        const d = await r.json();
        setIfChanged("recon", d.reconciliation ?? null, setRecon);
      } catch {
        /* ignore */
      }
    };
    void refreshRecon();
    const reconTimer = setInterval(() => void refreshRecon(), 90000);

    return () => {
      clearInterval(fast);
      clearInterval(slow);
      clearInterval(reconTimer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [session, refreshAll, refreshFast, refreshSlow, gFetch, setIfChanged]);

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
        goto: "approvals",
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
        body: `${broke.map((b) => b.name).join(", ")} can't pay — fund them from a budget in Treasury → Move`,
        goto: "treasury",
      });
    }
    return out;
  }, [pending, escrows, deliveries, recon, org, agentName]);

  const visibleAlerts = useMemo(
    () => alerts.filter((a) => !dismissedAlerts.has(a.id)),
    [alerts, dismissedAlerts],
  );

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
    // right where you're watching the agent. Jump from anywhere else to Approvals.
    if (
      prefsRef.current.autoJump &&
      viewRef.current !== "approvals" &&
      viewRef.current !== "playground" &&
      viewRef.current !== "payments" &&
      viewRef.current !== "chat"
    ) {
      setView("approvals");
      setToast(`Agent parked a ${fmtUsd(a.amountUsdc)} payment — opened Approvals.`, "info");
    } else if (viewRef.current === "playground") {
      setToast(
        `Agent parked ${fmtUsd(a.amountUsdc)} — approve or deny it right in the timeline.`,
        "info",
      );
    } else if (viewRef.current === "chat") {
      setToast(`New approval in chat · ${fmtUsd(a.amountUsdc)}`, "info");
    }
  }, [pending, loading, agentName, setToast, setView]);

  useEffect(() => {
    if (banner && !pending.some((p) => `apr_${p.id}` === banner.id)) setBanner(null);
  }, [pending, banner]);

  async function act(label: string, fn: () => Promise<string | void>) {
    setBusy(true);
    try {
      const msg = await fn();
      // Mutations usually only touch live money state — avoid the full slow blast.
      await refreshFast();
      void refreshSlow();
      if (msg) setToast(msg, "ok");
    } catch (e) {
      setToast(`${label} failed: ${e instanceof Error ? e.message : String(e)}`, "err");
    } finally {
      setBusy(false);
    }
  }

  const goView = useCallback(
    (v: ShortcutView) => {
      setView(v as View);
      if (v !== "agents") setNavContext(null);
    },
    [setView],
  );

  useConsoleShortcuts({
    enabled: hydrated && Boolean(session),
    onGo: goView,
    onOpenPalette: () => setPaletteOpen(true),
    onToggleHelp: help.toggle,
  });

  if (!hydrated) return null;
  if (!session) return <Login onLogin={saveSession} setToast={setToast} />;

  const readOnly = org?.actor?.role === "viewer";
  const shared = { busy, act, gFetch, agentName, org, setToast, setView, readOnly };
  const viewLabel = viewLabelOf(view);
  const groupLabel = navGroupOf(view);
  const viewMeta = VIEW_META[view];
  const railActive =
    view === "approvals" || view === "activity" || view === "webhooks" ? view : canonicalView(view);

  return (
    <TooltipProvider delayDuration={250}>
      <div className={`app ${railOpen ? "rail-open" : ""} ${railCollapsed ? "nav-collapsed" : ""}`}>
        <button
          type="button"
          className="rail-burger"
          aria-label={railOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setRailOpen((v) => !v)}
        >
          <Icon name="list" />
        </button>
        {railOpen && (
          <button
            type="button"
            className="rail-scrim"
            aria-label="Close navigation"
            onClick={() => setRailOpen(false)}
          />
        )}
        <Sidebar className="rail rail-folders" label="Console navigation">
          <div className="rail-brand-row">
            <Link
              href="/"
              className="rail-brand"
              title="Back to landing"
              style={{ textDecoration: "none" }}
            >
              <ABAppIcon size={38} />
              <span>
                <b>Artificial Banking</b>
                <small>Financial operations</small>
              </span>
            </Link>
            <button
              type="button"
              className="rail-collapse"
              aria-label={railCollapsed ? "Expand navigation" : "Collapse navigation"}
              title={railCollapsed ? "Expand navigation" : "Collapse navigation"}
              onClick={() => {
                const next = !railCollapsed;
                setRailCollapsed(next);
                setFolderOpen({
                  Home: true,
                  Money: true,
                  Agents: true,
                  Controls: true,
                  Developers: true,
                });
                localStorage.setItem("abi_nav_collapsed", next ? "1" : "0");
              }}
            >
              <Icon name={railCollapsed ? "arrowRight" : "arrowLeft"} size={15} />
            </button>
          </div>
          {NAV_GROUPS.map((group) => {
            const items = NAV.filter((n) => n.group === group);
            const groupActive = items.some((n) => n.key === railActive);
            const showBadge =
              (group === "Money" && pending.length > 0) ||
              (group === "Agents" && (pending.length > 0 || mission.running));
            return (
              <SidebarFolder
                key={group}
                title={group}
                open={folderOpen[group] ?? true}
                onOpenChange={(open) => setFolderOpen((f) => ({ ...f, [group]: open }))}
                active={groupActive}
                badge={showBadge}
              >
                {items.map((n) => (
                  <SidebarItem
                    key={n.key}
                    nested
                    active={railActive === n.key}
                    label={n.label}
                    onClick={() => {
                      setView(n.key);
                      if (n.key !== "agents") setNavContext(null);
                      setRailOpen(false);
                    }}
                  >
                    <Icon name={n.icon} />
                    {n.key === "payments" && pending.length > 0 && <span className="dot-badge" />}
                    {n.key === "chat" && pending.length > 0 && <span className="dot-badge" />}
                    {n.key === "playground" && mission.running && (
                      <span className="dot-badge" style={{ background: "var(--accent)" }} />
                    )}
                  </SidebarItem>
                ))}
              </SidebarFolder>
            );
          })}
          <div className="rail-spacer" />
          <RailQuietClock
            quiet={policy?.quietHours}
            onOpenPolicy={() => {
              setView("policy");
              setRailOpen(false);
            }}
          />
          <SidebarItem
            nested
            active={view === "settings"}
            label="Settings"
            onClick={() => {
              setView("settings");
              setRailOpen(false);
            }}
          >
            <Icon name="gear" />
          </SidebarItem>
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
              className={`environment-chip ${org?.ledgerMode === "live" ? "live" : "sandbox"}`}
              onClick={() => setView("settings")}
              aria-label="Open environment settings"
            >
              <i />
              <span>{org?.ledgerMode === "live" ? "Live" : "Sandbox"}</span>
              <Icon name="arrowRight" size={12} />
            </button>
            <button
              type="button"
              className="search search-btn"
              onClick={() => setPaletteOpen(true)}
              aria-label="Open command palette"
            >
              <Icon name="search" />
              <span className="search-placeholder">Command palette…</span>
              <kbd className="search-kbd">⌘K</kbd>
            </button>
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
                <DropdownMenuItem onSelect={() => setPaletteOpen(true)}>
                  Command palette
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => help.setOpen(true)}>
                  Keyboard shortcuts
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => theme.toggle()}>
                  Theme: {theme.resolved === "dark" ? "Dark" : "Light"} (toggle)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    // Clearing local state is not signing out: the server session
                    // would stay valid until it expired. Revoke it first.
                    if (sessionRef.current?.mode === "session") {
                      void fetch(`${API}/v1/auth/logout`, {
                        method: "POST",
                        credentials: "include",
                        headers: { "x-abi-csrf": readCsrf() },
                      }).catch(() => {});
                    }
                    saveSession(null);
                  }}
                >
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Popover open={notifOpen} onOpenChange={setNotifOpen}>
              <PopoverTrigger asChild>
                <button className="icon-btn" aria-label="Alerts">
                  <Icon name="bell" />
                  {visibleAlerts.length > 0 && <span className="ping" />}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(360px,calc(100vw-24px))] p-0">
                <div className="notif-head">
                  <span>Needs attention ({visibleAlerts.length})</span>
                  {visibleAlerts.length > 0 && (
                    <Button
                      type="button"
                      variant="bare"
                      size="sm"
                      onClick={() => {
                        setDismissedAlerts((prev) => {
                          const next = new Set(prev);
                          for (const a of visibleAlerts) next.add(a.id);
                          return next;
                        });
                        setNotifOpen(false);
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                <ScrollArea className="max-h-80">
                  {visibleAlerts.length === 0 ? (
                    <div
                      style={{ padding: 26, textAlign: "center", fontSize: 12.5 }}
                      className="muted"
                    >
                      All clear. Nothing is waiting on you.
                    </div>
                  ) : (
                    visibleAlerts.slice(0, 8).map((al) => (
                      <button
                        key={al.id}
                        className="notif-item"
                        onClick={() => {
                          if (al.kind === "fund") setView("treasury", "move");
                          else setView(al.goto);
                          setNotifOpen(false);
                        }}
                      >
                        <span
                          className="ico"
                          style={{
                            background:
                              al.tone === "bad"
                                ? "var(--red-soft)"
                                : al.tone === "warn"
                                  ? "var(--orange-soft)"
                                  : "var(--accent-soft)",
                            color:
                              al.tone === "bad"
                                ? "var(--red)"
                                : al.tone === "warn"
                                  ? "var(--orange)"
                                  : "var(--accent)",
                          }}
                        >
                          <Icon
                            name={
                              al.kind === "approval"
                                ? "check"
                                : al.kind === "drift"
                                  ? "alert"
                                  : "zap"
                            }
                            size={15}
                          />
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
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    banner.kind === "fund" ? setView("treasury", "move") : setView(banner.goto)
                  }
                >
                  Review now
                </Button>
                <Button variant="bare" size="sm" onClick={() => setBanner(null)}>
                  <Icon name="x" size={14} />
                </Button>
              </div>
            )}

            {loading ? (
              <ConsoleSkeleton />
            ) : (
              <div className="view">
                {view !== "overview" && viewMeta && (
                  <section className="console-section-intro">
                    <div className="console-section-mark" aria-hidden>
                      <Icon name={viewMeta.icon} size={18} />
                    </div>
                    <div className="console-section-copy">
                      <div className="ops-eyebrow">{viewMeta.eyebrow}</div>
                      <h2>{viewMeta.title}</h2>
                      <p>{viewMeta.description}</p>
                    </div>
                    <div className="console-section-context" aria-label="Current operating context">
                      <span className={org?.ledgerMode === "live" ? "live" : ""}>
                        <i /> {org?.ledgerMode === "live" ? "Live" : "Sandbox"}
                      </span>
                      <span>{org?.actor?.role ?? "owner"}</span>
                    </div>
                  </section>
                )}
                {view !== "overview" && (
                  <PageTour view={view === "invoices" || view === "escrows" ? "payments" : view} />
                )}
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
                {view === "treasury" && (
                  <TreasuryView
                    gFetch={gFetch}
                    busy={busy}
                    act={act}
                    readOnly={readOnly}
                    ledgerMode={org?.ledgerMode ?? "sandbox"}
                    initialTab={tabHint && TREASURY_TAB_SET.has(tabHint) ? tabHint : null}
                    onTabChange={(t) => setTabHint(t)}
                  />
                )}
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
                    approvals={approvals}
                    pending={pending}
                    agentName={agentName}
                    setToast={setToast}
                    setView={setView}
                    org={org}
                    initialTab={
                      tabHint && PAYMENTS_TAB_SET.has(tabHint)
                        ? (tabHint as
                            | "approvals"
                            | "recent"
                            | "subs"
                            | "rails"
                            | "invoices"
                            | "escrows"
                            | "batch"
                            | "schedule")
                        : undefined
                    }
                    onTabChange={(t) => setTabHint(t)}
                    agents={(org?.agents ?? []).map((a) => ({
                      id: a.id,
                      name: a.name,
                      status: a.status,
                    }))}
                  />
                )}
                {(view === "invoices" || view === "escrows" || view === "approvals") && (
                  <PaymentsView
                    gFetch={gFetch}
                    busy={busy}
                    act={act}
                    readOnly={readOnly}
                    invoices={invoices}
                    invStats={invStats}
                    escrows={escrows}
                    approvals={approvals}
                    pending={pending}
                    agentName={agentName}
                    setToast={setToast}
                    setView={setView}
                    org={org}
                    initialTab={
                      (tabHint && PAYMENTS_TAB_SET.has(tabHint)
                        ? tabHint
                        : view === "approvals"
                          ? "approvals"
                          : view) as
                        | "approvals"
                        | "recent"
                        | "subs"
                        | "rails"
                        | "invoices"
                        | "escrows"
                        | "batch"
                        | "schedule"
                    }
                    onTabChange={(t) => setTabHint(t)}
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
                {view === "work" && <WorkView runs={runs} busy={busy} act={act} gFetch={gFetch} />}
                {(view === "insights" || view === "activity") && (
                  <InsightsView
                    gFetch={gFetch}
                    setView={(v) => setView(v as View)}
                    decisions={decisions}
                    agentName={agentName}
                    setToast={setToast}
                    query={query}
                    initialTab={view === "activity" ? "trail" : undefined}
                    activitySeed={activitySeed ?? undefined}
                  />
                )}
                {view === "ledger" && (
                  <Ledger journals={journals} metrics={metrics} recon={recon} />
                )}
                {view === "policy" &&
                  (policy ? <PolicyView {...shared} policy={policy} /> : <ConsoleSkeleton />)}
                {view === "webhooks" && (
                  <Webhooks {...shared} webhooks={webhooks} deliveries={deliveries} />
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

        <nav className="mobile-bottom-nav" aria-label="Primary navigation">
          {MOBILE_NAV.map((item) => (
            <button
              type="button"
              key={item.key}
              className={railActive === item.key ? "active" : ""}
              aria-current={railActive === item.key ? "page" : undefined}
              onClick={() => {
                setView(item.key);
                setRailOpen(false);
              }}
            >
              <span className="mobile-nav-icon">
                <Icon name={item.icon} size={19} />
                {item.key === "approvals" && pending.length > 0 && <i>{pending.length}</i>}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
          <button
            type="button"
            className={railOpen ? "active" : ""}
            aria-expanded={railOpen}
            onClick={() => setRailOpen((open) => !open)}
          >
            <span className="mobile-nav-icon">
              <Icon name="list" size={19} />
            </span>
            <span>More</span>
          </button>
        </nav>

        <button
          type="button"
          className="abi-assistant-fab"
          onClick={() => setView("chat")}
          aria-label="Open ABI assistant"
          title="Open ABI assistant"
        >
          <Icon name="spark" size={17} />
          <span>Ask ABI</span>
          {pending.length > 0 && <i>{pending.length}</i>}
        </button>

        <ConsoleCommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          agents={(org?.agents ?? []).map((a) => ({ id: a.id, name: a.name, status: a.status }))}
          decisions={decisions}
          onGo={goView}
          onSelectAgent={() => setView("agents")}
          onJumpToDenial={(d) => {
            const dest = d.destination.replace(/^https?:\/\//, "").split("/")[0] ?? d.destination;
            setQuery(d.destination);
            setActivitySeed({
              filter: "deny",
              dest,
              key: Date.now(),
            });
            setView("activity");
          }}
        />
        <KeyboardHelp open={help.open} onClose={() => help.setOpen(false)} />
        {stepUpModal}
      </div>
    </TooltipProvider>
  );
}
