/**
 * In-app notification history (the console bell) + notification email.
 *
 * `emitEvent` (webhooks.ts) calls `recordNotification` FIRST for every event,
 * before and independent of webhook fan-out — so an org with no webhook
 * endpoint still gets a notification history. The webhook delivery log stays a
 * developer tool; this table is what people read.
 *
 * Email goes through `sendEmail` (Brevo first when BREVO_API_KEY is set), only
 * for kinds in IMPORTANT_KINDS, to the per-org recipient (defaults to the org
 * owner's email). Keys are never logged.
 */
import { resolveConsoleUrl, sendEmail } from "./platform/email.js";
import { store, type NotificationRow, type NotificationSeverity } from "./store.js";

export type NotificationView = {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  severity: NotificationSeverity;
  ref: string | null;
  createdAt: string;
  readAt: string | null;
};

/** Kinds that also send a notification email. */
export const IMPORTANT_KINDS = new Set<string>([
  "payment.failed",
  "policy.denied",
  "approval.pending",
  "approval.resolved",
  "agent.frozen",
  "compliance.flagged",
  "treasury.move.pending",
  "treasury.drift.detected",
  "treasury.recovery",
  "api_key.revoked",
  "seller.payout_address.changed",
  "merchant.payee_changed",
]);

type Data = Record<string, unknown>;

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") return String(v);
  return undefined;
}

function usd(v: unknown): string | undefined {
  const s = str(v);
  return s ? `$${s}` : undefined;
}

function agentLabel(d: Data): string | undefined {
  const name = str(d.agentName) ?? str(d.name);
  if (name) return name;
  const id = str(d.agentId);
  return id ? `Agent ${id.slice(0, 12)}` : undefined;
}

function join(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(" · ");
}

export type Described = {
  title: string;
  body: string;
  link: string | null;
  severity: NotificationSeverity;
};

/** Deterministic, human copy for an event. Unknown kinds still get a row. */
export function describeEvent(kind: string, raw: unknown): Described {
  const d: Data = raw && typeof raw === "object" ? (raw as Data) : {};
  const amount = usd(d.amountUsdc);
  const dest = str(d.destination);
  const agent = agentLabel(d);
  const reason = str(d.reason);
  const given = { title: str(d.title), body: str(d.body) };
  switch (kind) {
    case "payment.succeeded":
      return {
        title: `Payment sent${amount ? ` · ${amount}` : ""}`,
        body: join(agent, dest && `→ ${dest}`),
        link: "payments",
        severity: "ok",
      };
    case "payment.failed":
      return {
        title: `Payment failed${amount ? ` · ${amount}` : ""}`,
        body: join(agent, dest && `→ ${dest}`, str(d.error) ?? str(d.message) ?? reason),
        link: "payments",
        severity: "bad",
      };
    case "policy.denied":
      return {
        title: given.title ?? `Payment refused${amount ? ` · ${amount}` : ""}`,
        body: given.body ?? join(agent, dest && `→ ${dest}`, str(d.ruleCode) ?? reason),
        link: "payments",
        severity: "warn",
      };
    case "approval.pending":
      return {
        title: `Approval needed${amount ? ` · ${amount}` : ""}`,
        body: join(agent, dest && `→ ${dest}`),
        link: "approvals",
        severity: "warn",
      };
    case "approval.resolved": {
      const status = str(d.status) ?? "resolved";
      const by = str(d.resolvedBy);
      return {
        title: `Approval ${status}`,
        body: join(str(d.approvalId), by && status !== "expired" ? `by ${by}` : undefined),
        link: "approvals",
        severity: status === "approved" ? "ok" : status === "expired" ? "info" : "warn",
      };
    }
    case "approval.vote_refused":
      return {
        title: "Approval vote refused",
        body: join(str(d.approvalId), reason ?? "the requester cannot approve their own payment"),
        link: "approvals",
        severity: "warn",
      };
    case "escrow.locked":
    case "escrow.released":
    case "escrow.refunded":
      return {
        title: `Escrow ${kind.split(".")[1]}${amount ? ` · ${amount}` : ""}`,
        body: join(str(d.escrowId)),
        link: "payments",
        severity: kind === "escrow.refunded" ? "warn" : "info",
      };
    case "agent.frozen":
      return {
        title: given.title ?? `${agent ?? "Agent"} frozen`,
        body: given.body ?? (reason ? `Reason: ${reason}` : ""),
        link: "agents",
        severity: "bad",
      };
    case "agent.unfrozen":
      return {
        title: d.org ? "Organization unfrozen" : `${agent ?? "Agent"} unfrozen`,
        body: "",
        link: "agents",
        severity: "ok",
      };
    case "agent.created":
      return {
        title: `Agent created · ${agent ?? "new agent"}`,
        body: "",
        link: "agents",
        severity: "info",
      };
    case "api_key.created":
      return {
        title: `API key created${agent ? ` · ${agent}` : ""}`,
        body: str(d.via) === "rotate" ? "Key rotated — the previous key stopped working." : "",
        link: "agents",
        severity: "info",
      };
    case "api_key.revoked":
      return {
        title: `API key revoked${agent ? ` · ${agent}` : ""}`,
        body: "The agent can no longer call ABI with that key.",
        link: "agents",
        severity: "warn",
      };
    case "policy.changed":
      return {
        title: "Policy changed",
        body: join(
          str(d.scope) === "agent" ? agent : "Organization policy",
          str(d.action),
          str(d.version),
        ),
        link: "policy",
        severity: "info",
      };
    case "member.invited":
      return {
        title: `Member invited${str(d.role) ? ` · ${str(d.role)}` : ""}`,
        body: join(str(d.email) ?? str(d.name)),
        link: "settings",
        severity: "info",
      };
    case "auth.signin":
      return {
        title: "New sign-in",
        body: join(str(d.email), str(d.userAgent)?.slice(0, 80)),
        link: "settings",
        severity: "info",
      };
    case "playground.run.finished": {
      const status = str(d.status) ?? "finished";
      return {
        title: `Playground run ${status} · ${str(d.title) ?? "mission"}`,
        body: join(agent, usd(d.costUsdc) && `cost ${usd(d.costUsdc)}`),
        link: "playground",
        severity: status === "complete" ? "ok" : status === "failed" ? "bad" : "info",
      };
    }
    case "invoice.created":
    case "invoice.paid":
      return {
        title: `Invoice ${kind.split(".")[1]}${amount ? ` · ${amount}` : ""}`,
        body: join(str(d.counterparty), str(d.invoiceId)),
        link: "invoices",
        severity: kind === "invoice.paid" ? "ok" : "info",
      };
    case "subscription.charged":
      return {
        title: `Subscription charged${amount ? ` · ${amount}` : ""}`,
        body: join(dest),
        link: "payments",
        severity: "info",
      };
    case "compliance.flagged":
      return {
        title: given.title ?? "Compliance flag",
        body: given.body ?? join(dest, reason),
        link: "payments",
        severity: "bad",
      };
    case "treasury.move.pending":
      return {
        title: `Treasury move awaiting approval${amount ? ` · ${amount}` : ""}`,
        body: join(str(d.from), str(d.to) && `→ ${str(d.to)}`),
        link: "treasury",
        severity: "warn",
      };
    case "treasury.move.executed":
      return {
        title: `Treasury move done${amount ? ` · ${amount}` : ""}`,
        body: join(str(d.from), str(d.to) && `→ ${str(d.to)}`),
        link: "treasury",
        severity: "ok",
      };
    case "treasury.onchain_deposit":
      return {
        title: `Deposit received${amount ? ` · ${amount}` : ""}`,
        body: join(str(d.asset), str(d.txHash)),
        link: "treasury",
        severity: "ok",
      };
    case "treasury.recovery":
      return {
        title: given.title ?? "Treasury recovery action",
        body: given.body ?? "",
        link: "treasury",
        severity: "warn",
      };
    case "treasury.drift.detected":
      return {
        title: "Ledger drift detected",
        body: given.body ?? "",
        link: "ledger",
        severity: "bad",
      };
    default:
      return {
        title: given.title ?? kind,
        body: given.body ?? "",
        link: null,
        severity: "info",
      };
  }
}

export function notificationView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    link: row.link,
    severity: row.severity,
    ref: row.ref,
    createdAt: row.createdAt,
    readAt: row.readAt,
  };
}

/* ---- email ---- */

const EMAIL_WINDOW_MS = 60 * 60_000;
const EMAIL_MAX_PER_WINDOW = 20;
const sentLog = new Map<string, number[]>();

function underEmailLimit(orgId: string): boolean {
  const now = Date.now();
  const recent = (sentLog.get(orgId) ?? []).filter((t) => now - t < EMAIL_WINDOW_MS);
  if (recent.length >= EMAIL_MAX_PER_WINDOW) {
    sentLog.set(orgId, recent);
    return false;
  }
  recent.push(now);
  sentLog.set(orgId, recent);
  return true;
}

/** Recipient for an org: explicit setting, else the owner's email. Null = do not send. */
export function notificationRecipient(orgId: string): string | null {
  const settings = store.getNotificationSettings(orgId);
  if (!settings.emailEnabled) return null;
  return settings.email?.trim() || store.getOrgOwnerEmail(orgId);
}

export async function sendNotificationEmail(row: NotificationRow): Promise<boolean> {
  if (!IMPORTANT_KINDS.has(row.kind)) return false;
  const to = notificationRecipient(row.orgId);
  if (!to) return false;
  if (!underEmailLimit(row.orgId)) return false;
  const consoleUrl = resolveConsoleUrl();
  const link =
    consoleUrl.ok && row.link
      ? `${consoleUrl.url.replace(/\/$/, "")}/console?view=${encodeURIComponent(row.link)}`
      : undefined;
  const result = await sendEmail({
    to,
    subject: `[ABI] ${row.title}`,
    text: [
      row.title,
      row.body,
      link && `Open: ${link}`,
      "",
      "You get this because notification email is on for this organization. Change the recipient or turn it off in Settings → Notifications.",
    ]
      .filter((l) => l !== undefined && l !== null)
      .join("\n"),
  });
  if (!result.ok) {
    // Never log the payload or any key — kind + code is enough to debug.
    console.warn(
      JSON.stringify({
        type: "abi.notify.email",
        kind: row.kind,
        orgId: row.orgId,
        ok: false,
        code: result.code,
      }),
    );
  }
  return result.ok;
}

/**
 * Persist a notification for an emitted event. Never throws: a failure here
 * must not block the payment path or webhook fan-out.
 */
export function recordNotification(
  orgId: string,
  kind: string,
  payload: unknown,
): NotificationRow | null {
  try {
    if (payload && typeof payload === "object" && (payload as Data).test === true) return null;
    const d = describeEvent(kind, payload);
    const title = d.title.slice(0, 200);
    const body = d.body.slice(0, 500);
    // notify() and direct emitEvent() calls can describe the same thing twice.
    if (store.hasRecentNotification({ orgId, kind, title, body })) return null;
    const p = payload && typeof payload === "object" ? (payload as Data) : {};
    const ref =
      str(p.approvalId) ??
      str(p.runId) ??
      str(p.intentId) ??
      str(p.agentId) ??
      str(p.sessionKeyId) ??
      null;
    const row = store.createNotification({
      orgId,
      kind,
      title,
      body,
      link: d.link,
      severity: d.severity,
      ref,
    });
    if (IMPORTANT_KINDS.has(kind)) void sendNotificationEmail(row).catch(() => undefined);
    return row;
  } catch (e) {
    console.error("recordNotification failed:", (e as Error).message);
    return null;
  }
}
