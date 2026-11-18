"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { workspaceJson, type Workspace, type WorkspaceFetcher } from "./workspace-client";
type Payment = {
  agentId: string;
  at: string;
  agentName: string;
  tool: string;
  amountUsdc: string;
  destination: string;
  outcome: string;
  settlementState?: string;
};
export function CardActivity({
  workspace,
  gFetch,
}: {
  workspace: Workspace;
  gFetch: WorkspaceFetcher;
}) {
  const [rows, setRows] = useState<Payment[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    void gFetch("/v1/guardian/payments/recent", { headers: { "x-abi-workspace": workspace.id } })
      .then(workspaceJson)
      .then((d) => {
        if (live)
          setRows(
            (d.payments ?? []).filter((p: Payment) =>
              workspace.connections.some((c) => c.agentId === p.agentId),
            ),
          );
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [gFetch, workspace.id, workspace.connections, revision]);
  return (
    <section className="minimal-section">
      <div className="minimal-section-heading">
        <div>
          <h2>Activity</h2>
          <p>Recent payments from this workspace’s connected agents.</p>
        </div>
        <Button variant="ghost" disabled={loading} onClick={() => setRevision((v) => v + 1)}>
          Refresh
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading activity…</p>}
      {!loading && !error && !rows.length && (
        <div className="abi-card-empty">
          <h3>No activity yet</h3>
          <p>This card’s payments will appear here.</p>
        </div>
      )}
      <div className="abi-financial-activity">
        {rows.map((r, i) => (
          <article key={`${r.at}:${i}`}>
            <strong>
              {r.amountUsdc} USDC · {r.agentName}
            </strong>
            <p>{r.destination}</p>
            <small>
              {new Date(r.at).toLocaleString()} · {r.settlementState ?? r.outcome} · {r.tool}
            </small>
          </article>
        ))}
      </div>
    </section>
  );
}
