"use client";
import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { OrgView, View } from "./console-types";
import { LiquidWalletCard } from "./liquid-wallet-card";
import { TreasuryView } from "./treasury-view";
import { Icon } from "./ui";
import { marketplaceJson } from "./marketplace-catalog";
import { receiveAddressFor, type WalletProfile } from "./wallet-profile";
import { walletSummary } from "./wallet-summary";
import { hasReceivingDetails } from "./wallet-receive-validation";

type Pool = { id: string; name: string; availableUsdc: string; heldUsdc: string };
type Wallets = { org: Pool; departments: Pool[]; shared: Pool[] };
type Activity = { id: string; label: string; amountUsdc: string; direction: string; at: string };
type Move = { id: string; amountUsdc: string; status: string; createdAt: string };
type Action = "receive" | "allocate" | "move" | "budgets";
export function WalletWorkspace({
  org,
  gFetch,
  readOnly,
  busy,
  act,
  onNavigate,
  initialAction,
}: {
  org: OrgView | null | undefined;
  gFetch: (path: string, init?: RequestInit) => Promise<Response>;
  readOnly: boolean;
  busy: boolean;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  onNavigate: (view: View, tab?: string) => void;
  initialAction?: string | null;
}) {
  const [wallets, setWallets] = useState<Wallets | null>(null),
    [profile, setProfile] = useState<WalletProfile | null>(null);
  const [activity, setActivity] = useState<Activity[] | null>(null),
    [moves, setMoves] = useState<Move[] | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [action, setAction] = useState<Action | null>(
    initialAction === "move" ? "move" : initialAction === "wallets" ? "budgets" : null,
  );
  const [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState("");
  const [allocationTarget, setAllocationTarget] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    const paths = [
      "/v1/guardian/wallets",
      "/v1/guardian/wallet",
      "/v1/guardian/treasury/vault-activity?assetId=asset_usdc",
      "/v1/guardian/treasury/moves",
    ];
    const results = await Promise.allSettled(
      paths.map(async (p) => marketplaceJson(await gFetch(p))),
    );
    const errors: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "rejected") {
        errors.push(["Balances", "Receiving details", "Wallet activity", "Fund movements"][i]);
        if (i === 1) setProfile(null);
        continue;
      }
      try {
        if (i === 0) {
          walletSummary(r.value);
          setWallets(r.value);
        }
        if (i === 1) {
          if (!hasReceivingDetails(r.value)) throw Error();
          setProfile(r.value);
        }
        if (i === 2) {
          if (!Array.isArray(r.value.items)) throw Error();
          setActivity(r.value.items);
        }
        if (i === 3) {
          if (!Array.isArray(r.value.moves)) throw Error();
          setMoves(r.value.moves);
        }
      } catch {
        if (i === 1) setProfile(null);
        errors.push(["Balances", "Receiving details", "Wallet activity", "Fund movements"][i]);
      }
    }
    setError(
      errors.length
        ? `${errors.join(", ")} could not refresh. Previously loaded data may be out of date. Try again.`
        : "",
    );
    setLoading(false);
  }, [gFetch]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(t);
  }, [copied]);
  const totals = wallets ? walletSummary(wallets) : null;
  const address = receiveAddressFor(profile, "asset_usdc");
  const network =
    profile?.network.name ?? (org?.network?.testnet === false ? "Base" : "Base Sepolia");
  const pools = [...(wallets?.departments ?? []), ...(wallets?.shared ?? [])];
  const rows = [
    ...(activity ?? []).map((a) => ({
      id: a.id,
      label: a.label,
      amount: a.amountUsdc,
      status: a.direction === "in" ? "Received" : "Outgoing",
      at: a.at,
    })),
    ...(moves ?? []).map((m) => ({
      id: m.id,
      label: "Fund movement",
      amount: m.amountUsdc,
      status: m.status,
      at: m.createdAt,
    })),
  ]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 8);
  const pending = (moves ?? []).filter((m) => m.status === "pending");
  function close() {
    setAction(null);
    setCopied(false);
    setCopyError("");
    void load();
  }
  return (
    <section className="minimal-page wallet-workspace" aria-busy={loading}>
      <button className="wallet-back" onClick={() => onNavigate("overview")}>
        <Icon name="arrowLeft" size={18} /> Back to Overview
      </button>
      <header className="minimal-page-heading">
        <div>
          <h1>Wallet</h1>
          <p>Your workspace funds and agent allocations.</p>
        </div>
        <button disabled={loading} onClick={() => void load()} aria-label="Refresh wallet">
          <Icon name="refresh" size={17} />
          <span>Refresh</span>
        </button>
      </header>
      {error && (
        <p role="alert" className="minimal-error">
          {error}{" "}
          <button disabled={loading} onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}
      <div className="wallet-summary-grid">
        <LiquidWalletCard name={org?.org.name} network={network} />
        <div className="wallet-summary-right">
          <dl className="wallet-balances">
            {[
              ["Available", "wallet", totals?.available],
              ["Allocated", "layers", totals?.allocated],
              ["Pending", "clock", totals?.pending],
            ].map(([label, icon, value]) => (
              <div key={label}>
                <dt>
                  <Icon name={icon!} size={23} />
                  {label}
                </dt>
                <dd>{value === undefined ? "—" : `${value} USDC`}</dd>
              </div>
            ))}
          </dl>
          <div className="wallet-primary-actions">
            {[
              ["receive", "Receive", "download"],
              ["allocate", "Allocate", "layers"],
              ["move", "Move", "swap"],
            ].map(([value, label, icon]) => (
              <button
                key={value}
                disabled={value !== "receive" && (readOnly || !wallets || busy)}
                className={value === "receive" ? "minimal-primary" : ""}
                onClick={() => {
                  setCopyError("");
                  setAllocationTarget(null);
                  setAction(value as Action);
                }}
              >
                <Icon name={icon} size={22} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <section className="minimal-section">
        <header className="wallet-section-heading">
          <div>
            <h2>Agent allocations</h2>
            <p>Fund a group allowance before its agents can purchase.</p>
          </div>
          <button onClick={() => onNavigate("billing", "limits")}>
            Manage spending limits <Icon name="arrowRight" size={16} />
          </button>
        </header>
        {!wallets ? (
          <p className="wallet-empty">
            {loading ? "Loading allocations…" : "Allocations unavailable. Refresh to try again."}
          </p>
        ) : pools.length ? (
          <div className="wallet-allocation-list">
            {pools.map((p) => (
              <article key={p.id}>
                <Icon name="layers" size={24} />
                <div>
                  <h3>{p.name}</h3>
                  <p>
                    {org?.agents.filter((a) => a.budget?.id === p.id).length ?? 0} connected agents
                    · {p.heldUsdc} USDC held
                  </p>
                </div>
                <strong>{p.availableUsdc} USDC</strong>
                <button
                  disabled={readOnly || busy}
                  onClick={() => {
                    setAllocationTarget(
                      `${wallets?.shared.some((w) => w.id === p.id) ? "shared" : "department"}:${p.id}`,
                    );
                    setAction("allocate");
                  }}
                >
                  Allocate
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="wallet-empty">
            <Icon name="layers" size={26} />
            <span>No allocations yet</span>
            <button disabled={readOnly || busy} onClick={() => setAction("budgets")}>
              Create allowance
            </button>
          </div>
        )}
        {pools.length > 0 && (
          <button
            className="wallet-text-action"
            disabled={readOnly || busy}
            onClick={() => setAction("budgets")}
          >
            Manage allowances <Icon name="arrowRight" size={16} />
          </button>
        )}
      </section>
      <section className="minimal-section">
        <header className="wallet-section-heading">
          <h2>Recent activity</h2>
          {pending.length > 0 && (
            <button disabled={readOnly || busy} onClick={() => setAction("move")}>
              Review pending movements <Icon name="arrowRight" size={16} />
            </button>
          )}
        </header>
        {activity === null || moves === null ? (
          <p className="wallet-empty">
            {loading
              ? "Loading wallet activity…"
              : "Some activity is unavailable. Refresh to try again."}
          </p>
        ) : rows.length ? (
          <div className="wallet-activity-list">
            {rows.map((r) => (
              <article key={r.id}>
                <Icon name={r.status === "Received" ? "download" : "swap"} size={22} />
                <div>
                  <h3>{r.label}</h3>
                  <p>
                    <time dateTime={r.at}>{new Date(r.at).toLocaleString()}</time> · {r.status}
                  </p>
                </div>
                <strong>{r.amount} USDC</strong>
              </article>
            ))}
          </div>
        ) : (
          <div className="wallet-empty">
            <Icon name="clock" size={26} />
            <span>No wallet activity yet.</span>
          </div>
        )}
      </section>
      <button
        className="wallet-text-action wallet-security-link"
        onClick={() => onNavigate("settings", "security")}
      >
        <Icon name="shield" size={18} />
        Security and recovery <Icon name="arrowRight" size={16} />
      </button>
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !busy) close();
        }}
      >
        <DialogContent className="wallet-action-dialog">
          <DialogTitle>
            {action === "receive"
              ? "Receive USDC"
              : action === "budgets"
                ? "Manage allowances"
                : action === "allocate"
                  ? "Allocate funds"
                  : "Move funds"}
          </DialogTitle>
          <DialogDescription>
            {action === "receive"
              ? `Use only the verified receiving address on ${network}.`
              : "Existing permissions, available balances and approval rules apply."}
          </DialogDescription>
          {action === "receive" ? (
            <div className="wallet-receive-details">
              <p className="wallet-network">
                <Icon name="shield" size={18} />
                {network}
                {profile?.network.testnet !== false ? " · Test network" : ""}
              </p>
              {address ? (
                <>
                  <label>
                    Receiving address<code>{address}</code>
                  </label>
                  <button
                    className="minimal-primary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(address);
                        setCopied(true);
                        setCopyError("");
                      } catch {
                        setCopyError(
                          "Could not copy. Select the address above and copy it manually.",
                        );
                      }
                    }}
                  >
                    <Icon name={copied ? "check" : "copy"} size={17} />
                    {copied ? "Copied" : "Copy address"}
                  </button>
                  <span role="status" className="sr-only">
                    {copied ? "Receiving address copied" : ""}
                  </span>
                </>
              ) : (
                <p role="status">
                  {loading
                    ? "Verifying your receiving address…"
                    : "No verified receiving address is available. Refresh the wallet before sending funds."}
                </p>
              )}
              {copyError && <p role="alert">{copyError}</p>}
              {profile?.funding?.instructions?.map((line) => (
                <p key={line}>{line}</p>
              ))}
              <p>USD card credits are managed separately in Billing.</p>
            </div>
          ) : (
            action && (
              <>
                <div className="wallet-dialog-switch">
                  {action === "allocate" && !pools.length && (
                    <button onClick={() => setAction("budgets")}>
                      Create an allowance first <Icon name="arrowRight" size={16} />
                    </button>
                  )}
                  {action === "budgets" && (
                    <button onClick={() => setAction("allocate")}>
                      Allocate funds <Icon name="arrowRight" size={16} />
                    </button>
                  )}
                </div>
                <TreasuryView
                  key={action}
                  embedded
                  initialTab={action === "budgets" ? "wallets" : "move"}
                  initialMoveIntent={
                    action === "allocate" && !allocationTarget?.startsWith("shared:")
                      ? "budget"
                      : "custom"
                  }
                  initialDestination={allocationTarget}
                  gFetch={gFetch}
                  busy={busy}
                  readOnly={readOnly}
                  act={async (label, fn) => {
                    await act(label, fn);
                    await load();
                  }}
                />
              </>
            )
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
