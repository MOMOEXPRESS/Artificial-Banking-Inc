import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collapseApprovals,
  freshSince,
  linkView,
  maxId,
  parseFeed,
  resolvedApprovalAlerts,
  toastFor,
  type NotificationItem,
} from "./notifications-feed";

const item = (
  id: number,
  kind: string,
  extra: Partial<NotificationItem> = {},
): NotificationItem => ({
  id,
  kind,
  title: `${kind} ${id}`,
  body: "",
  link: null,
  severity: "info",
  ref: null,
  createdAt: new Date().toISOString(),
  readAt: null,
  ...extra,
});

describe("notifications feed", () => {
  it("parses defensively", () => {
    assert.deepEqual(parseFeed(null), { notifications: [], unreadCount: 0 });
    assert.equal(parseFeed({ error: { code: "X" } }).notifications.length, 0);
    const f = parseFeed({ notifications: [item(1, "a"), { bogus: true }], unreadCount: 3 });
    assert.equal(f.notifications.length, 1);
    assert.equal(f.unreadCount, 3);
  });

  it("a resolved approval replaces its pending row", () => {
    const rows = [
      item(3, "approval.resolved", { ref: "apr_1" }),
      item(2, "approval.pending", { ref: "apr_2" }),
      item(1, "approval.pending", { ref: "apr_1" }),
    ];
    assert.deepEqual(
      collapseApprovals(rows).map((r) => r.id),
      [3, 2],
    );
  });

  it("toasts failed payments, refusals and approvals only", () => {
    assert.equal(toastFor(item(1, "payment.failed"))?.kind, "err");
    assert.equal(toastFor(item(1, "policy.denied"))?.kind, "err");
    assert.equal(toastFor(item(1, "approval.pending"))?.kind, "info");
    assert.equal(toastFor(item(1, "approval.resolved", { severity: "ok" }))?.kind, "ok");
    assert.equal(
      toastFor(item(1, "approval.resolved", { title: "Approval expired" }))?.message,
      "Approval expired",
    );
    assert.equal(toastFor(item(1, "agent.created")), null);
  });

  it("first load never replays old notifications", () => {
    const rows = [item(5, "a"), item(4, "b")];
    assert.deepEqual(freshSince(rows, null), []);
    assert.deepEqual(
      freshSince(rows, 4).map((r) => r.id),
      [5],
    );
    assert.equal(maxId(rows, null), 5);
    assert.equal(maxId([], 7), 7);
  });

  it("only links to known console views", () => {
    assert.equal(linkView("payments"), "payments");
    assert.equal(linkView("javascript:alert(1)"), null);
    assert.equal(linkView(null), null);
  });

  it("turns a resolved approval into a live item instead of dropping it", () => {
    const out = resolvedApprovalAlerts(
      [
        { id: "a1", status: "expired", amountUsdc: "5" },
        { id: "a2", status: "pending" },
        { id: "a3", status: "approved" },
      ],
      new Set(["a1", "a2"]),
    );
    assert.deepEqual(
      out.map((o) => o.id),
      ["apr_a1_done"],
    );
    assert.equal(out[0]!.title, "Approval expired · $5");
  });
});
