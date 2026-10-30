/**
 * Console notification history (bell). Pure helpers so they can be unit
 * tested without a browser; the popover in console/page.tsx renders them.
 *
 * The five live "Needs attention" alerts are computed from current state and
 * stay on top. Below them sits this history, read from
 * GET /v1/guardian/notifications on the fast refresh tier.
 */
export type NotificationItem = {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  severity: "info" | "ok" | "warn" | "bad";
  ref: string | null;
  createdAt: string;
  readAt: string | null;
};

export type NotificationFeed = {
  notifications: NotificationItem[];
  unreadCount: number;
};

export const EMPTY_FEED: NotificationFeed = { notifications: [], unreadCount: 0 };

/** Parse the API body defensively; anything malformed becomes an empty feed. */
export function parseFeed(body: unknown): NotificationFeed {
  if (!body || typeof body !== "object") return EMPTY_FEED;
  const b = body as { notifications?: unknown; unreadCount?: unknown };
  const list = Array.isArray(b.notifications) ? (b.notifications as NotificationItem[]) : [];
  return {
    notifications: list.filter((n) => n && typeof n.id === "number" && typeof n.title === "string"),
    unreadCount: typeof b.unreadCount === "number" ? b.unreadCount : 0,
  };
}

/**
 * A resolved approval replaces its pending row instead of both showing (or
 * the pending one silently vanishing). Rows are newest first.
 */
export function collapseApprovals(items: NotificationItem[]): NotificationItem[] {
  const resolved = new Set(
    items.filter((n) => n.kind === "approval.resolved" && n.ref).map((n) => n.ref as string),
  );
  return items.filter((n) => !(n.kind === "approval.pending" && n.ref && resolved.has(n.ref)));
}

export type ToastSpec = { message: string; kind: "ok" | "err" | "info" };

/** Which new notifications also pop a toast. */
export function toastFor(n: NotificationItem): ToastSpec | null {
  switch (n.kind) {
    case "payment.failed":
      return { message: n.body ? `${n.title} — ${n.body}` : n.title, kind: "err" };
    case "policy.denied":
      return { message: n.body ? `${n.title} — ${n.body}` : n.title, kind: "err" };
    case "approval.pending":
      return { message: n.title, kind: "info" };
    case "approval.resolved":
      return { message: n.title, kind: n.severity === "ok" ? "ok" : "info" };
    default:
      return null;
  }
}

/** What the approval card needs: who, how much, where, and which approval. */
export type ApprovalToastData = {
  approvalId: string | null;
  amount: string | null;
  agent: string | null;
  destination: string | null;
};

/**
 * Approval card data from an `approval.pending` feed row. The API writes
 * `title: "Approval needed · $12"` and `body: "Scout → api.example.com"`,
 * with the approval id in `ref`. Anything missing stays null.
 */
export function approvalToastFrom(n: NotificationItem): ApprovalToastData | null {
  if (n.kind !== "approval.pending") return null;
  const amount = n.title.split("·")[1]?.trim() || null;
  const body = (n.body ?? "").trim();
  let agent: string | null = null;
  let destination: string | null = null;
  if (body.includes("→")) {
    const [left, right] = body.split("→");
    agent = left?.replace(/·\s*$/, "").trim() || null;
    destination = right?.trim() || null;
  } else if (body) {
    agent = body;
  }
  return { approvalId: n.ref, amount, agent, destination };
}

/**
 * New since the last poll. On the first load everything is pre-existing and
 * returns nothing, so a page refresh does not replay old toasts.
 */
export function freshSince(
  items: NotificationItem[],
  lastSeenId: number | null,
): NotificationItem[] {
  if (lastSeenId === null) return [];
  return items.filter((n) => n.id > lastSeenId).sort((a, b) => a.id - b.id);
}

export function maxId(items: NotificationItem[], fallback: number | null): number | null {
  return items.reduce<number | null>((m, n) => (m === null || n.id > m ? n.id : m), fallback);
}

/** Console views a notification may deep-link to; anything else is ignored. */
const VIEWS = new Set([
  "overview",
  "treasury",
  "agents",
  "payments",
  "playground",
  "approvals",
  "invoices",
  "ledger",
  "policy",
  "webhooks",
  "activity",
  "settings",
]);
export function linkView(link: string | null): string | null {
  return link && VIEWS.has(link) ? link : null;
}

export type ApprovalLike = {
  id: string;
  status: string;
  amountUsdc?: string;
  destination?: string;
};

/**
 * Live "Needs attention" replacement for approvals that were pending during
 * this session and are now resolved, so the item changes state in place
 * instead of disappearing.
 */
export function resolvedApprovalAlerts(
  approvals: ApprovalLike[],
  seenPending: Set<string>,
): { id: string; title: string; body: string; tone: "info" | "warn" | "bad" }[] {
  return approvals
    .filter((a) => a.status !== "pending" && seenPending.has(a.id))
    .map((a) => ({
      id: `apr_${a.id}_done`,
      title: `Approval ${a.status}${a.amountUsdc ? ` · $${a.amountUsdc}` : ""}`,
      body: a.destination ? `→ ${a.destination}` : "",
      tone: a.status === "approved" ? "info" : "warn",
    }));
}
