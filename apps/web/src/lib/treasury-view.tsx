"use client";

import { useCallback, useEffect, useState } from "react";
import { Empty, Icon, Stat } from "./ui";

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
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
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
  const [recovery, setRecovery] = useState<{
    vaultAddress?: string;
    events: { id: string; kind: string; note?: string; at: string }[];
  } | null>(null);
  const [tab, setTab] = useState<"fund" | "wallets" | "move" | "analytics" | "recovery">("fund");

  const [deptName, setDeptName] = useState("");
  const [sharedName, setSharedName] = useState("");
  const [sharedCreateMembers, setSharedCreateMembers] = useState<string[]>([]);
  const [sharedEditMembers, setSharedEditMembers] = useState<Record<string, string[]>>({});
  const [rotateAgentId, setRotateAgentId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [depositAmt, setDepositAmt] = useState("100");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [withdrawDest, setWithdrawDest] = useState("");
  const [copied, setCopied] = useState(false);

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

  const vault = wallets?.org.vaultAddress ?? recovery?.vaultAddress ?? "";
  const allTargets: { key: string; label: string; ref: { scope: Scope; id: string } }[] = [];
  if (wallets) {
    allTargets.push({
      key: `org:${wallets.org.id}`,
      label: `Org treasury · ${fmt(wallets.org.availableUsdc)}`,
      ref: { scope: "org", id: wallets.org.id },
    });
    for (const d of wallets.departments) {
      allTargets.push({
        key: `department:${d.id}`,
        label: `Dept · ${d.name} · ${fmt(d.availableUsdc)}`,
        ref: { scope: "department", id: d.id },
      });
    }
    for (const a of wallets.agents) {
      allTargets.push({
        key: `agent:${a.id}`,
        label: `Agent · ${a.name} · ${fmt(a.availableUsdc)}`,
        ref: { scope: "agent", id: a.id },
      });
    }
    for (const s of wallets.shared) {
      allTargets.push({
        key: `shared:${s.id}`,
        label: `Shared · ${s.name} · ${fmt(s.availableUsdc)}`,
        ref: { scope: "shared", id: s.id },
      });
    }
  }

  const copyVault = async () => {
    if (!vault) return;
    await navigator.clipboard.writeText(vault);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head">
          <div>
            <h2 style={{ margin: 0 }}>Treasury</h2>
            <div className="sub">
              Fund the org vault, allocate to agents, withdraw to allowlisted destinations ·{" "}
              {wallets?.asset.symbol ?? "USDC"} on {wallets?.asset.chain ?? "base-sepolia"}
            </div>
          </div>
          <div className="seg">
            {(
              [
                ["fund", "Fund"],
                ["wallets", "Wallets"],
                ["move", "Move"],
                ["analytics", "Cash & forecast"],
                ["recovery", "Recovery"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid g-4" style={{ marginBottom: 12 }}>
        <Stat label="Liquid total" value={fmt(forecast?.totalLiquidUsdc)} foot="all wallets" />
        <Stat
          label="Org vault"
          value={fmt(wallets?.org.availableUsdc)}
          foot={vault ? `${vault.slice(0, 8)}…${vault.slice(-4)}` : "no address"}
        />
        <Stat
          label="With agents"
          value={fmt(forecast?.agentAvailableUsdc)}
          foot={`${wallets?.agents.length ?? 0} agents`}
        />
        <Stat
          label="Runway"
          value={forecast?.runwayDays == null ? "∞" : `${forecast.runwayDays}d`}
          foot={`burn ${fmt(forecast?.avgDailySpendUsdc)}/day`}
        />
      </div>

      {tab === "fund" && (
        <div className="grid g-main fill">
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <h2 style={{ margin: "0 0 6px" }}>Deposit USDC</h2>
              <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
                Today the console can record a <b>demo ledger deposit</b> (off-chain credit).
                For go-live with CDP, fund the <b>existent vault address</b> below with USDC on{" "}
                {wallets?.asset.chain ?? "base-sepolia"} — custody signs via that vault when{" "}
                <code>CDP_API_KEY_*</code> is set.
              </p>
            </div>

            <div
              style={{
                padding: "14px 16px",
                borderRadius: 10,
                background: "var(--surface-3)",
                border: "1px solid var(--border)",
              }}
            >
              <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
                Org vault address ({wallets?.asset.chain ?? "base-sepolia"})
              </div>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <code className="mono" style={{ fontSize: 13, wordBreak: "break-all", flex: 1 }}>
                  {vault || "Generating…"}
                </code>
                <button className="ghost sm" disabled={!vault} onClick={() => void copyVault()}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div className="grid g-2" style={{ gap: 14 }}>
              <label className="field" style={{ margin: 0 }}>
                <span>Record deposit (demo)</span>
                <input
                  value={depositAmt}
                  disabled={readOnly}
                  onChange={(e) => setDepositAmt(e.target.value)}
                  placeholder="100"
                />
              </label>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button
                  className="sm"
                  style={{ width: "100%" }}
                  disabled={locked || !depositAmt.trim()}
                  onClick={() =>
                    void act("Deposit", async () => {
                      const res = await gFetch("/v1/guardian/treasury/deposit", {
                        method: "POST",
                        body: JSON.stringify({ amountUsdc: depositAmt.trim() }),
                      });
                      const j = await res.json();
                      if (!res.ok) throw new Error(j.error?.message ?? "Deposit failed");
                      await refresh();
                      return `Deposited ${j.amountUsdc} USDC into the org treasury.`;
                    })
                  }
                >
                  <Icon name="plus" size={13} /> Credit org vault
                </button>
              </div>
            </div>
          </div>

          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <h2 style={{ margin: "0 0 6px" }}>Withdraw</h2>
              <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
                Pull USDC out of the org vault. Above your policy threshold this parks for
                guardian approval. Destination should be an allowlisted address once live.
              </p>
            </div>
            <label className="field" style={{ margin: 0 }}>
              <span>Amount (USDC)</span>
              <input
                value={withdrawAmt}
                disabled={readOnly}
                onChange={(e) => setWithdrawAmt(e.target.value)}
                placeholder="10"
              />
            </label>
            <label className="field" style={{ margin: 0 }}>
              <span>Destination (optional)</span>
              <input
                value={withdrawDest}
                disabled={readOnly}
                onChange={(e) => setWithdrawDest(e.target.value)}
                placeholder="0x… or external label"
              />
            </label>
            <button
              className="danger sm"
              disabled={locked || !withdrawAmt.trim()}
              onClick={() =>
                void act("Withdraw", async () => {
                  const res = await gFetch("/v1/guardian/treasury/withdraw", {
                    method: "POST",
                    body: JSON.stringify({
                      amountUsdc: withdrawAmt.trim(),
                      destination: withdrawDest.trim() || undefined,
                    }),
                  });
                  const j = await res.json();
                  if (!res.ok) throw new Error(j.error?.message ?? "Withdraw failed");
                  setWithdrawAmt("");
                  await refresh();
                  return `Withdrew ${j.amountUsdc} USDC from org treasury.`;
                })
              }
            >
              Withdraw from vault
            </button>
            <p className="faint" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.55 }}>
              Available to withdraw: <b className="mono">{fmt(wallets?.org.availableUsdc)}</b>
            </p>
          </div>
        </div>
      )}

      {tab === "wallets" && (
        <>
          <div className="grid g-2 fill" style={{ marginBottom: 12 }}>
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Departments</h2>
                  <div className="sub">Budgets by team — Engineering, Growth, Support…</div>
                </div>
              </div>
              <div className="row" style={{ marginBottom: 12, gap: 8 }}>
                <input
                  value={deptName}
                  disabled={readOnly}
                  onChange={(e) => setDeptName(e.target.value)}
                  placeholder="Engineering"
                  style={{ flex: 1 }}
                />
                <button
                  className="sm"
                  disabled={locked || !deptName.trim()}
                  onClick={() =>
                    void act("Create department", async () => {
                      const res = await gFetch("/v1/guardian/departments", {
                        method: "POST",
                        body: JSON.stringify({ name: deptName.trim() }),
                      });
                      const j = await res.json();
                      if (!res.ok) throw new Error(j.error?.message ?? "Failed");
                      setDeptName("");
                      await refresh();
                      return `Department ${j.department.name} created`;
                    })
                  }
                >
                  Create
                </button>
              </div>
              {(wallets?.departments.length ?? 0) === 0 ? (
                <Empty icon="wallet">No departments yet.</Empty>
              ) : (
                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th className="num">Available</th>
                        <th className="num">Held</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wallets!.departments.map((d) => (
                        <tr key={d.id}>
                          <td>{d.name}</td>
                          <td className="num mono">{fmt(d.availableUsdc)}</td>
                          <td className="num mono faint">{fmt(d.heldUsdc)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Shared pools</h2>
                  <div className="sub">Multi-agent wallets — pick members on create or edit below</div>
                </div>
              </div>
              <div className="row" style={{ marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
                <input
                  value={sharedName}
                  disabled={readOnly}
                  onChange={(e) => setSharedName(e.target.value)}
                  placeholder="Ops pool"
                  style={{ flex: 1, minWidth: 120 }}
                />
                <button
                  className="sm"
                  disabled={locked || !sharedName.trim()}
                  onClick={() =>
                    void act("Create shared wallet", async () => {
                      const res = await gFetch("/v1/guardian/shared-wallets", {
                        method: "POST",
                        body: JSON.stringify({
                          name: sharedName.trim(),
                          memberAgentIds: sharedCreateMembers,
                        }),
                      });
                      const j = await res.json();
                      if (!res.ok) throw new Error(j.error?.message ?? "Failed");
                      setSharedName("");
                      setSharedCreateMembers([]);
                      await refresh();
                      return `Shared wallet ${j.wallet.name} created · ${sharedCreateMembers.length} member(s)`;
                    })
                  }
                >
                  Create
                </button>
              </div>
              {(wallets?.agents.length ?? 0) > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {wallets!.agents.map((a) => {
                    const on = sharedCreateMembers.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className={`sm ghost ${on ? "on" : ""}`}
                        disabled={readOnly}
                        onClick={() =>
                          setSharedCreateMembers((ids) =>
                            on ? ids.filter((x) => x !== a.id) : [...ids, a.id],
                          )
                        }
                      >
                        {on ? "✓ " : ""}
                        {a.name}
                      </button>
                    );
                  })}
                </div>
              )}
              {(wallets?.shared.length ?? 0) === 0 ? (
                <Empty icon="wallet">No shared wallets yet.</Empty>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {wallets!.shared.map((s) => {
                    const members =
                      sharedEditMembers[s.id] ?? s.memberAgentIds ?? [];
                    return (
                      <div
                        key={s.id}
                        style={{
                          padding: 12,
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          background: "var(--surface-2)",
                        }}
                      >
                        <div className="between" style={{ marginBottom: 8 }}>
                          <b>{s.name}</b>
                          <span className="mono">{fmt(s.availableUsdc)}</span>
                        </div>
                        <div className="faint" style={{ fontSize: 12, marginBottom: 8 }}>
                          Members — toggle then Save
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                          {(wallets?.agents ?? []).map((a) => {
                            const on = members.includes(a.id);
                            return (
                              <button
                                key={a.id}
                                type="button"
                                className={`sm ghost ${on ? "on" : ""}`}
                                disabled={readOnly}
                                onClick={() =>
                                  setSharedEditMembers((m) => {
                                    const cur = m[s.id] ?? s.memberAgentIds ?? [];
                                    return {
                                      ...m,
                                      [s.id]: on
                                        ? cur.filter((x) => x !== a.id)
                                        : [...cur, a.id],
                                    };
                                  })
                                }
                              >
                                {on ? "✓ " : ""}
                                {a.name}
                              </button>
                            );
                          })}
                        </div>
                        <button
                          className="sm"
                          disabled={locked}
                          onClick={() =>
                            void act("Update shared members", async () => {
                              const res = await gFetch(
                                `/v1/guardian/shared-wallets/${s.id}/members`,
                                {
                                  method: "POST",
                                  body: JSON.stringify({ memberAgentIds: members }),
                                },
                              );
                              const j = await res.json();
                              if (!res.ok) throw new Error(j.error?.message ?? "Failed");
                              await refresh();
                              return `Updated members on ${s.name}`;
                            })
                          }
                        >
                          Save members ({members.length})
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Agent wallets</h2>
                <div className="sub">
                  Stipends from the org vault · asset {wallets?.asset.symbol ?? "USDC"} (
                  {wallets?.asset.chain ?? "—"})
                </div>
              </div>
            </div>
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th className="num">Available</th>
                    <th className="num">Held</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(wallets?.agents ?? []).map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td className="num mono">{fmt(a.availableUsdc)}</td>
                      <td className="num mono faint">{fmt(a.heldUsdc)}</td>
                      <td>
                        <span className={`pill ${a.status === "frozen" ? "bad" : "ok"}`}>
                          <i /> {a.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === "move" && (
        <div className="grid g-main fill">
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Move between wallets</h2>
                <div className="sub">
                  Org ↔ dept ↔ shared ↔ agent. Large moves may need multi-guardian votes.
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 }}>
              <label className="field" style={{ margin: 0 }}>
                <span>From</span>
                <select value={from} disabled={readOnly} onChange={(e) => setFrom(e.target.value)}>
                  <option value="">Select wallet</option>
                  {allTargets.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span>To</span>
                <select value={to} disabled={readOnly} onChange={(e) => setTo(e.target.value)}>
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
              <label className="field" style={{ margin: 0 }}>
                <span>Amount (USDC)</span>
                <input
                  value={amount}
                  disabled={readOnly}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="25"
                />
              </label>
              <button
                className="sm"
                disabled={locked || !from || !to || !amount.trim()}
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
                    await refresh();
                    return j.outcome === "review"
                      ? "Parked for multi-guardian approval"
                      : `Moved ${amount} USDC`;
                  })
                }
              >
                <Icon name="swap" size={13} /> Execute move
              </button>
            </div>
          </div>

          <div className="card" style={{ display: "flex", flexDirection: "column" }}>
            <div className="card-head">
              <h2>Recent & pending moves</h2>
            </div>
            {moves.length === 0 ? (
              <Empty icon="swap">No treasury moves yet.</Empty>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                {moves.slice(0, 12).map((m) => (
                  <div key={m.id} className="between" style={{ gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <b className="mono">{fmt(m.amountUsdc)}</b>
                      <div className="faint" style={{ fontSize: 11.5 }}>
                        {m.from.scope} → {m.to.scope}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                      <span
                        className={`pill ${
                          m.status === "executed" ? "ok" : m.status === "pending" ? "warn" : "mute"
                        }`}
                      >
                        <i /> {m.status}
                      </span>
                      {m.status === "pending" && (
                        <button
                          className="sm"
                          disabled={locked}
                          onClick={() =>
                            void act("Approve move", async () => {
                              const res = await gFetch(
                                `/v1/guardian/treasury/moves/${m.id}/resolve`,
                                {
                                  method: "POST",
                                  body: JSON.stringify({ approve: true }),
                                },
                              );
                              const j = await res.json();
                              if (!res.ok) throw new Error(j.error?.message ?? "Resolve failed");
                              await refresh();
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
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "analytics" && (
        <div className="grid g-main fill">
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Cash flow</h2>
                <div className="sub">
                  Last {cashflow?.days ?? 30}d · in {fmt(cashflow?.totals.inflowUsdc)} · out{" "}
                  {fmt(cashflow?.totals.outflowUsdc)} · net {fmt(cashflow?.totals.netUsdc)}
                </div>
              </div>
            </div>
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th className="num">In</th>
                    <th className="num">Out</th>
                    <th className="num">Net</th>
                    <th className="num">Journals</th>
                  </tr>
                </thead>
                <tbody>
                  {(cashflow?.series ?? [])
                    .filter((d) => d.journals > 0 || d.inflowUsdc !== "0" || d.outflowUsdc !== "0")
                    .slice(-14)
                    .map((d) => (
                      <tr key={d.day}>
                        <td className="mono">{d.day}</td>
                        <td className="num mono">{fmt(d.inflowUsdc)}</td>
                        <td className="num mono">{fmt(d.outflowUsdc)}</td>
                        <td className="num mono">{fmt(d.netUsdc)}</td>
                        <td className="num">{d.journals}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!(cashflow?.series ?? []).some(
              (d) => d.journals > 0 || d.inflowUsdc !== "0" || d.outflowUsdc !== "0",
            ) && <Empty icon="list">No cash-flow activity in this window yet.</Empty>}
          </div>

          {forecast && (
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Forecast</h2>
                  <div className="sub">{forecast.note}</div>
                </div>
              </div>
              <div className="grid g-2" style={{ gap: 14 }}>
                <Stat label="Liquid now" value={fmt(forecast.totalLiquidUsdc)} />
                <Stat
                  label="Runway"
                  value={forecast.runwayDays == null ? "∞" : `${forecast.runwayDays}d`}
                  foot={`burn ${fmt(forecast.avgDailySpendUsdc)}/day`}
                />
                <Stat label="Open invoices" value={fmt(forecast.openInvoicesUsdc)} foot="expected in" />
                <Stat label="Projected 30d" value={fmt(forecast.projectedLiquidIn30dUsdc)} />
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "recovery" && (
        <div className="grid g-2 fill">
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Custody recovery</h2>
                <div className="sub">Rotate vault or agent signing material · audited</div>
              </div>
            </div>
            <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              <button
                className="ghost sm"
                disabled={locked}
                onClick={() =>
                  void act("Rotate vault key", async () => {
                    const res = await gFetch("/v1/guardian/treasury/recovery/rotate-vault", {
                      method: "POST",
                      body: "{}",
                    });
                    const j = await res.json();
                    if (!res.ok) throw new Error(j.error?.message ?? "Failed");
                    await refresh();
                    return `New vault address ${j.address}`;
                  })
                }
              >
                Rotate vault key
              </button>
              <select
                value={rotateAgentId}
                disabled={readOnly}
                onChange={(e) => setRotateAgentId(e.target.value)}
                style={{ minWidth: 140 }}
              >
                <option value="">Agent to rotate…</option>
                {(wallets?.agents ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button
                className="ghost sm"
                disabled={locked || !rotateAgentId}
                onClick={() =>
                  void act("Rotate agent API key", async () => {
                    const res = await gFetch(
                      `/v1/guardian/agents/${rotateAgentId}/rotate-key`,
                      { method: "POST", body: "{}" },
                    );
                    const j = await res.json();
                    if (!res.ok) throw new Error(j.error?.message ?? "Failed");
                    return `New agent key (once): ${j.apiKey}`;
                  })
                }
              >
                Rotate agent key
              </button>
            </div>
            <p className="faint" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
              Current vault:{" "}
              <span className="mono">{recovery?.vaultAddress ?? vault ?? "—"}</span>
            </p>
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Recovery log</h2>
            </div>
            {(recovery?.events?.length ?? 0) === 0 ? (
              <Empty icon="clock">No recovery events yet.</Empty>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {recovery!.events.slice(0, 12).map((e) => (
                  <div key={e.id} className="between" style={{ fontSize: 12.5 }}>
                    <span>
                      <b>{e.kind}</b>
                      {e.note ? ` · ${e.note}` : ""}
                    </span>
                    <span className="faint mono">{new Date(e.at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
