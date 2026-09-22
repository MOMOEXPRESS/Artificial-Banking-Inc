"use client";

import { Empty, Stat, fmtTime, fmtUsd } from "./ui";
import type { Journal, Metrics, Recon } from "./console-types";

export function Ledger({
  journals,
  metrics,
  recon,
}: {
  journals: Journal[];
  metrics: Metrics | null;
  recon: Recon | null;
}) {
  const short = (id: string) =>
    id.replace(/^org:[^:]+:/, "treasury ").replace(/^agent:/, "").replace(/^escrow:/, "escrow ");
  const delta = (m: string) => {
    const n = Number(m) / 1e6;
    return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
  };

  return (
    <div className="console-page ledger-page">
      <div className="grid g-4">
        <Stat label="Journal entries" value={String(metrics?.journals ?? 0)} foot="every balanced movement" />
        <Stat label="In escrow" value={fmtUsd(metrics?.balancesUsdc?.escrow ?? "0")} foot="locked between agents" />
        <Stat label="In flight" value={fmtUsd(metrics?.balancesUsdc?.agentHeld ?? "0")} foot="held mid-payment" />
        <Stat
          label="Reconciliation"
          value={recon?.ok ? "Clean" : "DRIFT"}
          foot={`${recon?.journalsReplayed ?? 0} entries replayed · ${recon?.accountsChecked ?? 0} accounts`}
          delta={recon?.ok ? { dir: "up", text: "0 drift" } : { dir: "down", text: `${recon?.drift.length} bad` }}
        />
      </div>

      <div className="card fill" style={{ display: "flex", flexDirection: "column" }}>
        <div className="card-head">
          <div>
            <h2>Double-entry journal</h2>
            <div className="sub">
              The source of truth. Every entry sums to zero; a watchdog replays all of them each
              minute and screams if a cent is off.
            </div>
          </div>
        </div>
        {journals.length === 0 ? (
          <Empty icon="book">No entries yet.</Empty>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Entry</th>
                  <th>Movements</th>
                </tr>
              </thead>
              <tbody>
                {journals.map((j) => (
                  <tr key={j.id} className="ledger-row">
                    <td className="mono faint ledger-ts">{fmtTime(j.createdAt)}</td>
                    <td>
                      <span className="pill mute ledger-memo">{j.memo}</span>
                    </td>
                    <td className="wrap ledger-lines">
                      {j.lines.map((l, i) => (
                        <span key={i} className="mono ledger-line" style={{ marginRight: 16, whiteSpace: "nowrap" }}>
                          <span className="muted">{short(l.accountId)}</span>{" "}
                          <b className={Number(l.deltaMicro) >= 0 ? "ledger-credit" : "ledger-debit"}>
                            {delta(l.deltaMicro)}
                          </b>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

