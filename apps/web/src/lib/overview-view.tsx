"use client";

import { useMemo } from "react";
import type { InvoiceStats, Summary } from "./views";
import { BarLine, Empty, Icon, fmtTime, fmtUsd } from "./ui";
import type { Alert, Approval, Decision, Escrow, Metrics, Session, Shared } from "./console-types";
import type { Policy } from "./policy-view";
import { Button } from "@/components/ui/button";

export function Overview({
  org,
  metrics,
  decisions,
  approvals,
  policy,
  agentName,
  setView,
  alerts,
  readOnly,
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
  const orgAvailable =
    org?.balances.find((balance) => balance.kind === "org_available")?.usdc ?? "0";
  const agentAvailable = metrics?.balancesUsdc?.agentAvailable ?? "0";
  const held = metrics?.balancesUsdc?.escrow ?? "0";
  const pending = useMemo(
    () => approvals.filter((approval) => approval.status === "pending"),
    [approvals],
  );
  const recentDecisions = useMemo(
    () =>
      [...decisions]
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 8),
    [decisions],
  );
  const spendingDays = useMemo(() => {
    const byDay = new Map<string, { amount: number; count: number }>();
    for (const decision of decisions) {
      if (decision.outcome !== "allow") continue;
      const at = new Date(decision.at);
      if (Number.isNaN(at.getTime())) continue;
      const key = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(
        at.getDate(),
      ).padStart(2, "0")}`;
      const current = byDay.get(key) ?? { amount: 0, count: 0 };
      current.amount += Number(decision.amountUsdc) || 0;
      current.count += 1;
      byDay.set(key, current);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() - 28);
    const days = Array.from({ length: 35 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate(),
      ).padStart(2, "0")}`;
      return {
        key,
        date,
        isFuture: date.getTime() > today.getTime(),
        ...(byDay.get(key) ?? { amount: 0, count: 0 }),
      };
    });
    const max = Math.max(1, ...days.map((day) => day.amount));
    return days.map((day) => ({
      ...day,
      level: day.amount === 0 ? 0 : Math.max(1, Math.ceil((day.amount / max) * 4)),
    }));
  }, [decisions]);
  const recentSpendDays = useMemo(
    () =>
      spendingDays
        .filter((day) => !day.isFuture)
        .slice(-7)
        .reverse(),
    [spendingDays],
  );
  const sevenDaySpend = recentSpendDays.reduce((sum, day) => sum + day.amount, 0);
  const activeAgents = (org?.agents ?? []).filter((agent) => agent.status !== "frozen").length;
  const isLive = org?.ledgerMode === "live";
  const actorRole = org?.actor?.role ?? "owner";
  const attentionItems = useMemo(() => {
    const approvalItems = pending.slice(0, 3).map((approval) => ({
      id: approval.id,
      icon: "check",
      title: `${agentName(approval.agentId)} needs approval`,
      body: `${fmtUsd(approval.amountUsdc)} to ${approval.destination.replace(/^https?:\/\//, "").slice(0, 36)}`,
      tone: "warn" as const,
      onOpen: () => setView("approvals"),
    }));
    const alertItems = alerts
      .filter((alert) => alert.kind !== "approval")
      .slice(0, Math.max(0, 4 - approvalItems.length))
      .map((alert) => ({
        id: alert.id,
        icon: alert.kind === "drift" ? "alert" : "zap",
        title: alert.title,
        body: alert.body,
        tone: alert.tone,
        onOpen: () => setView(alert.goto),
      }));
    return [...approvalItems, ...alertItems];
  }, [agentName, alerts, pending, setView]);

  return (
    <div className={`ops-overview ${attentionItems.length ? "has-priority" : "is-clear"}`}>
      <section className="ops-page-intro">
        <div>
          <div className="ops-eyebrow">Financial control center</div>
          <h2>Keep every agent inside policy.</h2>
          <p>
            Monitor balances, resolve exceptions, and review every financial decision from one
            place.
          </p>
        </div>
        <div className="ops-page-actions">
          {actorRole === "approver" ? (
            <>
              <Button variant="secondary" onClick={() => setView("activity")}>
                <Icon name="list" size={14} /> Review activity
              </Button>
              <Button onClick={() => setView("approvals")}>
                <Icon name="check" size={14} /> Open approvals
              </Button>
            </>
          ) : readOnly ? (
            <>
              <Button variant="secondary" onClick={() => setView("agents")}>
                <Icon name="robot" size={14} /> View agents
              </Button>
              <Button onClick={() => setView("activity")}>
                <Icon name="list" size={14} /> View activity
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setView("agents")}>
                <Icon name="robot" size={14} /> View agents
              </Button>
              <Button onClick={() => setView("treasury", "move")}>
                <Icon name="swap" size={14} /> Move funds
              </Button>
            </>
          )}
        </div>
      </section>

      {attentionItems.length > 0 && (
        <section className="ops-priority" aria-labelledby="ops-priority-title">
          <div className="ops-priority-lead">
            <span className="ops-priority-kicker">
              <i /> Action required
            </span>
            <h3 id="ops-priority-title">
              {attentionItems.length} {attentionItems.length === 1 ? "item needs" : "items need"}{" "}
              your attention
            </h3>
            <p>Resolve the most urgent financial exceptions before they interrupt agent work.</p>
          </div>
          <div className="ops-priority-list">
            {attentionItems.map((item, index) => (
              <button
                type="button"
                className="ops-priority-row"
                key={item.id}
                onClick={item.onOpen}
                style={{ animationDelay: `${120 + index * 70}ms` }}
              >
                <span className={`ops-attention-icon ${item.tone}`}>
                  <Icon name={item.icon} size={15} />
                </span>
                <span className="ops-attention-copy">
                  <b>{item.title}</b>
                  <span>{item.body}</span>
                </span>
                <span className="ops-row-action">
                  Review <Icon name="arrowRight" size={13} />
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="ops-balance-strip" aria-label="Balance summary">
        <div className="ops-primary-balance">
          <span>Available treasury</span>
          <strong>{fmtUsd(orgAvailable)}</strong>
          <small>{isLive ? "Backed by the connected vault" : "Sandbox balance"}</small>
        </div>
        <div className="ops-balance-metric">
          <span>Allocated to agents</span>
          <b>{fmtUsd(agentAvailable)}</b>
          <small>
            {activeAgents} active {activeAgents === 1 ? "agent" : "agents"}
          </small>
        </div>
        <div className="ops-balance-metric">
          <span>Held in escrow</span>
          <b>{fmtUsd(held)}</b>
          <small>Protected until completion</small>
        </div>
        <div className="ops-balance-metric">
          <span>Pending approval</span>
          <b>{pending.length}</b>
          <small>{pending.length ? "Requires your attention" : "Nothing waiting"}</small>
        </div>
      </section>

      <section className="ops-spending" aria-labelledby="ops-spending-title">
        <div className="ops-spending-head">
          <div>
            <div className="ops-eyebrow">Spending rhythm</div>
            <h3 id="ops-spending-title">Daily agent spend</h3>
            <p>Approved spend by day, paired with a precise seven-day operating table.</p>
          </div>
          <div className="ops-spending-total">
            <span>Last 7 days</span>
            <b>{fmtUsd(sevenDaySpend)}</b>
            <small>
              {recentSpendDays.reduce((sum, day) => sum + day.count, 0)} approved transactions
            </small>
          </div>
        </div>
        <div className="ops-spending-body">
          <div className="ops-spend-calendar" aria-label="Five-week daily spending calendar">
            <div className="ops-calendar-weekdays" aria-hidden>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="ops-calendar-grid">
              {spendingDays.map((day) => (
                <div
                  key={day.key}
                  className={`ops-calendar-day level-${day.level} ${day.isFuture ? "future" : ""}`}
                  title={`${day.date.toLocaleDateString(undefined, {
                    month: "long",
                    day: "numeric",
                  })}: ${fmtUsd(day.amount)} across ${day.count} transactions`}
                >
                  <span>{day.date.getDate()}</span>
                  {!day.isFuture && <b>{day.amount ? fmtUsd(day.amount) : "—"}</b>}
                </div>
              ))}
            </div>
            <div className="ops-calendar-legend">
              <span>Less</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <i key={level} className={`level-${level}`} />
              ))}
              <span>More</span>
            </div>
          </div>
          <div className="ops-spend-table-wrap">
            <table className="ops-spend-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Activity</th>
                  <th className="num">Spend</th>
                </tr>
              </thead>
              <tbody>
                {recentSpendDays.map((day) => (
                  <tr key={day.key}>
                    <td>
                      <b>{day.date.toLocaleDateString(undefined, { weekday: "short" })}</b>
                      <span>
                        {day.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </td>
                    <td>
                      <span className="ops-spend-count">
                        {day.count || "No"} {day.count === 1 ? "payment" : "payments"}
                      </span>
                    </td>
                    <td className="num mono">
                      <b>{fmtUsd(day.amount)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="ops-workspace">
        <div className="ops-main-column">
          {attentionItems.length === 0 && (
            <div className="ops-clear-state ops-clear-banner">
              <span>
                <Icon name="check" size={16} />
              </span>
              <div>
                <b>Everything is under control</b>
                <p>No approvals, reconciliation drift, or failed deliveries need attention.</p>
              </div>
            </div>
          )}

          <div className={`ops-section-head ${attentionItems.length ? "" : "ops-activity-head"}`}>
            <div>
              <h3>Recent activity</h3>
              <p>A live record of agent payment decisions.</p>
            </div>
            <Button variant="bare" size="sm" onClick={() => setView("activity")}>
              View all <Icon name="arrowRight" size={13} />
            </Button>
          </div>

          <div className="ops-table-wrap">
            {recentDecisions.length ? (
              <table className="ops-activity-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Destination</th>
                    <th>Status</th>
                    <th>Time</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recentDecisions.map((decision) => (
                    <tr key={`${decision.intentId}-${decision.at}`}>
                      <td>
                        <b>{agentName(decision.agentId)}</b>
                      </td>
                      <td>
                        <span className="ops-destination">
                          {decision.destination.replace(/^https?:\/\//, "").slice(0, 34)}
                        </span>
                      </td>
                      <td>
                        <span className={`ops-status ${decision.outcome}`}>
                          <i /> {decision.outcome === "review" ? "Needs review" : decision.outcome}
                        </span>
                      </td>
                      <td className="muted">{fmtTime(decision.at)}</td>
                      <td className="num mono">
                        <b>{fmtUsd(decision.amountUsdc)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty icon="list">
                No financial activity yet. Run an agent payment from the Playground to see the
                policy trail here.
              </Empty>
            )}
          </div>
        </div>

        <aside className="ops-side-column">
          <div className="ops-side-section">
            <div className="ops-section-head compact">
              <div>
                <h3>Budget health</h3>
                <p>{fmtUsd(policy?.dailyMaxUsdc)}/agent daily cap</p>
              </div>
              <button
                type="button"
                className="ops-icon-link"
                onClick={() => setView("policy")}
                aria-label="Open policies"
              >
                <Icon name="sliders" size={15} />
              </button>
            </div>
            <div className="ops-budget-list">
              {(org?.agents ?? []).slice(0, 5).map((agent) => (
                <button
                  type="button"
                  className="ops-budget-row"
                  key={agent.id}
                  onClick={() => setView("agents")}
                >
                  <span className="ops-agent-avatar">{agent.name.slice(0, 2).toUpperCase()}</span>
                  <span className="ops-budget-copy">
                    <span>
                      <b>{agent.name}</b>
                      <small>{fmtUsd(agent.spent24hUsdc)} spent today</small>
                    </span>
                    <BarLine
                      value={Number(agent.spent24hUsdc)}
                      max={Number(org?.dailyMaxUsdc ?? 1)}
                    />
                  </span>
                </button>
              ))}
              {(org?.agents ?? []).length === 0 && (
                <div className="ops-mini-empty">Create an agent to begin assigning budgets.</div>
              )}
            </div>
          </div>

          <div className="ops-side-section ops-policy-summary">
            <div className="ops-section-head compact">
              <div>
                <h3>Policy engine</h3>
                <p>Deterministic controls are active</p>
              </div>
              <span className="ops-live-dot">
                <i /> Active
              </span>
            </div>
            <dl>
              <div>
                <dt>Allowed</dt>
                <dd>{metrics?.decisions?.allow ?? 0}</dd>
              </div>
              <div>
                <dt>Sent for review</dt>
                <dd>{metrics?.decisions?.review ?? 0}</dd>
              </div>
              <div>
                <dt>Blocked</dt>
                <dd>{metrics?.decisions?.deny ?? 0}</dd>
              </div>
            </dl>
            <Button variant="secondary" size="sm" onClick={() => setView("policy")}>
              Manage policies
            </Button>
          </div>
        </aside>
      </section>
    </div>
  );
}
