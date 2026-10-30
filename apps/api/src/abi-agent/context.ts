/**
 * Compact org working-memory snapshot injected into ABI prompts / keyword answers.
 * Facts only — never invents balances.
 */
import { accountId, formatMicroToUsdc } from "@policyvault/common";
import { store } from "../store.js";
import { quietHoursStatus } from "./quiet.js";

export type OrgContext = {
  pendingApprovals: number;
  activeAgents: number;
  vaultUsdc: string;
  hitlAboveUsdc: string;
  perTxMaxUsdc: string;
  dailyMaxUsdc: string;
  quiet: string;
  /** null means reconciliation could not be run; never report that as clean. */
  booksOk: boolean | null;
  /** Roster with live status + stipend (non-archived, max 8). */
  agents?: { name: string; status: string; stipendUsdc: string }[];
  /** Budget envelopes with available balance (active, max 6). */
  budgets?: { name: string; availableUsdc: string }[];
  /** Non-USDC holdings, e.g. "EURC 12.00". */
  holdings?: string[];
  /** Oldest-first summary of what is waiting on the guardian (max 3). */
  pendingTop?: string[];
  /** Policy decisions in the last 24h. */
  last24h?: { allow: number; deny: number; review: number };
  /** Most recent decisions, newest first (max 3). */
  recentDecisions?: string[];
  /** Unread notifications under the bell, and the newest unread warning (if any). */
  unreadNotifications?: number;
  latestAlert?: string;
};

export function buildOrgContext(orgId: string): OrgContext {
  const accounts = store.getAccountMap(orgId);
  const vault = accounts.get(accountId("org", orgId))?.balanceMicro ?? 0n;
  const agents = store.listAgents(orgId).filter((a) => a.status === "active").length;
  const pending = store.listApprovals(orgId, "pending", 50).length;
  const t = store.getPolicyTemplate(orgId);
  const quiet = t.quietHours
    ? quietHoursStatus(t.quietHours)
    : { enabled: false, inQuiet: false, countdown: "—", label: "Quiet hours off", clock: "" };
  let booksOk: boolean | null = null;
  try {
    booksOk = store.reconcileOrg(orgId).ok;
  } catch {
    booksOk = null;
  }
  const accountsAll = accounts;
  const agentNames = new Map<string, string>();
  const roster = store
    .listAgents(orgId)
    .filter((a) => a.status !== "archived")
    .map((a) => {
      agentNames.set(a.id, a.name);
      return {
        name: a.name,
        status: a.status,
        stipendUsdc: formatMicroToUsdc(
          accountsAll.get(accountId("agent", a.id))?.balanceMicro ?? 0n,
        ),
      };
    });
  let budgets: OrgContext["budgets"] = [];
  try {
    budgets = store
      .listDepartments(orgId)
      .filter((d) => d.status === "active")
      .slice(0, 6)
      .map((d) => ({
        name: d.name,
        availableUsdc: formatMicroToUsdc(
          accountsAll.get(accountId("department", d.id))?.balanceMicro ?? 0n,
        ),
      }));
  } catch {
    budgets = [];
  }
  let holdings: string[] = [];
  try {
    holdings = store
      .listOrgAssetHoldings(orgId)
      .filter((h) => h.balanceMicro > 0n && h.asset.symbol !== "USDC")
      .map((h) => `${h.asset.symbol} ${formatMicroToUsdc(h.balanceMicro)}`);
  } catch {
    holdings = [];
  }
  const pendingRows = store.listApprovals(orgId, "pending", 50);
  const pendingTop = pendingRows
    .slice(-3)
    .reverse()
    .map(
      (p) =>
        `$${p.amountUsdc} to ${p.destination} by ${agentNames.get(p.agentId) ?? "an agent"}${
          p.memo ? ` (${p.memo.slice(0, 60)})` : ""
        }`,
    );
  const since = Date.now() - 24 * 3600_000;
  const last24h = { allow: 0, deny: 0, review: 0 };
  let recentDecisions: string[] = [];
  try {
    const decisions = store.listDecisions(orgId, 200);
    for (const d of decisions) {
      if (Date.parse(d.at) < since) continue;
      if (d.outcome === "allow") last24h.allow++;
      else if (d.outcome === "deny") last24h.deny++;
      else last24h.review++;
    }
    recentDecisions = decisions
      .slice(0, 3)
      .map(
        (d) =>
          `${d.outcome} $${d.amountUsdc} to ${d.destination} by ${agentNames.get(d.agentId) ?? "agent"} (${d.at.slice(0, 16).replace("T", " ")} UTC)`,
      );
  } catch {
    recentDecisions = [];
  }
  let unreadNotifications = 0;
  let latestAlert: string | undefined;
  try {
    unreadNotifications = store.countUnreadNotifications(orgId);
    const alert = store
      .listNotifications(orgId, { limit: 20, unreadOnly: true })
      .find((n) => n.severity === "bad" || n.severity === "warn");
    if (alert) latestAlert = `${alert.title}${alert.body ? ` — ${alert.body.slice(0, 100)}` : ""}`;
  } catch {
    unreadNotifications = 0;
  }
  return {
    unreadNotifications,
    latestAlert,
    agents: roster.slice(0, 8),
    budgets,
    holdings,
    pendingTop,
    last24h,
    recentDecisions,
    pendingApprovals: pending,
    activeAgents: agents,
    vaultUsdc: formatMicroToUsdc(vault),
    hitlAboveUsdc: formatMicroToUsdc(t.hitlAboveMicro),
    perTxMaxUsdc: formatMicroToUsdc(t.perTxMaxMicro),
    dailyMaxUsdc: formatMicroToUsdc(t.dailyMaxMicro),
    quiet: quiet.enabled
      ? quiet.inQuiet
        ? `${quiet.label} · ends in ${quiet.countdown} (action: ${t.quietHours?.action ?? "review"})`
        : `${quiet.label} · quiet in ${quiet.countdown}`
      : "Quiet hours off",
    booksOk,
  };
}

export function formatOrgContext(ctx: OrgContext): string {
  const lines = [
    `Vault $${ctx.vaultUsdc} · ${ctx.activeAgents} active agents · ${ctx.pendingApprovals} pending approvals`,
    `Policy bands: ask-me-above $${ctx.hitlAboveUsdc} · per-payment $${ctx.perTxMaxUsdc} · daily $${ctx.dailyMaxUsdc}`,
    `Quiet: ${ctx.quiet}`,
    `Books: ${ctx.booksOk === true ? "clean" : ctx.booksOk === false ? "drift detected" : "unverified"}`,
  ];
  return lines.join("\n");
}

/**
 * Fuller live-state brief for the model prompt (and the "what do you
 * remember?" answer): roster, budgets, holdings, what's waiting and what just
 * happened. Facts only, straight from the store.
 */
export function formatOrgBrief(ctx: OrgContext): string {
  const lines = [formatOrgContext(ctx)];
  if (ctx.holdings?.length) lines.push(`Other holdings: ${ctx.holdings.join(" · ")}`);
  if (ctx.agents?.length) {
    lines.push(
      `Agents: ${ctx.agents.map((a) => `${a.name} (${a.status}, stipend $${a.stipendUsdc})`).join("; ")}`,
    );
  }
  if (ctx.budgets?.length) {
    lines.push(`Budgets: ${ctx.budgets.map((b) => `${b.name} $${b.availableUsdc}`).join("; ")}`);
  }
  if (ctx.pendingTop?.length) lines.push(`Waiting on you: ${ctx.pendingTop.join("; ")}`);
  if (ctx.last24h) {
    const { allow, deny, review } = ctx.last24h;
    lines.push(`Last 24h decisions: ${allow} allowed · ${deny} denied · ${review} sent for review`);
  }
  if (ctx.recentDecisions?.length) lines.push(`Latest: ${ctx.recentDecisions.join("; ")}`);
  if (ctx.unreadNotifications) {
    lines.push(
      `Unread notifications: ${ctx.unreadNotifications}${ctx.latestAlert ? ` · newest warning: ${ctx.latestAlert}` : ""}`,
    );
  }
  return lines.join("\n");
}

/** Live brief for prompts; degrades to the short form if a lookup fails. */
export function buildOrgBriefSafe(orgId: string): string {
  const ctx = buildOrgContext(orgId);
  try {
    return formatOrgBrief(ctx);
  } catch {
    return formatOrgContext(ctx);
  }
}
