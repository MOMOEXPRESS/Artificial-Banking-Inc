"use client";

import { useCallback, useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Empty, Icon, Stat } from "./ui";
import { Button } from "@/components/ui/button";
import { SegTabs } from "@/components/ui/seg-tabs";

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
  const [copied, setCopied] = useState(false);

  const depositSchema = z.object({
    amountUsdc: z
      .string()
      .trim()
      .min(1, "Amount required")
      .refine((v) => !Number.isNaN(Number(v)) && Number(v) > 0, "Enter a positive USDC amount"),
  });
  const withdrawSchema = depositSchema.extend({
    destination: z.string().optional(),
  });

  const depositForm = useForm<z.infer<typeof depositSchema>>({
    resolver: zodResolver(depositSchema),
    defaultValues: { amountUsdc: "100" },
  });
  const withdrawForm = useForm<z.infer<typeof withdrawSchema>>({
    resolver: zodResolver(withdrawSchema),
    defaultValues: { amountUsdc: "", destination: "" },
  });

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
      <div className="card treasury-hero">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <div className="treasury-hero-copy">
            <div className="treasury-hero-badge" aria-hidden>
              <Icon name="vault" size={18} />
            </div>
            <div>
              <h2 style={{ margin: 0 }}>Treasury</h2>
              <div className="sub">
                Fund · allocate · withdraw ·{" "}
                {wallets?.asset.symbol ?? "USDC"} on {wallets?.asset.chain ?? "base-sepolia"}
              </div>
            </div>
          </div>
          <SegTabs
            value={tab}
            onValueChange={(v) => setTab(v as typeof tab)}
            items={
              [
                {
                  value: "fund",
                  label: (
                    <span className="seg-label">
                      <Icon name="plus" size={12} /> Fund
                    </span>
                  ),
                },
                {
                  value: "wallets",
                  label: (
                    <span className="seg-label">
                      <Icon name="layers" size={12} /> Wallets
                    </span>
                  ),
                },
                {
                  value: "move",
                  label: (
                    <span className="seg-label">
                      <Icon name="swap" size={12} /> Move
                    </span>
                  ),
                },
                {
                  value: "analytics",
                  label: (
                    <span className="seg-label">
                      <Icon name="chart" size={12} /> Cash
                    </span>
                  ),
                },
                {
                  value: "recovery",
                  label: (
                    <span className="seg-label">
                      <Icon name="key" size={12} /> Recovery
                    </span>
                  ),
                },
              ] as const
            }
          />
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
          <div className="card treasury-panel">
            <div className="treasury-panel-head">
              <span className="treasury-glyph" aria-hidden>
                <Icon name="plus" size={16} />
              </span>
              <div>
                <h2 style={{ margin: "0 0 6px" }}>Deposit USDC</h2>
                <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
                  Record a <b>demo ledger deposit</b>, or fund the vault address on-chain for CDP
                  custody.
                </p>
              </div>
            </div>

            <div className="treasury-vault-chip">
              <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
                Org vault · {wallets?.asset.chain ?? "base-sepolia"}
              </div>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <code className="mono" style={{ fontSize: 13, wordBreak: "break-all", flex: 1 }}>
                  {vault || "Generating…"}
                </code>
                <Button variant="ghost" size="sm" disabled={!vault} onClick={() => void copyVault()}>
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>

            <Form {...depositForm}>
              <form
                className="grid g-2"
                style={{ gap: 14 }}
                onSubmit={depositForm.handleSubmit((values) =>
                  void act("Deposit", async () => {
                    const res = await gFetch("/v1/guardian/treasury/deposit", {
                      method: "POST",
                      body: JSON.stringify({ amountUsdc: values.amountUsdc.trim() }),
                    });
                    const j = await res.json();
                    if (!res.ok) throw new Error(j.error?.message ?? "Deposit failed");
                    await refresh();
                    depositForm.reset({ amountUsdc: "100" });
                    return `Deposited ${j.amountUsdc} USDC into the org treasury.`;
                  }),
                )}
              >
                <FormField
                  control={depositForm.control}
                  name="amountUsdc"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Record deposit (demo)</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={readOnly} placeholder="100" data-shortcut-ignore />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <Button type="submit" size="sm" style={{ width: "100%" }} disabled={locked}>
                    <Icon name="plus" size={13} /> Credit org vault
                  </Button>
                </div>
              </form>
            </Form>
          </div>

          <div className="card treasury-panel">
            <div className="treasury-panel-head">
              <span className="treasury-glyph warn" aria-hidden>
                <Icon name="download" size={16} />
              </span>
              <div>
                <h2 style={{ margin: "0 0 6px" }}>Withdraw</h2>
                <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
                  Pull USDC from the org vault. Large amounts park for guardian approval.
                </p>
              </div>
            </div>
            <Form {...withdrawForm}>
              <form
                style={{ display: "flex", flexDirection: "column", gap: 16 }}
                onSubmit={withdrawForm.handleSubmit((values) =>
                  void act("Withdraw", async () => {
                    const res = await gFetch("/v1/guardian/treasury/withdraw", {
                      method: "POST",
                      body: JSON.stringify({
                        amountUsdc: values.amountUsdc.trim(),
                        destination: values.destination?.trim() || undefined,
                      }),
                    });
                    const j = await res.json();
                    if (!res.ok) throw new Error(j.error?.message ?? "Withdraw failed");
                    withdrawForm.reset({ amountUsdc: "", destination: "" });
                    await refresh();
                    return `Withdrew ${j.amountUsdc} USDC from org treasury.`;
                  }),
                )}
              >
                <FormField
                  control={withdrawForm.control}
                  name="amountUsdc"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount (USDC)</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={readOnly} placeholder="10" data-shortcut-ignore />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={withdrawForm.control}
                  name="destination"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Destination (optional)</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={readOnly} placeholder="0x… or external label" data-shortcut-ignore />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" variant="destructive" size="sm" disabled={locked}>
                  Withdraw from vault
                </Button>
              </form>
            </Form>
            <p className="faint" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.55 }}>
              Available: <b className="mono">{fmt(wallets?.org.availableUsdc)}</b>
            </p>
          </div>
        </div>
      )}

      {tab === "wallets" && (
        <>
          <div className="treasury-scope-row" aria-hidden>
            <div className="treasury-scope-node">
              <Icon name="vault" size={14} /> Org
            </div>
            <span className="treasury-scope-line" />
            <div className="treasury-scope-node">
              <Icon name="layers" size={14} /> Depts
            </div>
            <span className="treasury-scope-line" />
            <div className="treasury-scope-node">
              <Icon name="wallet" size={14} /> Shared
            </div>
            <span className="treasury-scope-line" />
            <div className="treasury-scope-node">
              <Icon name="robot" size={14} /> Agents
            </div>
          </div>

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
                <Button size="sm"
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
                </Button>
              </div>
              {(wallets?.departments.length ?? 0) === 0 ? (
                <Empty icon="wallet">No departments yet.</Empty>
              ) : (
                <div className="treasury-tile-grid">
                  {wallets!.departments.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className="treasury-tile"
                      onClick={() => {
                        setFrom(`department:${d.id}`);
                        setTab("move");
                      }}
                    >
                      <span className="treasury-tile-icon">
                        <Icon name="layers" size={14} />
                      </span>
                      <span className="treasury-tile-name">{d.name}</span>
                      <span className="treasury-tile-amt mono">{fmt(d.availableUsdc)}</span>
                      <span className="treasury-tile-meta faint">held {fmt(d.heldUsdc)}</span>
                    </button>
                  ))}
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
                <Button size="sm"
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
                </Button>
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
                      <div key={s.id} className="treasury-shared-card">
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
                        <Button size="sm"
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
                        </Button>
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
                  Stipends from the org vault · {wallets?.asset.symbol ?? "USDC"} (
                  {wallets?.asset.chain ?? "—"})
                </div>
              </div>
            </div>
            {(wallets?.agents.length ?? 0) === 0 ? (
              <Empty icon="robot">No agents yet — create some under Agents.</Empty>
            ) : (
              <div className="treasury-tile-grid agents">
                {(wallets?.agents ?? []).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="treasury-tile"
                    onClick={() => {
                      setFrom(`agent:${a.id}`);
                      setTab("move");
                    }}
                  >
                    <span className="treasury-tile-icon">
                      <Icon name="robot" size={14} />
                    </span>
                    <span className="treasury-tile-name">{a.name}</span>
                    <span className="treasury-tile-amt mono">{fmt(a.availableUsdc)}</span>
                    <span className={`pill ${a.status === "frozen" ? "bad" : "ok"}`}>
                      <i /> {a.status}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === "move" && (
        <div className="grid g-main fill">
          <div className="card treasury-panel">
            <div className="treasury-panel-head">
              <span className="treasury-glyph" aria-hidden>
                <Icon name="swap" size={16} />
              </span>
              <div>
                <h2 style={{ margin: "0 0 6px" }}>Move between wallets</h2>
                <div className="sub" style={{ margin: 0 }}>
                  Org ↔ dept ↔ shared ↔ agent. Large moves may need multi-guardian votes.
                </div>
              </div>
            </div>

            <div className="treasury-flow" aria-hidden>
              <span>From</span>
              <span className="treasury-flow-arrow">→</span>
              <span>To</span>
              <span className="treasury-flow-arrow">→</span>
              <span>Ledger</span>
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
              <Button size="sm"
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
              </Button>
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
                  <div key={m.id} className="treasury-move-row">
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
                        <Button size="sm"
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
                        </Button>
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
            <div className="card treasury-panel">
              <div className="card-head">
                <div>
                  <h2>Forecast</h2>
                  <div className="sub">{forecast.note}</div>
                </div>
              </div>
              <div className="treasury-runway" aria-hidden>
                <div className="treasury-runway-track">
                  <div
                    className="treasury-runway-fill"
                    style={{
                      width:
                        forecast.runwayDays == null
                          ? "100%"
                          : `${Math.min(100, Math.max(8, (forecast.runwayDays / 90) * 100))}%`,
                    }}
                  />
                </div>
                <div className="treasury-runway-label">
                  {forecast.runwayDays == null
                    ? "Runway unlimited at current burn"
                    : `${forecast.runwayDays} days of runway at ${fmt(forecast.avgDailySpendUsdc)}/day`}
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
          <div className="card treasury-panel">
            <div className="treasury-panel-head">
              <span className="treasury-glyph" aria-hidden>
                <Icon name="key" size={16} />
              </span>
              <div>
                <h2 style={{ margin: "0 0 6px" }}>Custody recovery</h2>
                <div className="sub" style={{ margin: 0 }}>
                  Rotate vault or agent signing material · audited
                </div>
              </div>
            </div>
            <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              <Button variant="ghost" size="sm"
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
              </Button>
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
              <Button variant="ghost" size="sm"
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
              </Button>
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
                  <div key={e.id} className="treasury-move-row" style={{ fontSize: 12.5 }}>
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
