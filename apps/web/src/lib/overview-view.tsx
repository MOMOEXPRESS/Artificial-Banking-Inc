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
  const activeAgents = (org?.agents ?? []).filter((agent) => agent.status !== "frozen").length;
  const isLive = org?.ledgerMode === "live";
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
    <div className="ops-overview">
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
          <Button variant="secondary" onClick={() => setView("agents")}>
            <Icon name="robot" size={14} /> View agents
          </Button>
          <Button onClick={() => setView("treasury", "move")}>
            <Icon name="swap" size={14} /> Move funds
          </Button>
        </div>
      </section>

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

      <section className="ops-workspace">
        <div className="ops-main-column">
          <div className="ops-section-head">
            <div>
              <h3>Requires attention</h3>
              <p>Exceptions and controls that need a human decision.</p>
            </div>
            {pending.length > 0 && (
              <Button variant="bare" size="sm" onClick={() => setView("approvals")}>
                View approvals <Icon name="arrowRight" size={13} />
              </Button>
            )}
          </div>

          <div className="ops-attention-list">
            {attentionItems.length ? (
              attentionItems.map((item) => (
                <button
                  type="button"
                  className="ops-attention-row"
                  key={item.id}
                  onClick={item.onOpen}
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
              ))
            ) : (
              <div className="ops-clear-state">
                <span>
                  <Icon name="check" size={16} />
                </span>
                <div>
                  <b>Everything is under control</b>
                  <p>No approvals, reconciliation drift, or failed deliveries need attention.</p>
                </div>
              </div>
            )}
          </div>

          <div className="ops-section-head ops-activity-head">
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
