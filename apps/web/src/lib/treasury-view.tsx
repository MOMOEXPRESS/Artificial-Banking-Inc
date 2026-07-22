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

/** Human labels for move history — never show raw ledger scopes like `department`. */
function moveEndpointLabel(ref: { scope: Scope; id: string }, wallets: WalletsPayload | null): string {
  if (!wallets) {
    if (ref.scope === "department") return "Budget";
    if (ref.scope === "shared") return "Legacy pool";
    return ref.scope;
  }
  if (ref.scope === "org") return "Org treasury";
  if (ref.scope === "department") {
    const name = wallets.departments.find((d) => d.id === ref.id)?.name;
    return name ? `Budget · ${name}` : "Budget";
  }
  if (ref.scope === "agent") {
    const name = wallets.agents.find((a) => a.id === ref.id)?.name;
    return name ? `Agent · ${name}` : "Agent";
  }
  if (ref.scope === "shared") {
    const name = wallets.shared.find((s) => s.id === ref.id)?.name;
    return name ? `Legacy pool · ${name}` : "Legacy pool";
  }
  return ref.scope;
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
  const [tab, setTab] = useState<"fund" | "wallets" | "move" | "analytics" | "recovery">(() => {
    if (typeof window === "undefined") return "fund";
    try {
      const pref = sessionStorage.getItem("abi_treasury_tab");
      if (pref === "move" || pref === "wallets" || pref === "fund" || pref === "analytics" || pref === "recovery") {
        sessionStorage.removeItem("abi_treasury_tab");
        return pref;
      }
    } catch {
      /* ignore */
    }
    return "fund";
  });

  const [deptName, setDeptName] = useState("");
  const [rotateAgentId, setRotateAgentId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [moveIntent, setMoveIntent] = useState<
    "budget" | "allocate" | "reclaim" | "transfer" | "custom"
  >("allocate");
  const [copied, setCopied] = useState(false);
  const [holdings, setHoldings] = useState<
    { id: string; symbol: string; decimals: number; chain: string; balance: string }[]
  >([]);
  const [assetId, setAssetId] = useState("asset_usdc");

  const depositSchema = z.object({
    amountUsdc: z
      .string()
      .trim()
      .min(1, "Amount required")
      .refine((v) => !Number.isNaN(Number(v)) && Number(v) > 0, "Enter a positive amount"),
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
    const [w, m, c, f, r, a] = await Promise.all([
      gFetch("/v1/guardian/wallets").then((x) => x.json()),
      gFetch("/v1/guardian/treasury/moves").then((x) => x.json()),
      gFetch("/v1/guardian/treasury/cashflow?days=30").then((x) => x.json()),
      gFetch("/v1/guardian/treasury/forecast").then((x) => x.json()),
      gFetch("/v1/guardian/treasury/recovery").then((x) => x.json()),
      gFetch("/v1/guardian/assets").then((x) => x.json()),
    ]);
    setWallets(w);
    setMoves(m.moves ?? []);
    setCashflow(c);
    setForecast(f.forecast ?? null);
    setRecovery(r);
    setHoldings(a.assets ?? []);
  }, [gFetch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!wallets || from || to) return;
    applyIntent("allocate");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once when wallets first arrive
  }, [wallets]);

  const vault = wallets?.org.vaultAddress ?? recovery?.vaultAddress ?? "";
  const allTargets: { key: string; label: string; short: string; bal: string; kind: Scope; ref: { scope: Scope; id: string } }[] = [];
  if (wallets) {
    allTargets.push({
      key: `org:${wallets.org.id}`,
      label: `Org vault · ${fmt(wallets.org.availableUsdc)}`,
      short: "Org vault",
      bal: wallets.org.availableUsdc,
      kind: "org",
      ref: { scope: "org", id: wallets.org.id },
    });
    for (const d of wallets.departments) {
      allTargets.push({
        key: `department:${d.id}`,
        label: `Budget · ${d.name} · ${fmt(d.availableUsdc)}`,
        short: d.name,
        bal: d.availableUsdc,
        kind: "department",
        ref: { scope: "department", id: d.id },
      });
    }
    for (const a of wallets.agents) {
      allTargets.push({
        key: `agent:${a.id}`,
        label: `Agent · ${a.name} · ${fmt(a.availableUsdc)}`,
        short: a.name,
        bal: a.availableUsdc,
        kind: "agent",
        ref: { scope: "agent", id: a.id },
      });
    }
    for (const s of wallets.shared) {
      allTargets.push({
        key: `shared:${s.id}`,
        label: `Legacy · ${s.name} · ${fmt(s.availableUsdc)}`,
        short: s.name,
        bal: s.availableUsdc,
        kind: "shared",
        ref: { scope: "shared", id: s.id },
      });
    }
  }

  const fromChoices =
    moveIntent === "allocate"
      ? allTargets.filter((t) => t.kind === "org" || t.kind === "department" || t.kind === "shared")
      : moveIntent === "budget"
        ? allTargets.filter((t) => t.kind === "org")
        : moveIntent === "reclaim" || moveIntent === "transfer"
          ? allTargets.filter((t) => t.kind === "agent")
          : allTargets;
  const toChoices =
    moveIntent === "allocate" || moveIntent === "transfer"
      ? allTargets.filter((t) => t.kind === "agent" && t.key !== from)
      : moveIntent === "budget"
        ? allTargets.filter((t) => t.kind === "department")
        : moveIntent === "reclaim"
          ? allTargets.filter((t) => t.kind === "org" || t.kind === "department")
          : allTargets.filter((t) => t.key !== from);

  const fromWallet = allTargets.find((t) => t.key === from);
  const toWallet = allTargets.find((t) => t.key === to);

  const applyIntent = (intent: typeof moveIntent) => {
    setMoveIntent(intent);
    if (!wallets || intent === "custom") return;
    if (intent === "budget") {
      const src = allTargets.find((t) => t.kind === "org");
      const dest =
        allTargets.find((t) => t.kind === "department" && Number(t.bal) >= 0) ??
        allTargets.find((t) => t.kind === "department");
      setFrom(src?.key ?? "");
      setTo(dest?.key ?? "");
      return;
    }
    if (intent === "allocate") {
      const src =
        allTargets.find((t) => t.kind === "department" && Number(t.bal) > 0) ??
        allTargets.find((t) => t.kind === "org");
      const dest = allTargets.find((t) => t.kind === "agent" && t.key !== src?.key);
      setFrom(src?.key ?? "");
      setTo(dest?.key ?? "");
      return;
    }
    if (intent === "reclaim") {
      const src = allTargets.find((t) => t.kind === "agent" && Number(t.bal) > 0);
      const dest = allTargets.find((t) => t.kind === "org");
      setFrom(src?.key ?? "");
      setTo(dest?.key ?? "");
      return;
    }
    if (intent === "transfer") {
      const agents = allTargets.filter((t) => t.kind === "agent");
      setFrom(agents[0]?.key ?? "");
      setTo(agents[1]?.key ?? "");
    }
  };

  const swapEndpoints = () => {
    const a = from;
    setFrom(to);
    setTo(a);
    setMoveIntent("custom");
  };

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
                Fund · allocate · send ·{" "}
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
                      <Icon name="vault" size={12} /> Vault
                    </span>
                  ),
                },
                {
                  value: "wallets",
                  label: (
                    <span className="seg-label">
                  <Icon name="layers" size={12} /> Budgets
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
        <Stat
          label="Liquid total"
          value={fmt(forecast?.totalLiquidUsdc)}
          foot={
            Number(forecast?.sharedAvailableUsdc ?? 0) > 0
              ? "org + budgets + agents + legacy pools"
              : "org + budgets + agents"
          }
        />
        <Stat
          label="Org vault"
          value={fmt(wallets?.org.availableUsdc)}
          foot={vault ? `${vault.slice(0, 8)}…${vault.slice(-4)}` : "no address"}
        />
        <Stat
          label="In budgets"
          value={fmt(forecast?.deptAvailableUsdc)}
          foot="not spendable until funded to agents"
        />
        <Stat
          label="With agents"
          value={fmt(forecast?.agentAvailableUsdc)}
          foot={`${wallets?.agents.length ?? 0} spend wallets`}
        />
      </div>

      {tab === "fund" && (
        <div className="wallet-shell">
          <div className="card wallet-card">
            <div className="wallet-hero">
              <div className="wallet-hero-label">Org vault</div>
              <div className="wallet-hero-balance">
                {(() => {
                  const sel =
                    holdings.find((h) => h.id === assetId) ??
                    holdings.find((h) => h.id === "asset_usdc");
                  const sym = sel?.symbol ?? wallets?.asset.symbol ?? "USDC";
                  const bal = sel?.balance ?? wallets?.org.availableUsdc ?? "0";
                  const n = Number(bal);
                  return (
                    <>
                      <span className="wallet-hero-amount">
                        {Number.isNaN(n)
                          ? bal
                          : n.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                      </span>
                      <span className="wallet-hero-symbol">{sym}</span>
                    </>
                  );
                })()}
              </div>
              <div className="wallet-hero-chain muted">
                {(holdings.find((h) => h.id === assetId) ?? holdings[0])?.chain ??
                  wallets?.asset.chain ??
                  "—"}
                {vault ? (
                  <>
                    {" · "}
                    <code className="mono" style={{ fontSize: 11 }}>
                      {vault.slice(0, 8)}…{vault.slice(-6)}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      style={{ marginLeft: 6 }}
                      disabled={!vault}
                      onClick={() => void copyVault()}
                    >
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>

            <div className="wallet-assets" role="list">
              {(holdings.length
                ? holdings
                : [
                    {
                      id: "asset_usdc",
                      symbol: "USDC",
                      decimals: 6,
                      chain: wallets?.asset.chain ?? "base-sepolia",
                      balance: wallets?.org.availableUsdc ?? "0",
                    },
                  ]
              ).map((h) => {
                const active = h.id === assetId;
                const n = Number(h.balance);
                return (
                  <button
                    key={h.id}
                    type="button"
                    role="listitem"
                    className={`wallet-asset-row ${active ? "active" : ""}`}
                    onClick={() => setAssetId(h.id)}
                  >
                    <span className={`wallet-asset-icon ${h.symbol.toLowerCase()}`} aria-hidden>
                      {h.symbol.slice(0, 1)}
                    </span>
                    <span className="wallet-asset-meta">
                      <b>{h.symbol}</b>
                      <span className="faint">{h.chain}</span>
                    </span>
                    <span className="wallet-asset-bal mono">
                      {Number.isNaN(n)
                        ? h.balance
                        : n.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid g-2 fill">
            <div className="card wallet-action-card">
              <div className="card-head">
                <div>
                  <h2 style={{ margin: 0 }}>Receive</h2>
                  <div className="sub">
                    Credit the selected asset into the vault (demo ledger for USDC; holdings for BTC/ETH).
                  </div>
                </div>
              </div>
              <Form {...depositForm}>
                <form
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                  onSubmit={depositForm.handleSubmit((values) =>
                    void act("Deposit", async () => {
                      const res = await gFetch("/v1/guardian/treasury/deposit", {
                        method: "POST",
                        body: JSON.stringify({
                          amountUsdc: values.amountUsdc.trim(),
                          assetId,
                        }),
                      });
                      const j = await res.json();
                      if (!res.ok) throw new Error(j.error?.message ?? "Deposit failed");
                      await refresh();
                      depositForm.reset({ amountUsdc: "100" });
                      const sym = j.symbol ?? "USDC";
                      return `Received ${j.amountUsdc} ${sym} into the org vault.`;
                    }),
                  )}
                >
                  <FormField
                    control={depositForm.control}
                    name="amountUsdc"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Amount (
                          {holdings.find((h) => h.id === assetId)?.symbol ?? "USDC"})
                        </FormLabel>
                        <FormControl>
                          <Input {...field} disabled={readOnly} placeholder="100" data-shortcut-ignore />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" size="sm" disabled={locked}>
                    <Icon name="plus" size={13} /> Receive
                  </Button>
                </form>
              </Form>
            </div>

            <div className="card wallet-action-card">
              <div className="card-head">
                <div>
                  <h2 style={{ margin: 0 }}>Send</h2>
                  <div className="sub">
                    Debit USDC from the spend rail (ledger). Non-USDC send coming with custody rails.
                  </div>
                </div>
              </div>
              <Form {...withdrawForm}>
                <form
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                  onSubmit={withdrawForm.handleSubmit((values) =>
                    void act("Withdraw", async () => {
                      if (assetId !== "asset_usdc") {
                        throw new Error("Send is USDC-only on the spend rail for now — switch to USDC.");
                      }
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
                      return `Sent ${j.amountUsdc} USDC from org treasury.`;
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
                          <Input {...field} disabled={readOnly || assetId !== "asset_usdc"} placeholder="10" data-shortcut-ignore />
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
                        <FormLabel>Destination memo</FormLabel>
                        <FormControl>
                          <Input {...field} disabled={readOnly || assetId !== "asset_usdc"} placeholder="external / exchange" data-shortcut-ignore />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" size="sm" variant="ghost" disabled={locked || assetId !== "asset_usdc"}>
                    <Icon name="send" size={13} /> Send
                  </Button>
                </form>
              </Form>
            </div>
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
              <Icon name="layers" size={14} /> Budgets
            </div>
            <span className="treasury-scope-line" />
            <div className="treasury-scope-node">
              <Icon name="robot" size={14} /> Agents
            </div>
            <span className="treasury-scope-line" />
            <div className="treasury-scope-node">
              <Icon name="zap" size={14} /> Pay
            </div>
          </div>

          <div
            className="banner info"
            style={{ marginBottom: 12 }}
          >
            <span className="txt">
              <b>How money works</b>
              <span>
                Budgets are cost centers (Finance, Research) — they hold money, they are not teams.
                Fund an agent&apos;s own wallet from a budget, then the agent pays under policy.
                Prefer <span className="mono">writer-finance</span> and{" "}
                <span className="mono">writer-research</span> over one agent in many pools.
              </span>
            </span>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-head">
              <div>
                <h2>Budgets</h2>
                <div className="sub">
                  Money envelopes only — no membership. Create Finance, Research, Engineering…
                </div>
              </div>
            </div>
            <div className="row" style={{ marginBottom: 12, gap: 8 }}>
              <input
                value={deptName}
                disabled={readOnly}
                onChange={(e) => setDeptName(e.target.value)}
                placeholder="Finance"
                style={{ flex: 1 }}
              />
              <Button
                size="sm"
                disabled={locked || !deptName.trim()}
                onClick={() =>
                  void act("Create budget", async () => {
                    const res = await gFetch("/v1/guardian/budgets", {
                      method: "POST",
                      body: JSON.stringify({ name: deptName.trim() }),
                    });
                    const j = await res.json();
                    if (!res.ok) throw new Error(j.error?.message ?? "Failed");
                    setDeptName("");
                    await refresh();
                    return `Budget ${j.budget.name} created` +
                      (j.opsLabel ? ` · ops label “${j.opsLabel.name}” ready under Agents` : "");
                  })
                }
              >
                Create budget
              </Button>
            </div>
            {(wallets?.departments.length ?? 0) === 0 ? (
              <Empty icon="wallet">No budgets yet — create Finance or Research to park money.</Empty>
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
                    <span className="treasury-tile-meta faint">held {fmt(d.heldUsdc)} · click to move</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {(wallets?.shared.length ?? 0) > 0 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-head">
                <div>
                  <h2>Legacy shared pools</h2>
                  <div className="sub">
                    Not spendable and not required anymore. Move any balance into a Budget (or an
                    agent), then ignore these.
                  </div>
                </div>
              </div>
              <div className="treasury-tile-grid">
                {wallets!.shared.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="treasury-tile"
                    onClick={() => {
                      setFrom(`shared:${s.id}`);
                      setTab("move");
                    }}
                  >
                    <span className="treasury-tile-icon">
                      <Icon name="wallet" size={14} />
                    </span>
                    <span className="treasury-tile-name">{s.name}</span>
                    <span className="treasury-tile-amt mono">{fmt(s.availableUsdc)}</span>
                    <span className="treasury-tile-meta faint">legacy · click to empty</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Agent wallets</h2>
                <div className="sub">
                  The only balances agents can spend from · {wallets?.asset.symbol ?? "USDC"} (
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
                      setTo(`agent:${a.id}`);
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
        <div className="move-layout">
          <div className="card treasury-panel move-composer">
            <div className="treasury-panel-head">
              <span className="treasury-glyph" aria-hidden>
                <Icon name="swap" size={16} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ margin: "0 0 6px" }}>Move funds</h2>
                <div className="sub" style={{ margin: 0 }}>
                  Vault → budget → agent stipend. Large amounts may park for approval.
                </div>
              </div>
            </div>

            <div className="move-intents" role="tablist" aria-label="Move type">
              {(
                [
                  { id: "budget", label: "Fill budget", hint: "Vault → budget pool" },
                  { id: "allocate", label: "Fund agent", hint: "Budget / vault → stipend" },
                  { id: "reclaim", label: "Pull back", hint: "Agent → vault / budget" },
                  { id: "transfer", label: "Peer move", hint: "Agent ↔ agent" },
                  { id: "custom", label: "Custom", hint: "Any wallet pair" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={moveIntent === opt.id}
                  className={`move-intent ${moveIntent === opt.id ? "on" : ""}`}
                  disabled={readOnly}
                  onClick={() => applyIntent(opt.id)}
                >
                  <b>{opt.label}</b>
                  <span>{opt.hint}</span>
                </button>
              ))}
            </div>

            <div className="move-route">
              <div className="move-endpoint">
                <div className="move-endpoint-label">From</div>
                <select
                  value={from}
                  disabled={readOnly}
                  onChange={(e) => setFrom(e.target.value)}
                >
                  <option value="">Select source</option>
                  {fromChoices.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <div className="move-endpoint-bal">
                  {fromWallet ? (
                    <>
                      <span className="faint">{fromWallet.short}</span>
                      <b className="mono">{fmt(fromWallet.bal)}</b>
                    </>
                  ) : (
                    <span className="faint">Pick a wallet with balance</span>
                  )}
                </div>
              </div>

              <button
                type="button"
                className="move-swap"
                disabled={readOnly || !from || !to}
                title="Swap from / to"
                aria-label="Swap from and to"
                onClick={swapEndpoints}
              >
                <Icon name="swap" size={15} />
              </button>

              <div className="move-endpoint">
                <div className="move-endpoint-label">To</div>
                <select
                  value={to}
                  disabled={readOnly}
                  onChange={(e) => setTo(e.target.value)}
                >
                  <option value="">Select destination</option>
                  {toChoices.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <div className="move-endpoint-bal">
                  {toWallet ? (
                    <>
                      <span className="faint">{toWallet.short}</span>
                      <b className="mono">{fmt(toWallet.bal)}</b>
                    </>
                  ) : (
                    <span className="faint">Where the USDC lands</span>
                  )}
                </div>
              </div>
            </div>

            <div className="move-amount-block">
              <label className="field" style={{ margin: 0 }}>
                <span>Amount (USDC)</span>
                <input
                  value={amount}
                  disabled={readOnly}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="25"
                  inputMode="decimal"
                />
              </label>
              <div className="move-amount-chips">
                {["10", "25", "50", "100"].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="sm ghost"
                    disabled={readOnly}
                    onClick={() => setAmount(chip)}
                  >
                    ${chip}
                  </button>
                ))}
                <button
                  type="button"
                  className="sm ghost"
                  disabled={readOnly || !fromWallet}
                  onClick={() => setAmount(fromWallet?.bal ?? "")}
                >
                  All available
                </button>
              </div>
            </div>

            <div className="move-actions">
              <Button
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
                        memo: `console_${moveIntent}`,
                      }),
                    });
                    const j = await res.json();
                    if (!res.ok) throw new Error(j.error?.message ?? "Move failed");
                    const moved = amount.trim();
                    setAmount("");
                    await refresh();
                    return j.outcome === "review"
                      ? "Parked for multi-guardian approval"
                      : `Moved ${moved} USDC · ${f.short} → ${t.short}`;
                  })
                }
              >
                <Icon name="swap" size={13} />{" "}
                {moveIntent === "budget"
                  ? "Fill budget"
                  : moveIntent === "allocate"
                    ? "Fund agent"
                    : moveIntent === "reclaim"
                      ? "Pull back"
                      : moveIntent === "transfer"
                        ? "Transfer"
                        : "Execute move"}
              </Button>
              {fromWallet && toWallet && amount.trim() && (
                <span className="move-summary faint">
                  {fmt(amount.trim())} · {fromWallet.short} → {toWallet.short}
                </span>
              )}
            </div>
          </div>

          <div className="card move-history">
            <div className="card-head">
              <div>
                <h2>Activity</h2>
                <div className="sub">Recent & pending treasury moves</div>
              </div>
              {moves.some((m) => m.status === "pending") && (
                <span className="pill warn">
                  <i /> {moves.filter((m) => m.status === "pending").length} pending
                </span>
              )}
            </div>
            {moves.length === 0 ? (
              <Empty icon="swap">No moves yet — fund an agent from a budget to start the trail.</Empty>
            ) : (
              <div className="move-history-list">
                {moves.slice(0, 12).map((m) => (
                  <div key={m.id} className="treasury-move-row">
                    <div style={{ minWidth: 0 }}>
                      <b className="mono">{fmt(m.amountUsdc)}</b>
                      <div className="faint" style={{ fontSize: 11.5 }}>
                        {moveEndpointLabel(m.from, wallets)} → {moveEndpointLabel(m.to, wallets)}
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
                        <Button
                          size="sm"
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
                <Stat
                  label="Liquid now"
                  value={fmt(forecast.totalLiquidUsdc)}
                  foot={
                    Number(forecast.sharedAvailableUsdc ?? 0) > 0
                      ? "includes legacy shared pools"
                      : undefined
                  }
                />
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
