"use client";

import { okJson, sessionRejected } from "../../lib/api-response";
import {
  SIGNED_OUT_PARAM,
  performSignOut,
  readCsrfCookie,
  signedOutNotice,
  signedOutUrl,
} from "../../lib/sign-out";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ABAppIcon, ABMark } from "../../lib/brand";
import { showApprovalToast } from "../../lib/approval-toast";
import { Icon, fmtUsd, relTime } from "../../lib/ui";
import { isDrawerViewport } from "../../lib/nav-toggle";
import { InsightsView } from "../../lib/analytics";
import { ChatView } from "../../lib/chat-view";
import { PolicyView, type Policy } from "../../lib/policy-view";
import { SettingsView } from "../../lib/settings-view";
import { loadTabAgentKeys, mergeAgentKeys, saveTabAgentKeys } from "../../lib/agent-keys-tab";
import { PageTour } from "../../lib/page-tour";
import { hasBudgetOpsSetup } from "../../lib/overview-setup";
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
import { LoadError } from "../../lib/load-error";
import { PolicyLoader } from "../../lib/policy-loader";
import {
  describeFailure,
  describeThrown,
  fetchWithTimeout,
  logLoadFailure,
  shouldShowLoadError,
  type LoadFailure,
} from "../../lib/load-state";
import { fastPollBackoffMs } from "../../lib/bounded-poll";
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
import { emptyMissionState, type MissionState } from "../../lib/playground-view";
import { Login } from "../../lib/login-view";
import { Overview } from "../../lib/overview-view";
import { Playground } from "../../lib/playground-view";
import { Ledger } from "../../lib/ledger-view";
import { Webhooks } from "../../lib/webhooks-view";
import { WaitlistView } from "../../lib/waitlist-view";
import {
  EMPTY_FEED,
  approvalToastFrom,
  collapseApprovals,
  freshSince,
  linkView,
  maxId,
  parseFeed,
  resolvedApprovalAlerts,
  toastFor,
  type NotificationFeed,
  type NotificationItem,
} from "../../lib/notifications-feed";
import { browserApiBase, sellerUrl } from "../../lib/browser-api";
import { Button } from "@/components/ui/button";

const API = browserApiBase();
const SELLER = sellerUrl() ?? "";

const NAV: { key: View; label: string; icon: string; group: string }[] = [
  { key: "overview", label: "Overview", icon: "home", group: "Home" },
  { key: "insights", label: "Insights", icon: "spark", group: "Home" },
  { key: "treasury", label: "Treasury", icon: "wallet", group: "Money" },
  { key: "payments", label: "Transactions", icon: "zap", group: "Money" },
  { key: "ledger", label: "Ledger", icon: "list", group: "Money" },
  { key: "agents", label: "API", icon: "key", group: "Connections" },
  { key: "work", label: "Work", icon: "book", group: "Connections" },
  { key: "approvals", label: "Approvals", icon: "check", group: "Controls" },
  { key: "policy", label: "Policies", icon: "sliders", group: "Controls" },
  { key: "playground", label: "Playground", icon: "play", group: "Developers" },
  { key: "webhooks", label: "Webhooks", icon: "zap", group: "Developers" },
];

/** Shown only to waitlist admins (GET /v1/guardian/waitlist/access). */
const WAITLIST_NAV: { key: View; label: string; icon: string; group: string } = {
  key: "waitlist",
  label: "Waitlist",
  icon: "inbox",
  group: "Home",
};

const NAV_GROUPS = ["Home", "Money", "Connections", "Controls", "Developers"] as const;

const MOBILE_NAV: { key: View; label: string; icon: string }[] = [
  { key: "overview", label: "Home", icon: "home" },
  { key: "treasury", label: "Money", icon: "wallet" },
  { key: "agents", label: "API", icon: "key" },
  { key: "approvals", label: "Approvals", icon: "check" },
];

const VIEW_META: Partial<Record<View, { eyebrow: string; description: string; icon: string }>> = {
  insights: {
    eyebrow: "Home intelligence",
    description:
      "Track economics, vendor concentration, burn, anomalies, and the complete decision trail.",
    icon: "spark",
  },
  treasury: {
    eyebrow: "Money · Treasury",
    description:
      "Fund the vault, assign operating budgets, move USDC, and keep book balances reconciled with the chain.",
    icon: "wallet",
  },
  payments: {
    eyebrow: "Money · Transactions",
    description:
      "Review approvals, transactions, invoices, escrows, schedules, batches, and settlement rails together.",
    icon: "zap",
  },
  approvals: {
    eyebrow: "Controls · Approvals",
    description:
      "See why a payment needs a human, inspect the policy trace, and make a controlled decision.",
    icon: "check",
  },
  invoices: {
    eyebrow: "Money · Invoices",
    description:
      "Issue, monitor, and reconcile invoices without losing the agent and policy context behind them.",
    icon: "book",
  },
  escrows: {
    eyebrow: "Money · Escrows",
    description:
      "Monitor locked balances, settlement state, release conditions, and refunds in one operational view.",
    icon: "shield",
  },
  ledger: {
    eyebrow: "Money · Ledger",
    description:
      "Inspect double-entry journals, account balances, reconciliation health, and the source of every posting.",
    icon: "list",
  },
  agents: {
    eyebrow: "API · Keys",
    description:
      "Create identities, assign operating context, control sessions, inspect activity, and stop an agent instantly.",
    icon: "key",
  },
  work: {
    eyebrow: "Connections · Work",
    description:
      "Review runs, attribution, delivered work, and the revenue or cost attached to each outcome.",
    icon: "book",
  },
  policy: {
    eyebrow: "Controls · Policies",
    description:
      "Set limits, destinations, timing, and review bands—then simulate the outcome before agents encounter it.",
    icon: "sliders",
  },
  playground: {
    eyebrow: "Developers · Playground",
    description:
      "Run a real agent request through policy, approval, settlement, and receipt without leaving the console.",
    icon: "play",
  },
  webhooks: {
    eyebrow: "Developers · Webhooks",
    description:
      "Developer tools: signed endpoints and the delivery log for your integrations. Your own notifications live under the bell.",
    icon: "zap",
  },
  activity: {
    eyebrow: "Money · Activity",
    description:
      "Search the complete allow, review, deny, and settlement history with the policy context intact.",
    icon: "list",
  },
  waitlist: {
    eyebrow: "Home · Waitlist",
    description:
      "Everyone who joined from the public waitlist form, newest first. Export the full list as CSV.",
    icon: "inbox",
  },
  settings: {
    eyebrow: "Organization · Settings",
    description:
      "Manage launch readiness, people, security, merchants, data controls, integrations, and console behavior.",
    icon: "gear",
  },
  chat: {
    eyebrow: "Assistant",
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
  "waitlist",
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
  if (view === "waitlist") return "Waitlist";
  if (view === "approvals") return "Approvals";
  if (view === "activity") return "Transactions";
  if (view === "webhooks") return "Webhooks";
  if (view === "invoices") return "Transactions · Invoices";
  if (view === "escrows") return "Transactions · Escrows";
  return NAV.find((n) => n.key === view)?.label ?? view;
}

/* ===================================================================== page */

function tabStorage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export default function Console() {
  const [session, setSession] = useState<Session | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({ autoJump: true });
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setViewState] = useState<View>("overview");
  const [tabHint, setTabHint] = useState<string | null>(null);
  const [org, setOrg] = useState<OrgView | null>(null);
  const [budgetOpsSetup, setBudgetOpsSetup] = useState<{ orgId: string; ready: boolean } | null>(
    null,
  );
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  /** Waitlist admins only (the API decides): adds the Waitlist nav item. */
  const [waitlistAllowed, setWaitlistAllowed] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recon, setRecon] = useState<Recon | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invStats, setInvStats] = useState<InvoiceStats | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  /** Why the shell is still on its skeleton, if `/org` keeps failing. */
  const [orgLoad, setOrgLoad] = useState<{
    failures: number;
    startedAt: number;
    last: LoadFailure[];
  }>(() => ({ failures: 0, startedAt: Date.now(), last: [] }));
  /** Last time `/org` answered — shown when a later refresh fails. */
  const orgLastOkAt = useRef<number | null>(null);
  /**
   * Consecutive fast-poll failures back the 8 s heartbeat off (16 s, 32 s,
   * capped at 60 s) instead of re-sending all seven reads every tick into an
   * API that is not answering.
   */
  const fastBackoffUntil = useRef(0);
  const fastFailures = useRef(0);
  const noteFastFailure = useCallback(() => {
    fastFailures.current += 1;
    // Small slack so the 8 s tick that lands right at the boundary still runs.
    fastBackoffUntil.current = Date.now() + fastPollBackoffMs(fastFailures.current) - 1000;
  }, []);
  const [orgRetrying, setOrgRetrying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(true);
  const [notifOpen, setNotifOpen] = useState(false);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => new Set());
  /** Notification history (GET /v1/guardian/notifications) — below the live alerts. */
  const [feed, setFeed] = useState<NotificationFeed>(EMPTY_FEED);
  /** Highest notification id already seen; null until the first load. */
  const lastNotifId = useRef<number | null>(null);
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
    Connections: true,
    Controls: true,
    Developers: true,
  });
  const help = useKeyboardHelp();
  const theme = useTheme();

  // Mission state lives in the shell so a run survives navigating between
  // views — the agent keeps working while you go approve something.
  const [mission, setMission] = useState<MissionState>(emptyMissionState);

  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const viewRef = useRef<View>(view);
  viewRef.current = view;
  const seenApprovals = useRef<Set<string>>(new Set());
  /** Approvals that already have an on-screen card (one card per approval). */
  const approvalCards = useRef<Set<string>>(new Set());
  /** Approvals already pending at sign-in are not "new" — do not hijack the view. */
  const firstApprovalLoad = useRef(true);
  /** Lives in the shell so Stop still works after navigating away and back. */
  const missionCancel = useRef(false);

  const setToast = useCallback((msg: string, kind: "ok" | "err" | "info" = "info") => {
    toast(msg, kind);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem("pv_session");
        if (raw) {
          const parsed = JSON.parse(raw) as Session;
          const safe = sessionForPersistentStorage(parsed);
          if (safe) {
            // Re-validate the httpOnly cookie before painting a signed-in shell.
            // Without this, a stale localStorage row flashes the console and then
            // immediately signs the user out on the first 401.
            // A network blip (cold start, proxy timeout) must not sign the user out:
            // treat it like a transient failure and let the poller decide.
            const me = await fetch(`${API}/v1/auth/me`, {
              credentials: "include",
              cache: "no-store",
            }).catch(() => null);
            if (cancelled) return;
            if (me?.ok) {
              const body = (await me.json()) as {
                user: { id: string; email: string; name: string };
                orgs: { id: string }[];
              };
              const orgId = safe.orgId ?? body.orgs[0]?.id;
              setSession({
                ...safe,
                user: body.user,
                orgId,
                // Agent keys never touch localStorage; this tab may still hold them.
                agentKeys: loadTabAgentKeys(tabStorage(), orgId),
              });
            } else if (me && sessionRejected(me.status)) {
              // Only an explicit 401 means the cookie session is gone.
              localStorage.removeItem("pv_session");
            } else {
              // 429 / 5xx / offline: keep the stored session. The fast poller
              // signs out on a real 401 once the API answers again.
              setSession({ ...safe, agentKeys: loadTabAgentKeys(tabStorage(), safe.orgId) });
            }
          } else if (parsed.mode === "key" && parsed.guardianKey) {
            setSession(parsed);
          } else {
            localStorage.removeItem("pv_session");
          }
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
      if (cancelled) return;
      // A deliberate logout lands here with ?signed_out=…: say so plainly
      // (never the "key rejected" error), then drop the flag from the URL.
      try {
        const url = new URL(window.location.href);
        const notice = signedOutNotice(url.searchParams.get(SIGNED_OUT_PARAM));
        if (url.searchParams.has(SIGNED_OUT_PARAM)) {
          url.searchParams.delete(SIGNED_OUT_PARAM);
          window.history.replaceState(null, "", url.toString());
        }
        // Deferred a tick so the toaster (mounted by the layout) is listening.
        if (notice) window.setTimeout(() => toast(notice.msg, notice.kind), 50);
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
    })();
    return () => {
      cancelled = true;
    };
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

  /** Approval card "Review": open Approvals and bring that approval into view. */
  const reviewApproval = useCallback(
    (approvalId: string | null) => {
      setView("approvals");
      if (!approvalId || typeof window === "undefined") return;
      window.setTimeout(() => {
        const el = document.querySelector(
          `[data-approval-id="${CSS.escape(approvalId)}"]`,
        ) as HTMLElement | null;
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("approval-card-flash");
        window.setTimeout(() => el.classList.remove("approval-card-flash"), 1800);
      }, 350);
    },
    [setView],
  );

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
    if (s) {
      s = { ...s, agentKeys: mergeAgentKeys(s.agentKeys, loadTabAgentKeys(tabStorage(), s.orgId)) };
    }
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
      if (patch.agentKeys) saveTabAgentKeys(tabStorage(), next.orgId, next.agentKeys);
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
    return readCsrfCookie(document.cookie);
  }, []);

  /**
   * The one logout path (lib/sign-out.ts): revoke the server session, clear
   * stored session state (including a guardian key), then hard-navigate to
   * sign-in so nothing from this session stays in memory.
   */
  const signingOut = useRef(false);
  const signOut = useCallback(
    async (everywhere = false) => {
      if (signingOut.current) return;
      signingOut.current = true;
      const s = sessionRef.current;
      const outcome = await performSignOut({
        apiBase: API,
        mode: s?.mode ?? (s?.guardianKey ? "key" : undefined),
        everywhere,
        csrf: readCsrf(),
        orgId: s?.orgId,
        local: typeof localStorage === "undefined" ? null : localStorage,
        tab: typeof sessionStorage === "undefined" ? null : sessionStorage,
      });
      setSession(null);
      window.location.replace(signedOutUrl(outcome));
    },
    [readCsrf],
  );

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
      // A hung request used to stall a whole Promise.all polling tier, which
      // left views on their skeleton forever. Abort after 15 s instead.
      return fetchWithTimeout(`${API}${path}`, {
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
          "/v1/guardian/budgets",
          "/v1/guardian/agent-groups",
          "/v1/guardian/notifications?limit=20",
        ].map((p) => gFetch(p)),
      );
      if (res[0].status === 401) {
        // A deliberate logout races the pollers: their 401 is expected then,
        // not a rejected credential, so stay quiet and let signOut finish.
        if (signingOut.current) return;
        saveSession(null);
        setToast(
          sessionRef.current?.mode === "session"
            ? "Your session ended. Sign in again."
            : "Guardian key rejected — signed out.",
          "err",
        );
        return;
      }
      // Non-2xx bodies (429 rate limit, 5xx, proxy errors) become null and are
      // never stored: an `{ error }` body saved as `org` crashed the header
      // (`org.org.name`) and took the whole console into the error boundary.
      const [o, ap, a, es, bu, gr, nf] = await Promise.all(res.map((r) => okJson(r)));
      if (nf) {
        const next = parseFeed(nf);
        setIfChanged("notifications", next, setFeed);
        // Toasts for new failed payments, refusals and approvals. The first
        // load only records the high-water mark so refreshes don't replay.
        for (const n of freshSince(next.notifications, lastNotifId.current)) {
          const card = approvalToastFrom(n);
          if (card) {
            // The approvals poll lands in the same refresh and shows a richer
            // card (with context) for the same approval; give it a beat first.
            window.setTimeout(() => {
              if (card.approvalId && approvalCards.current.has(card.approvalId)) return;
              if (card.approvalId) approvalCards.current.add(card.approvalId);
              showApprovalToast(card, { onReview: reviewApproval });
            }, 1200);
            continue;
          }
          const t = toastFor(n);
          if (t) setToast(t.message, t.kind);
        }
        lastNotifId.current = maxId(next.notifications, lastNotifId.current ?? 0);
      }
      if (!o?.org?.id) {
        const failure = await describeFailure("/v1/guardian/org", res[0]);
        logLoadFailure("shell", failure);
        noteFastFailure();
        setOrgLoad((s) => ({ ...s, failures: s.failures + 1, last: [failure] }));
      } else {
        fastFailures.current = 0;
        fastBackoffUntil.current = 0;
        orgLastOkAt.current = Date.now();
        setOrgLoad((s) => (s.failures ? { failures: 0, startedAt: Date.now(), last: [] } : s));
      }
      if (o?.org?.id) {
        setBudgetOpsSetup(
          Array.isArray(bu?.budgets) && Array.isArray(gr?.groups)
            ? { orgId: o.org.id, ready: hasBudgetOpsSetup(bu.budgets, gr.groups) }
            : null,
        );
        setIfChanged("org", o, setOrg);
        setLoading(false);
      }
      setConnected(res.some((r) => r.ok));
      if (ap) setIfChanged("approvals", ap.approvals ?? [], setApprovals);
      if (a) setIfChanged("decisions", a.decisions ?? [], setDecisions);
      if (es) setIfChanged("escrows", es.escrows ?? [], setEscrows);
    } catch (e) {
      setConnected(false);
      const failure = describeThrown("/v1/guardian/org", e);
      logLoadFailure("shell", failure);
      noteFastFailure();
      setOrgLoad((s) => ({ ...s, failures: s.failures + 1, last: [failure] }));
    }
  }, [gFetch, saveSession, setToast, setIfChanged, reviewApproval, noteFastFailure]);

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
      const [jo, po, wh, de, me, st, su, inv, rn] = await Promise.all(res.map((r) => okJson(r)));
      if (jo) setIfChanged("journals", jo.journals ?? [], setJournals);
      if (po?.policy) setIfChanged("policy", po.policy, setPolicy);
      if (wh) setIfChanged("webhooks", wh.webhooks ?? [], setWebhooks);
      if (de) setIfChanged("deliveries", de.deliveries ?? [], setDeliveries);
      if (me) setIfChanged("metrics", me.metrics ?? null, setMetrics);
      if (st) setIfChanged("setup", st.setup ?? null, setSetup);
      if (su) setIfChanged("summary", su.summary ?? null, setSummary);
      if (inv) {
        setIfChanged("invoices", inv.invoices ?? [], setInvoices);
        setIfChanged("invStats", inv.stats ?? null, setInvStats);
      }
      if (rn) setIfChanged("runs", rn.runs ?? [], setRuns);
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
    const fast = setInterval(() => {
      // Backing off after failures; Retry and tab focus still refresh at once.
      if (Date.now() < fastBackoffUntil.current) return;
      void refreshFast();
    }, 8000);
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
    // A pending approval that resolves while you watch turns into its outcome
    // here instead of silently vanishing from the list.
    for (const r of resolvedApprovalAlerts(approvals, seenApprovals.current)) {
      out.push({ ...r, kind: "approval", goto: "approvals" });
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
      return Number(ag.availableUsdc ?? bal?.usdc ?? 0) <= 0 && ag.status === "active";
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
  }, [pending, approvals, escrows, deliveries, recon, org, agentName]);

  const history = useMemo(() => collapseApprovals(feed.notifications), [feed]);
  const markRead = useCallback(
    async (n?: NotificationItem) => {
      const path = n
        ? `/v1/guardian/notifications/${n.id}/read`
        : "/v1/guardian/notifications/read-all";
      setFeed((f) => ({
        notifications: f.notifications.map((x) =>
          !n || x.id === n.id ? { ...x, readAt: x.readAt ?? new Date().toISOString() } : x,
        ),
        unreadCount: n ? Math.max(0, f.unreadCount - (n.readAt ? 0 : 1)) : 0,
      }));
      try {
        await gFetch(path, { method: "POST", body: "{}" });
      } catch {
        /* next fast refresh reconciles */
      }
    },
    [gFetch],
  );

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
    // One card per approval: the notification feed reuses this toast id.
    const card = (hint: string) => {
      approvalCards.current.add(a.id);
      return showApprovalToast(
        {
          approvalId: a.id,
          amount: fmtUsd(a.amountUsdc),
          agent: agentName(a.agentId),
          destination: a.destination,
        },
        { onReview: reviewApproval, hint },
      );
    };
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
      card("Opened Approvals for you.");
    } else if (viewRef.current === "playground") {
      card("Approve or deny it right in the timeline.");
    } else if (viewRef.current === "chat") {
      card("It is waiting in this chat too.");
    }
  }, [pending, loading, agentName, setView, reviewApproval]);

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

  useEffect(() => {
    if (!session || org?.actor?.role !== "owner") {
      setWaitlistAllowed(false);
      return;
    }
    let live = true;
    gFetch("/v1/guardian/waitlist/access")
      .then((r) => (r.ok ? r.json() : { allowed: false }))
      .then((d: { allowed?: boolean }) => live && setWaitlistAllowed(Boolean(d.allowed)))
      .catch(() => live && setWaitlistAllowed(false));
    return () => {
      live = false;
    };
  }, [session, session?.orgId, org?.actor?.role, gFetch]);

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
        <Sidebar id="console-rail" className="rail rail-folders" label="Console navigation">
          <div className="rail-brand-row">
            {/* The logo is the toggle: no separate arrow. On the desktop rail it
                collapses/expands the navigation; in the phone drawer (where the
                rail has no collapsed state) it closes the drawer. */}
            <button
              type="button"
              className="rail-brand rail-brand-toggle"
              data-testid="rail-brand-toggle"
              aria-controls="console-rail"
              aria-expanded={!railCollapsed}
              aria-label={railCollapsed ? "Expand navigation" : "Collapse navigation"}
              title={railCollapsed ? "Expand navigation" : "Collapse navigation"}
              onClick={() => {
                if (isDrawerViewport()) {
                  setRailOpen(false);
                  return;
                }
                const next = !railCollapsed;
                setRailCollapsed(next);
                setFolderOpen({
                  Home: true,
                  Money: true,
                  Connections: true,
                  Controls: true,
                  Developers: true,
                });
                localStorage.setItem("abi_nav_collapsed", next ? "1" : "0");
              }}
            >
              <ABAppIcon size={38} />
              <span>
                <b>Artificial Banking</b>
                <small>Financial operations</small>
              </span>
            </button>
          </div>
          {NAV_GROUPS.map((group) => {
            const items = (waitlistAllowed ? [...NAV, WAITLIST_NAV] : NAV).filter(
              (n) => n.group === group,
            );
            const groupActive = items.some((n) => n.key === railActive);
            const showBadge =
              (group === "Money" && pending.length > 0) ||
              (group === "Connections" && (pending.length > 0 || mission.running));
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
              className="environment-chip live"
              onClick={() => setView("settings")}
              aria-label="Open environment settings"
            >
              <i />
              <span>{org?.network?.testnet === false ? "Live" : "Live · testnet"}</span>
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
                  <div className="avatar">{(org?.org?.name ?? "PV").slice(0, 2).toUpperCase()}</div>
                  <div className="who">
                    <b>{org?.org?.name ?? "Loading…"}</b>
                    <span>
                      {org?.actor?.role === "viewer"
                        ? "Viewer · read-only"
                        : org?.actor?.role === "approver"
                          ? "Approver · " + (org?.network?.testnet === false ? "live" : "testnet")
                          : connected
                            ? "Owner · " + (org?.network?.testnet === false ? "live" : "testnet")
                            : "reconnecting…"}
                      {org?.org?.status === "frozen" ? " · FROZEN" : ""}
                    </span>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{org?.org?.name ?? "Organization"}</DropdownMenuLabel>
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
                <DropdownMenuItem onSelect={() => void signOut(false)}>Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Popover open={notifOpen} onOpenChange={setNotifOpen}>
              <PopoverTrigger asChild>
                <button
                  className="icon-btn"
                  aria-label={`Notifications${pending.length ? ` (${pending.length} approval${pending.length === 1 ? "" : "s"} waiting)` : ""}${feed.unreadCount ? ` (${feed.unreadCount} unread)` : ""}`}
                  data-testid="notifications-bell"
                >
                  <Icon name="bell" />
                  {pending.length > 0 ? (
                    <span className="bell-count" data-testid="bell-approval-count">
                      {pending.length > 99 ? "99+" : pending.length}
                    </span>
                  ) : (
                    (visibleAlerts.length > 0 || feed.unreadCount > 0) && <span className="ping" />
                  )}
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
                <ScrollArea className="max-h-[70vh]">
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
                  <div
                    className="notif-head notif-history-head"
                    data-testid="notifications-history"
                  >
                    <span>Recent{feed.unreadCount > 0 ? ` · ${feed.unreadCount} unread` : ""}</span>
                    {feed.unreadCount > 0 && (
                      <Button
                        type="button"
                        variant="bare"
                        size="sm"
                        onClick={() => void markRead()}
                      >
                        Mark all read
                      </Button>
                    )}
                  </div>
                  {history.length === 0 ? (
                    <div
                      style={{ padding: 18, textAlign: "center", fontSize: 12.5 }}
                      className="muted"
                    >
                      No notifications yet. Payments, refusals, approvals, keys, policy changes and
                      runs show up here.
                    </div>
                  ) : (
                    history.slice(0, 15).map((n) => {
                      const target = linkView(n.link);
                      return (
                        <button
                          key={`n_${n.id}`}
                          className={`notif-item${n.readAt ? " is-read" : " is-unread"}`}
                          onClick={() => {
                            void markRead(n);
                            if (target) setView(target as View);
                            setNotifOpen(false);
                          }}
                        >
                          <span
                            className="ico"
                            style={{
                              background:
                                n.severity === "bad"
                                  ? "var(--red-soft)"
                                  : n.severity === "warn"
                                    ? "var(--orange-soft)"
                                    : "var(--accent-soft)",
                              color:
                                n.severity === "bad"
                                  ? "var(--red)"
                                  : n.severity === "warn"
                                    ? "var(--orange)"
                                    : "var(--accent)",
                            }}
                          >
                            <Icon
                              name={
                                n.kind.startsWith("approval")
                                  ? "check"
                                  : n.severity === "bad"
                                    ? "alert"
                                    : "bell"
                              }
                              size={15}
                            />
                          </span>
                          <span className="body">
                            <b>{n.title}</b>
                            <span>
                              {n.body ? `${n.body} · ` : ""}
                              {relTime(n.createdAt)}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </ScrollArea>
              </PopoverContent>
            </Popover>
            <button
              type="button"
              className="icon-btn topbar-logout"
              aria-label="Log out"
              title="Log out"
              data-testid="topbar-logout"
              onClick={() => void signOut(false)}
            >
              <Icon name="logout" />
              <span className="topbar-logout-label">Log out</span>
            </button>
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
              <>
                {shouldShowLoadError({ ...orgLoad, loaded: false }, Date.now(), {
                  minFailures: 2,
                }) && (
                  <LoadError
                    title="Can't load your organization yet"
                    failures={orgLoad.last}
                    retrying={orgRetrying}
                    testId="shell-load-error"
                    onRetry={() => {
                      setOrgRetrying(true);
                      void refreshAll().finally(() => setOrgRetrying(false));
                    }}
                  />
                )}
                <ConsoleSkeleton />
              </>
            ) : (
              <div className="view">
                {view !== "overview" && viewMeta && (
                  <section className="console-section-intro">
                    <div className="console-section-copy">
                      <p>{viewMeta.description}</p>
                    </div>
                    <div className="console-section-context" aria-label="Current operating context">
                      <span className="live">
                        <i /> {org?.network?.testnet === false ? "Live" : "Live · testnet"}
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
                    budgetOpsReady={
                      budgetOpsSetup && budgetOpsSetup.orgId === org?.org?.id
                        ? budgetOpsSetup.ready
                        : null
                    }
                    metrics={metrics}
                    decisions={decisions}
                    approvals={approvals}
                    escrows={escrows}
                    policy={policy}
                    refreshProblem={
                      orgLoad.failures >= 2
                        ? { failures: orgLoad.last, lastOkAt: orgLastOkAt.current }
                        : null
                    }
                    refreshing={orgRetrying}
                    onRetryRefresh={() => {
                      setOrgRetrying(true);
                      fastBackoffUntil.current = 0;
                      void refreshAll().finally(() => setOrgRetrying(false));
                    }}
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
                    runs={runs}
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
                  (policy ? (
                    <PolicyView {...shared} policy={policy} />
                  ) : (
                    <PolicyLoader gFetch={gFetch} onLoaded={setPolicy} />
                  ))}
                {view === "waitlist" && waitlistAllowed && (
                  <WaitlistView gFetch={gFetch} setToast={setToast} />
                )}
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
                    onSignOut={(everywhere) => void signOut(everywhere)}
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
          <span className="abi-assistant-fab-mark" aria-hidden="true">
            <ABMark size={18} tone="#fff" />
          </span>
          <span>Ask ABI</span>
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
