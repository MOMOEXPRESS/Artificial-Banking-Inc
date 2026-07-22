"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { Empty, Stat, fmtUsd, relTime } from "./ui";
import type { Approval, Shared } from "./console-types";
import { Button } from "@/components/ui/button";

if (typeof window !== "undefined") {
  gsap.registerPlugin(Flip);
}

export function Approvals({
  approvals,
  pending,
  busy,
  act,
  gFetch,
  agentName,
  readOnly,
  setView,
}: Shared & { approvals: Approval[]; pending: Approval[] }) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!listRef.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    gsap.from(listRef.current.querySelectorAll(".approval-card"), {
      y: 12,
      opacity: 0,
      stagger: 0.05,
      duration: 0.35,
      ease: "power2.out",
    });
  }, [pending.length]);

  const resolve = (id: string, approve: boolean) => {
    const card = listRef.current?.querySelector(`[data-approval-id="${id}"]`) as HTMLElement | null;
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (card && !reduced) {
      const state = Flip.getState(card);
      gsap.to(card, {
        x: approve ? 40 : -40,
        opacity: 0,
        height: 0,
        marginBottom: 0,
        paddingTop: 0,
        paddingBottom: 0,
        duration: 0.35,
        ease: "power2.in",
        onComplete: () => Flip.from(state, { duration: 0.25, ease: "power1.out" }),
      });
    }
    return act("Approval", async () => {
      const res = await gFetch(`/v1/guardian/approvals/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ approve, resolvedBy: "guardian-web" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(d.error ?? d));
      if (d.pendingQuorum) {
        return d.message ?? `Vote recorded — ${d.have} of ${d.need} guardians.`;
      }
      return approve
        ? "Approved — the payment executed and the agent was told to continue."
        : "Denied — the agent has been told to replan.";
    });
  };

  const history = approvals.filter((a) => a.status !== "pending");
  const approved = history.filter((h) => h.status === "approved").length;

  return (
    <>
      <div className="grid g-4">
        <Stat label="Waiting on you" value={String(pending.length)} foot="agents parked right now" />
        <Stat label="Approved" value={String(approved)} foot="you let these through" />
        <Stat
          label="Denied or expired"
          value={String(history.length - approved)}
          foot="agents replanned without the spend"
        />
        <Stat
          label="Pending value"
          value={fmtUsd(pending.reduce((a, p) => a + Number(p.amountUsdc), 0))}
          foot="awaiting your decision — not reserved yet"
        />
      </div>

      <div className="card fill" style={{ display: "flex", flexDirection: "column" }}>
        <div className="card-head">
          <div>
            <h2>Pending decisions</h2>
            <div className="sub">
              Agents are waiting here. Approving runs the payment; denying makes them replan.
              Funds are not locked until you approve.
            </div>
          </div>
        </div>
        {pending.length === 0 ? (
          <Empty
            icon="shield"
            action={
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <Button type="button" variant="ghost" size="sm" onClick={() => setView("playground")}>
                  Run a playground mission
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setView("policy")}>
                  Adjust threshold in Policy
                </Button>
              </div>
            }
          >
            Inbox zero — nothing is waiting on you. Anything above your ask-me-above band will
            appear here and alert you automatically.
          </Empty>
        ) : (
          <div ref={listRef} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pending.map((a) => (
              <div
                key={a.id}
                data-approval-id={a.id}
                className="card tight approval-card"
                style={{ background: "var(--surface-3)", borderColor: "rgba(251,146,60,0.28)" }}
              >
                <div className="between" style={{ flexWrap: "wrap", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8, marginBottom: 5 }}>
                      <b style={{ fontSize: 15.5 }}>{fmtUsd(a.amountUsdc)}</b>
                      <span className="pill warn">
                        <i /> {a.tool}
                      </span>
                      <span className="pill mute">expires {relTime(a.expiresAt)}</span>
                    </div>
                    <div style={{ fontSize: 12.5 }} className="muted">
                      <b style={{ color: "var(--text-2)" }}>{agentName(a.agentId)}</b> wants to pay{" "}
                      <span className="mono">{a.destination}</span>
                      {a.memo ? ` — “${a.memo}”` : ""}
                    </div>
                    <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
                      Held because: {a.reasons.join("; ")}{" "}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        style={{ marginLeft: 4, height: "auto", padding: "0 4px", fontSize: 11.5 }}
                        onClick={() => setView("policy")}
                      >
                        View / edit policy
                      </Button>
                    </div>
                  </div>
                  <div className="row" style={{ flexWrap: "nowrap" }}>
                    <button disabled={busy || readOnly} onClick={() => void resolve(a.id, true)}>
                      Approve payment
                    </button>
                    <Button variant="destructive"
                      disabled={busy || readOnly}
                      onClick={() => void resolve(a.id, false)}
                    >
                      Deny
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="divider" />
        <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>History</h2>
        {history.length === 0 ? (
          <div className="muted" style={{ fontSize: 12.5 }}>
            No resolved approvals yet.
          </div>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th className="num">Amount</th>
                  <th>Destination</th>
                  <th>Outcome</th>
                  <th>Decided by</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {history.map((a) => (
                  <tr key={a.id}>
                    <td>{agentName(a.agentId)}</td>
                    <td className="num mono">{fmtUsd(a.amountUsdc)}</td>
                    <td className="mono">{a.destination}</td>
                    <td>
                      <span className={`pill ${a.status === "approved" ? "ok" : "bad"}`}>
                        <i /> {a.status}
                      </span>
                    </td>
                    <td className="faint">{a.resolvedBy ?? "—"}</td>
                    <td className="mono faint">{relTime(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
