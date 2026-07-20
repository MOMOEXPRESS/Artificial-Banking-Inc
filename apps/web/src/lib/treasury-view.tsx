"use client";

import { useCallback, useEffect, useState } from "react";
import { Empty, Icon } from "./ui";

type Scope = "org" | "department" | "agent" | "shared";

type WalletRow = {
  scope: Scope;
  id: string;
  name: string;
  status?: string;
  availableUsdc: string;
  heldUsdc: string;
  memberAgentIds?: string[];
  vaultAddress?: string;
};

type WalletsPayload = {
  asset: { id: string; symbol: string; decimals: number; chain: string; contract: string | null };
  org: WalletRow;
  departments: WalletRow[];
  agents: WalletRow[];
  shared: WalletRow[];
};

type MoveRow = {
  id: string;
  from: { scope: Scope; id: string };
  to: { scope: Scope; id: string };
  amountUsdc: string;
  status: string;
  votes: string[];
  createdAt: string;
};

type Cashflow = {
  days: number;
  series: { day: string; inflowUsdc: string; outflowUsdc: string; netUsdc: string; journals: number }[];
  totals: { inflowUsdc: string; outflowUsdc: string; netUsdc: string };
};

type Forecast = {
  totalLiquidUsdc: string;
  orgAvailableUsdc: string;
  deptAvailableUsdc: string;
  sharedAvailableUsdc: string;
  agentAvailableUsdc: string;
  avgDailySpendUsdc: string;
  openInvoicesUsdc: string;
  runwayDays: number | null;
  projectedLiquidIn30dUsdc: string;
  note: string;
};

function fmt(u?: string) {
  if (!u) return "$0";
  const n = Number(u);
  if (Number.isNaN(n)) return `$${u}`;
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function TreasuryView({
  gFetch,
  busy,
  act,
  readOnly = false,
}: {
  gFetch: (path: string, init?: RequestInit) => Promise<Response>;
  busy: boolean;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  readOnly?: boolean;
}) {
  const locked = busy || readOnly;
  const [wallets, setWallets] = useState<WalletsPayload | null>(null);
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [cashflow, setCashflow] = useState<Cashflow | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [recovery, setRecovery] = useState<{ vaultAddress?: string; events: { id: string; kind: string; note?: string; at: string }[] } | null>(null);
  const [tab, setTab] = useState<"wallets" | "move" | "cashflow" | "forecast" | "recovery">("wallets");

  const [deptName, setDeptName] = useState("");
  const [sharedName, setSharedName] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [depositAmt, setDepositAmt] = useState("");

  const refresh = useCallback(async () => {
    const [w, m, c, f, r] = await Promise.all([
      gFetch("/v1/guardian/wallets").then((x) => x.json()),
      gFetch("/v1/guardian/treasury/moves").then((x) => x.json()),
      gFetch("/v1/guardian/treasury/cashflow?days=30").then((x) => x.json()),
      gFetch("/v1/guardian/treasury/forecast").then((x) => x.json()),
      gFetch("/v1/guardian/treasury/recovery").then((x) => x.json()),
    ]);
    setWallets(w);
    setMoves(m.moves ?? []);
    setCashflow(c);
    setForecast(f.forecast ?? null);
    setRecovery(r);
  }, [gFetch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const allTargets: { key: string; label: string; ref: { scope: Scope; id: string } }[] = [];
  if (wallets) {
    allTargets.push({
      key: `org:${wallets.org.id}`,
      label: `Org · ${fmt(wallets.org.availableUsdc)}`,
      ref: { scope: "org", id: wallets.org.id },
    });
    for (const d of wallets.departments) {
      allTargets.push({
        key: `department:${d.id}`,
        label: `Dept ${d.name} · ${fmt(d.availableUsdc)}`,
        ref: { scope: "department", id: d.id },
      });
    }
    for (const a of wallets.agents) {
      allTargets.push({
        key: `agent:${a.id}`,
        label: `Agent ${a.name} · ${fmt(a.availableUsdc)}`,
        ref: { scope: "agent", id: a.id },
      });
    }
    for (const s of wallets.shared) {
      allTargets.push({
        key: `shared:${s.id}`,
        label: `Shared ${s.name} · ${fmt(s.availableUsdc)}`,
        ref: { scope: "shared", id: s.id },
      });
    }
  }

  return (
    <div className="view stack gap-lg">
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Treasury</h2>
            <p className="muted">
              Organization, department, agent, and shared wallets ·{" "}
              {wallets?.asset.symbol ?? "USDC"} on {wallets?.asset.chain ?? "base-sepolia"}
            </p>
          </div>
          <div className="row gap-sm">
            {(
              [
                ["wallets", "Wallets"],
                ["move", "Move"],
                ["cashflow", "Cash flow"],
                ["forecast", "Forecast"],
                ["recovery", "Recovery"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                className={`ghost sm ${tab === k ? "active" : ""}`}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === "wallets" && (
        <>
          <div className="stat-grid">
            <Stat label="Liquid total" value={fmt(forecast?.totalLiquidUsdc)} foot="org + dept + shared + agents" />
            <Stat label="Org treasury" value={fmt(wallets?.org.availableUsdc)} foot={wallets?.org.vaultAddress?.slice(0, 10)} />
            <Stat label="Departments" value={fmt(forecast?.deptAvailableUsdc)} foot={`${wallets?.departments.length ?? 0} wallets`} />
            <Stat label="Shared" value={fmt(forecast?.sharedAvailableUsdc)} foot={`${wallets?.shared.length ?? 0} wallets`} />
          </div>

          <div className="card-grid-2">
            <div className="panel">
              <div className="panel-head">
                <h3>Departments</h3>
              </div>
              <div className="row gap-sm" style={{ marginBottom: 12 }}>
                <input
                  value={deptName}
                  onChange={(e) => setDeptName(e.target.value)}
                  placeholder="Engineering"
                />
                <button
                  className="primary sm"
                  disabled={!deptName.trim() || busy}
                  onClick={() =>
                    void act("Create department", async () => {
                      const res = await gFetch("/v1/guardian/departments", {
                        method: "POST",
                        body: JSON.stringify({ name: deptName.trim() }),
                      });
                      const j = await res.json();
                      if (!res.ok) throw new Error(j.error?.message ?? "Failed");
                      setDeptName("");
                      return `Department ${j.department.name} created`;
                    })
                  }
                >
                  Create
                </button>
              </div>
              {(wallets?.departments.length ?? 0) === 0 ? (
                <Empty>No departments yet — create one to allocate budgets by team.</Empty>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Available</th>
                      <th>Held</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wallets!.departments.map((d) => (
                      <tr key={d.id}>
                        <td>{d.name}</td>
                        <td className="mono">{fmt(d.availableUsdc)}</td>
                        <td className="mono muted">{fmt(d.heldUsdc)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="panel">
              <div className="panel-head">
                <h3>Shared wallets</h3>
              </div>
              <div className="row gap-sm" style={{ marginBottom: 12 }}>
                <input
                  value={sharedName}
                  onChange={(e) => setSharedName(e.target.value)}
                  placeholder="Ops pool"
                />
                <button
                  className="primary sm"
                  disabled={!sharedName.trim() || busy}
                  onClick={() =>
                    void act("Create shared wallet", async () => {
                      const res = await gFetch("/v1/guardian/shared-wallets", {
                        method: "POST",
                        body: JSON.stringify({ name: sharedName.trim(), memberAgentIds: [] }),
                      });
                      const j = await res.json();
                      if (!res.ok) throw new Error(j.error?.message ?? "Failed");
                      setSharedName("");
                      return `Shared wallet ${j.wallet.name} created`;
                    })
                  }
                >
                  Create
                </button>
              </div>
              {(wallets?.shared.length ?? 0) === 0 ? (
                <Empty>No shared wallets yet — pool funds for multiple agents.</Empty>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Available</th>
                      <th>Members</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wallets!.shared.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td className="mono">{fmt(s.availableUsdc)}</td>
                        <td className="muted">{s.memberAgentIds?.length ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Agent wallets</h3>
            </div>
            <table className="data">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Available</th>
                  <th>Held</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(wallets?.agents ?? []).map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td className="mono">{fmt(a.availableUsdc)}</td>
                    <td className="mono muted">{fmt(a.heldUsdc)}</td>
                    <td>{a.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "move" && (
        <div className="card-grid-2">
          <div className="panel">
            <div className="panel-head">
              <h3>Move funds</h3>
              <p className="muted">Any scope → any scope. Large moves require multi-guardian approval.</p>
            </div>
            <label className="field">
              <span>From</span>
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">Select wallet</option>
                {allTargets.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>To</span>
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Select wallet</option>
                {allTargets
                  .filter((t) => t.key !== from)
                  .map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Amount (USDC)</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25" />
            </label>
            <button
              className="primary"
              disabled={!from || !to || !amount.trim() || busy}
              onClick={() =>
                void act("Move funds", async () => {
                  const f = allTargets.find((t) => t.key === from)!;
                  const t = allTargets.find((x) => x.key === to)!;
                  const res = await gFetch("/v1/guardian/wallets/move", {
                    method: "POST",
                    body: JSON.stringify({
                      from: f.ref,
                      to: t.ref,
                      amountUsdc: amount.trim(),
                      memo: "console_move",
                    }),
                  });
                  const j = await res.json();
                  if (!res.ok) throw new Error(j.error?.message ?? "Move failed");
                  setAmount("");
                  return j.outcome === "review"
                    ? "Parked for multi-guardian approval"
                    : `Moved ${amount} USDC`;
                })
              }
            >
              <Icon name="swap" size={14} /> Execute move
            </button>

            <div className="divider" />
            <label className="field">
              <span>Deposit into org treasury</span>
              <input value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} placeholder="100" />
            </label>
            <button
              className="ghost"
              disabled={!depositAmt.trim() || busy}
              onClick={() =>
                void act("Deposit", async () => {
                  const res = await gFetch("/v1/guardian/treasury/deposit", {
                    method: "POST",
                    body: JSON.stringify({ amountUsdc: depositAmt.trim() }),
                  });
                  const j = await res.json();
                  if (!res.ok) throw new Error(j.error?.message ?? "Deposit failed");
                  setDepositAmt("");
                  return `Deposited ${j.amountUsdc} USDC`;
                })
              }
            >
              Record deposit
            </button>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Pending / recent moves</h3>
            </div>
            {moves.length === 0 ? (
              <Empty>No treasury moves yet across org, dept, shared, and agent wallets.</Empty>
            ) : (
              <ul className="stack gap-sm">
                {moves.slice(0, 12).map((m) => (
                  <li key={m.id} className="list-row">
                    <div>
                      <b className="mono">{fmt(m.amountUsdc)}</b>
                      <div className="muted sm">
                        {m.from.scope}:{m.from.id.slice(0, 8)} → {m.to.scope}:{m.to.id.slice(0, 8)}
                      </div>
                    </div>
                    <div className="row gap-sm">
                      <span className={`pill ${m.status === "executed" ? "ok" : m.status === "pending" ? "warn" : ""}`}>
                        {m.status}
                      </span>
                      {m.status === "pending" && (
                        <button
                          className="primary sm"
                          disabled={locked}
                          onClick={() =>
                            void act("Approve move", async () => {
                              const res = await gFetch(`/v1/guardian/treasury/moves/${m.id}/resolve`, {
                                method: "POST",
                                body: JSON.stringify({ approve: true }),
                              });
                              const j = await res.json();
                              if (!res.ok) throw new Error(j.error?.message ?? "Resolve failed");
                              return j.awaitingVotes
                                ? `Need ${j.awaitingVotes} more vote(s)`
                                : "Move executed";
                            })
                          }
                        >
                          Approve
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === "cashflow" && (
        <div className="panel">
          <div className="panel-head">
            <h3>Cash-flow monitoring</h3>
            <p className="muted">
              Last {cashflow?.days ?? 30}d · in {fmt(cashflow?.totals.inflowUsdc)} · out{" "}
              {fmt(cashflow?.totals.outflowUsdc)} · net {fmt(cashflow?.totals.netUsdc)}
            </p>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Day</th>
                <th>Inflow</th>
                <th>Outflow</th>
                <th>Net</th>
                <th>Journals</th>
              </tr>
            </thead>
            <tbody>
              {(cashflow?.series ?? [])
                .filter((d) => d.journals > 0 || d.inflowUsdc !== "0" || d.outflowUsdc !== "0")
                .slice(-14)
                .map((d) => (
                  <tr key={d.day}>
                    <td className="mono">{d.day}</td>
                    <td className="mono">{fmt(d.inflowUsdc)}</td>
                    <td className="mono">{fmt(d.outflowUsdc)}</td>
                    <td className="mono">{fmt(d.netUsdc)}</td>
                    <td>{d.journals}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "forecast" && forecast && (
        <div className="panel">
          <div className="panel-head">
            <h3>Treasury forecasting</h3>
            <p className="muted">{forecast.note}</p>
          </div>
          <div className="stat-grid">
            <Stat label="Liquid now" value={fmt(forecast.totalLiquidUsdc)} />
            <Stat
              label="Runway"
              value={forecast.runwayDays == null ? "∞" : `${forecast.runwayDays}d`}
              foot={`burn ${fmt(forecast.avgDailySpendUsdc)}/day`}
            />
            <Stat label="Open invoices" value={fmt(forecast.openInvoicesUsdc)} foot="expected inflows" />
            <Stat label="Projected 30d" value={fmt(forecast.projectedLiquidIn30dUsdc)} />
          </div>
        </div>
      )}

      {tab === "recovery" && (
        <div className="card-grid-2">
          <div className="panel">
            <div className="panel-head">
              <h3>Wallet recovery</h3>
              <p className="muted">Rotate custody or agent keys. Events are append-only.</p>
            </div>
            <p className="mono sm">Vault {recovery?.vaultAddress ?? "—"}</p>
            <button
              className="ghost"
              disabled={locked}
              onClick={() =>
                void act("Rotate custody", async () => {
                  if (!confirm("Rotate org custody key? Update any funding destinations.")) return;
                  const res = await gFetch("/v1/guardian/treasury/recovery/rotate-vault", {
                    method: "POST",
                    body: JSON.stringify({ note: "console rotate" }),
                  });
                  const j = await res.json();
                  if (!res.ok) throw new Error(j.error?.message ?? "Rotate failed");
                  return `New vault ${j.address}`;
                })
              }
            >
              Rotate custody key
            </button>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3>Recovery log</h3>
            </div>
            {(recovery?.events.length ?? 0) === 0 ? (
              <Empty>No recovery events yet — key rotations appear here.</Empty>
            ) : (
              <ul className="stack gap-sm">
                {recovery!.events.map((e) => (
                  <li key={e.id} className="list-row">
                    <div>
                      <b>{e.kind}</b>
                      <div className="muted sm">{e.note}</div>
                    </div>
                    <span className="mono sm muted">{e.at.slice(0, 19)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, foot }: { label: string; value?: string; foot?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value ?? "—"}</strong>
      {foot && <span className="stat-foot">{foot}</span>}
    </div>
  );
}
