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
  booksOk: boolean;
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
  let booksOk = true;
  try {
    booksOk = store.reconcileOrg(orgId).ok;
  } catch {
    booksOk = true;
  }
  return {
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
  return [
    `Vault $${ctx.vaultUsdc} · ${ctx.activeAgents} active agents · ${ctx.pendingApprovals} pending approvals`,
    `Policy bands: ask-me-above $${ctx.hitlAboveUsdc} · per-payment $${ctx.perTxMaxUsdc} · daily $${ctx.dailyMaxUsdc}`,
    `Quiet: ${ctx.quiet}`,
    `Books: ${ctx.booksOk ? "clean" : "drift detected"}`,
  ].join("\n");
}
