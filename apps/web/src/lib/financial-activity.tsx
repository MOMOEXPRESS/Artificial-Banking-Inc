"use client";
import { useState } from "react";
import type { Journal } from "./console-types";
export function FinancialActivity({ journals }: { journals: Journal[] }) {
  const [query, setQuery] = useState("");
  const rows = journals.filter((j) =>
    [j.id, j.memo, j.intentId, ...j.lines.map((l) => l.accountId)]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className="minimal-section abi-transaction-page">
      <h2>Transactions</h2>
      <p>
        Posted ledger movements for the current access scope: funding, allocations, holds, releases
        and payments. Internal allocations are not new income. Mainnet wallet transfers appear in
        the wallet’s on-chain activity.
      </p>
      <label className="abi-transaction-search">
        Search transactions
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Reference, account or description"
        />
      </label>
      <div className="abi-financial-activity">
        {rows.map((j) => (
          <article key={j.id}>
            <div>
              <strong>{j.memo || "Ledger movement"}</strong>
              <small>{new Date(j.createdAt).toLocaleString()}</small>
              <span className="abi-activity-reference">{j.id}</span>
            </div>
            <details>
              <summary>View balanced entries</summary>
              {j.lines.map((l, i) => (
                <p key={i}>
                  <code>{l.accountId}</code>
                  <span>{formatDelta(l.deltaMicro)} USDC</span>
                </p>
              ))}
            </details>
          </article>
        ))}
        {rows.length === 0 && <p>No matching transactions in the loaded history.</p>}
      </div>
    </section>
  );
}
function formatDelta(value: string) {
  try {
    const n = BigInt(value),
      a = n < 0n ? -n : n;
    return `${n < 0n ? "−" : "+"}${a / 1_000_000n}.${(a % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "") || "00"}`;
  } catch {
    return "Unavailable";
  }
}
