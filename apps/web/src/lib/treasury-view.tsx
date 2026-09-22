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

type TreasuryTab = "fund" | "wallets" | "move" | "analytics" | "recovery";

const TREASURY_TABS = new Set<TreasuryTab>(["fund", "wallets", "move", "analytics", "recovery"]);

function resolveTreasuryTab(hint?: string | null): TreasuryTab {
  if (hint && TREASURY_TABS.has(hint as TreasuryTab)) return hint as TreasuryTab;
  if (typeof window === "undefined") return "fund";
  try {
    const pref = sessionStorage.getItem("abi_treasury_tab");
    if (pref && TREASURY_TABS.has(pref as TreasuryTab)) {
      sessionStorage.removeItem("abi_treasury_tab");
      return pref as TreasuryTab;
    }
  } catch {
    /* ignore */
  }
  return "fund";
}

export function TreasuryView({
  gFetch,
  busy,
  act,
  readOnly = false,
  initialTab,
  onTabChange,
  ledgerMode = "sandbox",
}: {
  gFetch: (path: string, init?: RequestInit) => Promise<Response>;
  busy: boolean;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  readOnly?: boolean;
  initialTab?: string | null;
  onTabChange?: (tab: TreasuryTab) => void;
  /** `live` orgs hold real money and cannot book simulated deposits. */
  ledgerMode?: "sandbox" | "live";
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
  const [tab, setTab] = useState<TreasuryTab>(() => resolveTreasuryTab(initialTab));

  useEffect(() => {
    if (!initialTab || !TREASURY_TABS.has(initialTab as TreasuryTab)) return;
    setTab(initialTab as TreasuryTab);
  }, [initialTab]);

  const selectTab = (next: TreasuryTab) => {
    setTab(next);
    onTabChange?.(next);
  };

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
    {
      id: string;
      symbol: string;
      decimals: number;
      chain: string;
      balance: string;
      spendRail?: boolean;
      onchainSync?: boolean;
      backing?: { kind: "chain" | "chain-unconfigured" | "manual"; reason?: string };
      onchainBalance?: string | null;
      onchainError?: string;
      drift?: string | null;
    }[]
  >([]);
  const [assetId, setAssetId] = useState("asset_usdc");
  const selectedAsset = holdings.find((h) => h.id === assetId);
  /** True when this asset's balance is read from the chain, not typed in. */
  const assetIsChainBacked =
    assetId === "asset_usdc" || selectedAsset?.backing?.kind === "chain";
  /**
   * A live org may not record balances by hand for anything the chain can
   * answer for. Assets with no adapter keep the manual path — a coverage gap
   * is not permission to invent numbers where coverage exists.
   */
  const usdcLive = ledgerMode === "live" && assetIsChainBacked;
  const [onchain, setOnchain] = useState<{
    ok: boolean;
    error?: string;
    networkName?: string;
    network?: string;
    chainId?: number;
    vaultAddress?: string | null;
    usdcContract?: string;
    explorerAddress?: string;
    onchainBalanceUsdc?: string;
    nativeBalanceEth?: string;
    hasGas?: boolean;
    blockNumber?: string;
    scannedFromBlock?: string;
    scannedToBlock?: string;
    transfers?: {
      txHash: string;
      logIndex: number;
      blockNumber: string;
      from: string;
      amountUsdc: string;
      explorerUrl: string;
      status: "detected" | "credited";
    }[];
  } | null>(null);
  const [onchainBusy, setOnchainBusy] = useState(false);
  /** Books vs chain. `checked: false` means unknown, not reconciled. */
  const [backing, setBacking] = useState<{
    ok: boolean;
    checked: boolean;
    error?: string;
    onchainUsdc: string;
    expectedUsdc: string;
    driftUsdc: string;
    unbackedUsdc: string;
    ledgerMode: "sandbox" | "live";
    at: string;
  } | null>(null);
  const [vaultActivity, setVaultActivity] = useState<
    {
      id: string;
      kind: string;
      source: string;
      assetId?: string;
      symbol?: string;
      amountUsdc: string;
      direction: "in" | "out";
      at: string;
      label: string;
      from?: string;
      txHash?: string;
      explorerUrl?: string;
      network?: string;
      memo?: string;
      blockNumber?: string;
    }[]
  >([]);
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

  const refreshOnchain = useCallback(async () => {
    setOnchainBusy(true);
    try {
      const [d, act] = await Promise.all([
        gFetch("/v1/guardian/treasury/onchain").then((x) => x.json()),
        gFetch("/v1/guardian/treasury/vault-activity").then((x) => x.json()),
      ]);
      setOnchain(d.onchain ?? null);
      setBacking(d.backing ?? null);
      setVaultActivity(act.items ?? []);
      if ((d.creditedCount ?? 0) > 0) {
        await refresh();
      }
      return d as {
        creditedCount?: number;
        note?: string;
        newlyCredited?: { amountUsdc: string; txHash: string }[];
      };
    } catch {
      setOnchain({ ok: false, error: "Could not reach on-chain status" });
      return null;
    } finally {
      setOnchainBusy(false);
    }
  }, [gFetch, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (tab !== "fund") return;
    void refreshOnchain();
    // Auto-poll while Fund is open so faucet deposits credit without a Sync click.
    const t = window.setInterval(() => {
      void refreshOnchain();
    }, 25_000);
    return () => window.clearInterval(t);
  }, [tab, refreshOnchain, assetId]);

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
    <div className="console-page treasury-page">
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
            onValueChange={(v) => selectTab(v as typeof tab)}
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
                  const sym = sel?.symbol ?? "USDC";
                  const bal =
                    assetId === "asset_usdc"
                      ? (wallets?.org.availableUsdc ?? sel?.balance ?? "0")
                      : (sel?.balance ?? "0");
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
                {(holdings.find((h) => h.id === assetId) ?? holdings[0])?.chain ?? "—"}
                {assetId === "asset_usdc" && vault ? (
                  <>
                    {" · "}
                    <code className="mono" style={{ fontSize: 11 }}>
                      {vault.slice(0, 10)}…{vault.slice(-6)}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      style={{ marginLeft: 6, color: "inherit" }}
                      disabled={!vault}
                      onClick={() => void copyVault()}
                    >
                      {copied ? "Copied" : "Copy address"}
                    </Button>
                  </>
                ) : null}
                {assetId === "asset_usdc" ? (
                  <span className="wallet-hero-pill">Spend rail · agents pay from this</span>
                ) : (
                  <span className="wallet-hero-pill">Vault holding</span>
                )}
              </div>
            </div>

            <div className="wallet-assets" role="list" aria-label="Vault assets">
              {(holdings.length
                ? holdings
                : [
                    {
                      id: "asset_usdc",
                      symbol: "USDC",
                      decimals: 6,
                      chain: "base-sepolia",
                      balance: wallets?.org.availableUsdc ?? "0",
                    },
                  ]
              ).map((h) => {
                const active = h.id === assetId;
                const n = Number(
                  h.id === "asset_usdc" ? (wallets?.org.availableUsdc ?? h.balance) : h.balance,
                );
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
                      <span className="faint">
                        {h.chain}
                        {h.id === "asset_usdc" ? " · spend" : ""}
                        {h.id !== "asset_usdc" && h.backing
                          ? h.backing.kind === "chain"
                            ? " · on-chain"
                            : " · recorded"
                          : ""}
                      </span>
                    </span>
                    <span className="wallet-asset-bal mono">
                      {Number.isNaN(n)
                        ? h.balance
                        : n.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                      {/* A recorded balance the chain disagrees with is the
                          multi-asset form of drift — flag it on the row. */}
                      {h.drift && Number(h.drift) !== 0 ? (
                        <span className="pill warn" style={{ marginLeft: 6 }}>
                          <i /> drift {h.drift}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {assetId === "asset_usdc" && (
            <div className="card">
              <div className="card-head">
                <div>
                  <h2 style={{ margin: 0 }}>On-chain (Base)</h2>
                  <div className="sub">
                    Real USDC at this vault on {onchain?.networkName ?? "Base Sepolia"}. Deposits
                    auto-credit into the spendable ledger when you open Fund (and every ~25s while
                    this tab is open).
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={onchainBusy || locked}
                    onClick={() => void refreshOnchain()}
                  >
                    {onchainBusy ? "Checking…" : "Refresh"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={onchainBusy || locked}
                    onClick={() =>
                      void act("Force deposit re-scan", async () => {
                        setOnchainBusy(true);
                        try {
                          const res = await gFetch("/v1/guardian/treasury/onchain/sync", {
                            method: "POST",
                          });
                          const j = await res.json();
                          if (!res.ok) throw new Error(j.error?.message ?? "Sync failed");
                          setOnchain(j.onchain ?? null);
                          await refresh();
                          await refreshOnchain();
                          return j.note ?? `Credited ${j.creditedCount ?? 0} deposit(s).`;
                        } finally {
                          setOnchainBusy(false);
                        }
                      })
                    }
                  >
                    Force re-scan
                  </Button>
                </div>
              </div>

              {onchain?.error && !onchain.ok ? (
                <div className="banner" style={{ marginBottom: 10 }}>
                  <span className="txt">
                    <b>Chain read failed</b>
                    <span>{onchain.error}</span>
                  </span>
                </div>
              ) : null}

              <div className="wallet-onchain-stats">
                <div>
                  <span className="faint">On-chain USDC</span>
                  <b>{onchain?.onchainBalanceUsdc ?? "—"}</b>
                </div>
                <div>
                  <span className="faint">Ledger (spendable)</span>
                  <b>{fmt(wallets?.org.availableUsdc)}</b>
                </div>
                <div>
                  <span className="faint">ETH (gas)</span>
                  <b style={{ color: onchain?.hasGas ? undefined : "var(--amber, var(--warn))" }}>
                    {onchain?.nativeBalanceEth != null ? `${onchain.nativeBalanceEth} ETH` : "—"}
                    {onchain && !onchain.hasGas ? " · needed" : ""}
                  </b>
                </div>
                <div>
                  <span className="faint">Network</span>
                  <b>
                    {onchain?.networkName ?? "—"}
                    {onchain?.chainId ? ` · ${onchain.chainId}` : ""}
                  </b>
                </div>
              </div>

              {backing && (
                <div
                  className={`banner ${backing.checked && !backing.ok ? "warn" : ""}`}
                  style={{ marginTop: 12 }}
                >
                  <span className="txt">
                    <b>
                      {!backing.checked
                        ? "Backing unknown"
                        : backing.ok
                          ? "Books match the chain"
                          : `Drift ${backing.driftUsdc} USDC`}
                    </b>
                    <span>
                      {!backing.checked ? (
                        backing.error ??
                        "The vault could not be read, so this is unverified rather than clean."
                      ) : backing.ok ? (
                        <>
                          Vault holds {backing.onchainUsdc}, books expect {backing.expectedUsdc}.
                          {backing.ledgerMode === "sandbox" &&
                            ` ${backing.unbackedUsdc} of the ledger is simulated and excluded.`}
                        </>
                      ) : (
                        <>
                          Vault holds {backing.onchainUsdc} but the books expect{" "}
                          {backing.expectedUsdc}.{" "}
                          {Number(backing.driftUsdc) < 0
                            ? "Money left without the ledger recording it."
                            : "Funds arrived that the ledger has not credited."}
                        </>
                      )}
                    </span>
                  </span>
                </div>
              )}

              <p className="faint" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
                Agent pays to an allowlisted wallet broadcast real USDC from this vault — fund{" "}
                <b>USDC</b> and a little <b>ETH</b> for gas, Sync, then Policy → address allowlist →
                Playground “On-chain wallet pay” (or curl / demo-agent).
              </p>

              {onchain?.explorerAddress ? (
                <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
                  <a href={onchain.explorerAddress} target="_blank" rel="noreferrer">
                    Open vault on Basescan
                  </a>
                  {" · "}
                  USDC {onchain.usdcContract?.slice(0, 8)}…
                </p>
              ) : null}

              {(onchain?.transfers?.length ?? 0) > 0 && (
                <div style={{ marginTop: 14 }}>
                  <b style={{ fontSize: 13 }}>Detected on chain</b>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                    {onchain!.transfers!.slice(0, 6).map((t) => (
                      <div key={`${t.txHash}-${t.logIndex}`} className="wallet-tx-row">
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>
                            +{t.amountUsdc} USDC{" "}
                            <span className={`pill ${t.status === "credited" ? "ok" : "warn"}`}>
                              <i /> {t.status}
                            </span>
                          </div>
                          <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>
                            from {t.from.slice(0, 8)}…{t.from.slice(-4)} · block {t.blockNumber}
                          </div>
                        </div>
                        <a href={t.explorerUrl} target="_blank" rel="noreferrer">
                          Tx
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <div>
                <h2 style={{ margin: 0 }}>Activity</h2>
                <div className="sub">
                  Incoming and outgoing for{" "}
                  {holdings.find((h) => h.id === assetId)?.symbol ?? "this asset"} — including
                  external wallet receives once synced.
                </div>
              </div>
            </div>
            {(() => {
              const rows = vaultActivity.filter((i) => !assetId || i.assetId === assetId || (!("assetId" in i) && assetId === "asset_usdc"));
              // vaultActivity items always have assetId from API; filter client-side
              const filtered = vaultActivity.filter((i) => (i as { assetId?: string }).assetId === assetId || (!(i as { assetId?: string }).assetId && assetId === "asset_usdc"));
              const list = filtered.length ? filtered : rows;
              if (list.length === 0) {
                return (
                  <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                    No history yet for this asset. For USDC: send Base Sepolia USDC to the vault
                    address, then Sync deposits. For BTC/ETH/others: use Receive below to record a
                    holding.
                  </p>
                );
              }
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {list.slice(0, 25).map((t) => (
                    <div key={t.id} className="wallet-tx-row">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          {t.direction === "in" ? "+" : "−"}
                          {t.amountUsdc} {(t as { symbol?: string }).symbol ?? "USDC"}
                          <span className="faint" style={{ fontWeight: 500, marginLeft: 8 }}>
                            {t.label}
                          </span>
                        </div>
                        <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>
                          {new Date(t.at).toLocaleString()}
                          {t.from ? ` · from ${t.from.slice(0, 8)}…` : ""}
                          {t.network ? ` · ${t.network}` : ""}
                        </div>
                      </div>
                      {t.explorerUrl ? (
                        <a href={t.explorerUrl} target="_blank" rel="noreferrer">
                          Tx
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2 style={{ margin: 0 }}>
                  {usdcLive ? "Send USDC from the vault" : "Manual ledger receive / send"}
                </h2>
                <div className="sub">
                  {assetId === "asset_usdc"
                    ? usdcLive
                      ? "This organization holds real money. Send broadcasts a USDC transfer from the vault on-chain — the ledger only records it once the transfer succeeds. To add funds, send USDC to the vault address above."
                      : "Simulated money — books only, nothing moves on-chain. This organization is in sandbox mode, so these balances are not backed by vault funds."
                    : (selectedAsset?.backing?.reason ??
                      `Record ${selectedAsset?.symbol ?? "asset"} into vault holdings.`)}
                </div>
              </div>
              <span className={`wallet-hero-pill ${usdcLive ? "" : "warn"}`}>
                {usdcLive
                  ? "Live · real funds"
                  : assetIsChainBacked
                    ? "Sandbox · simulated"
                    : "Recorded by hand"}
              </span>
            </div>
            <div className="grid g-2 fill">
              {usdcLive ? (
                <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                  <b style={{ display: "block", marginBottom: 4 }}>Adding funds</b>
                  Send USDC on {wallets?.asset.chain ?? "base-sepolia"} to the vault address. The
                  deposit sweep credits it automatically once the transfer confirms — there is no
                  way to add balance that did not arrive.
                </div>
              ) : (
              <Form {...depositForm}>
                <form
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                  onSubmit={depositForm.handleSubmit((values) =>
                    void act("Receive", async () => {
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
                      await refreshOnchain();
                      depositForm.reset({ amountUsdc: "100" });
                      return j.simulated
                        ? `Recorded a simulated ${j.amountUsdc} ${j.symbol ?? "USDC"} deposit — not backed by vault funds.`
                        : `Received ${j.amountUsdc} ${j.symbol ?? "USDC"} into the vault.`;
                    }),
                  )}
                >
                  <FormField
                    control={depositForm.control}
                    name="amountUsdc"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Receive ({holdings.find((h) => h.id === assetId)?.symbol ?? "USDC"})
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
              )}

              <Form {...withdrawForm}>
                <form
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                  onSubmit={withdrawForm.handleSubmit((values) =>
                    void act("Send", async () => {
                      const res = await gFetch("/v1/guardian/treasury/withdraw", {
                        method: "POST",
                        body: JSON.stringify({
                          amountUsdc: values.amountUsdc.trim(),
                          destination: values.destination?.trim() || undefined,
                          assetId,
                        }),
                      });
                      const j = await res.json();
                      if (!res.ok) throw new Error(j.error?.message ?? "Withdraw failed");
                      withdrawForm.reset({ amountUsdc: "", destination: "" });
                      await refresh();
                      await refreshOnchain();
                      return j.simulated
                        ? `Recorded a simulated ${j.amountUsdc} ${j.symbol ?? "USDC"} outflow — nothing moved on-chain.`
                        : `Sent ${j.amountUsdc} ${j.symbol ?? "USDC"} from the vault${j.txHash ? ` · ${String(j.txHash).slice(0, 10)}…` : ""}.`;
                    }),
                  )}
                >
                  <FormField
                    control={withdrawForm.control}
                    name="amountUsdc"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Send ({holdings.find((h) => h.id === assetId)?.symbol ?? "USDC"})
                        </FormLabel>
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
                        <FormLabel>Destination / memo</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            disabled={readOnly}
                            placeholder="external wallet / note"
                            data-shortcut-ignore
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" size="sm" variant="ghost" disabled={locked}>
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
                      selectTab("move");
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
                      selectTab("move");
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
                      selectTab("move");
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
    </div>
  );
}
