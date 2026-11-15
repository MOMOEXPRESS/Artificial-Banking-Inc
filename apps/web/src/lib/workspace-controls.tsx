"use client";
import { useState, useEffect } from "react";
import {
  KeyRound,
  Plus,
  Snowflake,
  ArrowRightLeft,
  ShieldCheck,
  Copy,
  Store,
  RefreshCw,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Wallet,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { WalletLimitEditor } from "./wallet-limits";
import { walletAmount } from "./managed-wallet-client";
import { CustomerWalletPanel } from "./customer-wallet-panel";
import { LiquidWalletCard } from "./liquid-wallet-card";
import { workspaceJson, type Workspace, type WorkspaceFetcher } from "./workspace-client";

type Props = {
  workspace: Workspace;
  workspaces: Workspace[];
  gFetch: WorkspaceFetcher;
  onChanged: () => Promise<void>;
  onNavigate: (v: string) => void;
  readOnly: boolean;
};
export function WorkspaceSwitcher({
  items,
  value,
  onSelect,
  gFetch,
  onChanged,
  readOnly,
}: {
  items: Workspace[];
  value: string;
  onSelect: (id: string) => void;
  gFetch: WorkspaceFetcher;
  onChanged: () => Promise<void>;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [createKey, setCreateKey] = useState("");
  async function create() {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await workspaceJson(
        await gFetch("/v1/guardian/workspaces", {
          method: "POST",
          body: JSON.stringify({ name: name.trim(), idempotencyKey: createKey }),
        }),
      );
      await onChanged();
      onSelect(result.workspace.id);
      setOpen(false);
      setName("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="abi-workspace-switcher">
      <label>
        <span className="sr-only">Active workspace</span>
        <select
          aria-label="Active workspace"
          value={value}
          onChange={(e) => onSelect(e.target.value)}
        >
          {items.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
              {w.orgId !== items.find((x) => x.id === value)?.orgId
                ? " · another account tenant"
                : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        aria-label="Create workspace"
        disabled={readOnly}
        onClick={() => {
          setCreateKey(crypto.randomUUID());
          setError("");
          setOpen(true);
        }}
      >
        <Plus size={17} />
      </button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <DialogContent className="reference-dialog abi-workspace-dialog abi-wallet-action-dialog">
          <span className="abi-dialog-symbol" aria-hidden="true">
            <Plus size={22} />
          </span>
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>
            A separate balance, one ABI card and shared spending controls. Your funds stay where
            they are.
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label>
              Workspace name
              <input
                autoFocus
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder="Travel, research, operations…"
                required
              />
            </label>
            <p>
              The new card starts with zero funds and a zero spending limit. Add funds and set its
              limit before enabling payments.
            </p>
            {error && <p role="alert">{error}</p>}
            <Button disabled={busy || !name.trim()} type="submit">
              {busy ? "Creating…" : "Create workspace"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export function WorkspaceFunds({
  workspace: w,
  workspaces,
  gFetch,
  onChanged,
  onNavigate,
  readOnly,
}: Props) {
  const [currenciesOpen, setCurrenciesOpen] = useState(false);
  const [walletIntent, setWalletIntent] = useState<"currencies" | "receive" | "send" | "allocate">(
    "currencies",
  );
  const [action, setAction] = useState<"limits" | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState("");
  async function mutate(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    try {
      const data = await workspaceJson(await gFetch(path, { method, body: JSON.stringify(body) }));
      await onChanged();
      setAction(null);
      setReceipt(
        data.allocation?.status === "pending"
          ? "Allocation is awaiting treasury approval. Funds have not moved."
          : data.allocation
            ? "Allocation completed. Both workspaces share the same receipt."
            : "Card controls saved.",
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const prefix = `/v1/guardian/workspaces/${w.id}`;
  const destinations = workspaces.filter((x) => x.orgId === w.orgId && x.id !== w.id);
  return (
    <section className="minimal-page abi-workspace-funds">
      <header className="minimal-page-heading">
        <h1>{w.name} wallet</h1>
        <p>Funds, card controls and connections for this workspace.</p>
      </header>
      <div className="abi-workspace-funds-grid">
        <LiquidWalletCard
          name={w.name}
          network={w.wallet?.asset.network ?? "Wallet setup"}
          currency={w.wallet?.asset.symbol ?? "USDC"}
          onOpen={() => {
            setWalletIntent("currencies");
            setCurrenciesOpen(true);
            setError("");
          }}
        />
        <div className="abi-workspace-balances">
          <dl>
            <div>
              <dt>On-chain balance · {w.wallet?.asset.network ?? "Wallet setup"}</dt>
              <dd>
                {walletAmount(w.wallet)} {w.wallet?.asset.symbol ?? "USDC"}
              </dd>
            </div>
            <div>
              <dt>Agent allowance · Base Sepolia</dt>
              <dd>{w.balance.availableUsdc} USDC</dd>
            </div>
            <div>
              <dt>Card capacity remaining</dt>
              <dd>{w.card.remainingUsdc} USDC</dd>
            </div>
            <div>
              <dt>Card status</dt>
              <dd>{w.card.status}</dd>
            </div>
          </dl>
          <p>
            All {w.connections.length} connected agents share these funds. USD card credits remain
            separate from USDC.
          </p>
          <div className="abi-workspace-actions">
            <Button
              variant="ghost"
              disabled={readOnly || !w.wallet?.receiveEnabled}
              onClick={() => {
                setWalletIntent("receive");
                setCurrenciesOpen(true);
              }}
            >
              <ArrowDownLeft size={16} />
              Receive
            </Button>
            <Button
              variant="ghost"
              disabled={readOnly || !w.wallet?.withdrawalEnabled}
              onClick={() => {
                setWalletIntent("send");
                setCurrenciesOpen(true);
              }}
            >
              <ArrowUpRight size={16} />
              Send
            </Button>
            <Button
              disabled={readOnly || busy || !w.wallet?.withdrawalEnabled || !destinations.length}
              onClick={() => {
                setWalletIntent("allocate");
                setCurrenciesOpen(true);
              }}
            >
              <ArrowRightLeft size={16} />
              Allocate
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setAction("limits");
                setError("");
              }}
            >
              <ShieldCheck size={16} />
              Spending limits
            </Button>
            <Button variant="ghost" onClick={() => onNavigate("connect")}>
              <KeyRound size={16} />
              Connections
            </Button>
          </div>
        </div>
      </div>
      <p className="abi-workspace-note">
        Your Privy wallet receives funds directly on the selected network. Agent payments still use
        the separate Base Sepolia allowance; mainnet deposits do not increase that allowance.
      </p>
      {!readOnly && (
        <CustomerWalletPanel
          key={w.id}
          workspaceId={w.id}
          name={w.name}
          gFetch={gFetch}
          open={currenciesOpen}
          onOpenChange={setCurrenciesOpen}
          intent={walletIntent}
          workspaces={workspaces.filter((x) => x.orgId === w.orgId)}
        />
      )}
      {receipt && <p role="status">{receipt}</p>}
      {error && !action && <p role="alert">{error}</p>}
      <details className="abi-legacy-wallet">
        <summary>Earlier account receiving address</summary>
        <p>
          Funds sent to the earlier account wallet stay there. They are separate from this
          workspace’s Privy wallet.
        </p>
        <WorkspaceReceive gFetch={gFetch} />
      </details>
      <section className="minimal-section">
        <h2>Card controls</h2>
        <p>
          {w.card.limitUsdc === null
            ? "Existing account and agent limits apply."
            : `${w.card.limitUsdc} USDC per ${w.card.period}, shared across every connection.`}{" "}
          {w.card.spentUsdc} spent · {w.card.pendingUsdc} reserved.
        </p>
        <Button
          variant="ghost"
          disabled={readOnly || busy}
          onClick={() =>
            void mutate(
              `${prefix}/card`,
              { status: w.card.status === "active" ? "frozen" : "active" },
              "PATCH",
            )
          }
        >
          <Snowflake size={16} />
          {w.card.status === "active" ? "Freeze card" : "Unfreeze card"}
        </Button>
        <p>
          Freezing stops new spending across all keys. Existing holds, settlement and refunds retain
          their original accounts.
        </p>
      </section>
      <WorkspaceAllocationHistory
        workspace={w}
        gFetch={gFetch}
        readOnly={readOnly}
        onChanged={onChanged}
      />
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null);
        }}
      >
        <DialogContent className="reference-dialog abi-workspace-dialog abi-wallet-action-dialog">
          <span className="abi-dialog-symbol" aria-hidden="true">
            <ShieldCheck size={22} />
          </span>
          <DialogTitle>Card spending limits</DialogTitle>
          <DialogDescription>
            One shared cap applies to every agent using this workspace card.
          </DialogDescription>
          <WalletLimitEditor
            workspace={w}
            workspaces={workspaces}
            gFetch={gFetch}
            onChanged={onChanged}
            readOnly={readOnly}
            onSaved={() => {
              setAction(null);
              setReceipt("Spending limit saved.");
            }}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
function WorkspaceAllocationHistory({
  workspace,
  gFetch,
  readOnly,
  onChanged,
}: {
  workspace: Workspace;
  gFetch: WorkspaceFetcher;
  readOnly: boolean;
  onChanged: () => Promise<void>;
}) {
  const [rows, setRows] = useState<
      {
        id: string;
        from_id: string;
        to_id: string;
        amount_micro: string;
        created_at: string;
        amountUsdc?: string;
        status?: string;
      }[]
    >([]),
    [error, setError] = useState(""),
    [resolving, setResolving] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    workspaceJsonPromise();
    async function workspaceJsonPromise() {
      try {
        const d = await workspaceJson(
          await gFetch(`/v1/guardian/workspaces/${workspace.id}/allocations`),
        );
        if (live) setRows(d.allocations);
      } catch {
        if (live) setError("Allocation history couldn’t load.");
      }
    }
    return () => {
      live = false;
    };
  }, [workspace, gFetch]);
  async function resolve(id: string, approve: boolean) {
    setResolving(id);
    setError("");
    try {
      const result = await workspaceJson(
        await gFetch(`/v1/guardian/treasury/moves/${id}/resolve`, {
          method: "POST",
          body: JSON.stringify({ approve }),
        }),
      );
      await onChanged();
      setNotice(
        result.outcome === "review"
          ? "Vote recorded. More approvals are required."
          : approve
            ? "Allocation approved."
            : "Allocation declined.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResolving(null);
    }
  }

  return (
    <section className="minimal-section">
      <h2>Agent allowance allocations</h2>
      <p>Earlier internal USDC allocations on Base Sepolia. On-chain transfers appear above.</p>
      {notice && <p role="status">{notice}</p>}
      {error ? (
        <p role="alert">{error}</p>
      ) : rows.length ? (
        <ul className="abi-workspace-history">
          {rows.map((r) => (
            <li key={r.id}>
              <ArrowRightLeft size={16} />
              <span>
                {r.from_id === workspace.id ? "Sent" : "Received"} ·{" "}
                {r.amountUsdc ?? r.amount_micro} USDC
                <small>
                  {r.status ?? "executed"} · {new Date(r.created_at).toLocaleString()} · {r.id}
                </small>
              </span>
              {r.status === "pending" && (
                <div>
                  <Button
                    size="sm"
                    disabled={readOnly || resolving !== null}
                    onClick={() => void resolve(r.id, true)}
                  >
                    Approve allocation
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={readOnly || resolving !== null}
                    onClick={() => void resolve(r.id, false)}
                  >
                    Decline
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>No workspace allocations yet.</p>
      )}
    </section>
  );
}
export function WorkspaceConnections({ workspace: w, gFetch, onChanged, readOnly }: Props) {
  const [name, setName] = useState(""),
    [pay, setPay] = useState(false),
    [ttl, setTtl] = useState("24"),
    [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState(() => crypto.randomUUID());
  async function create() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const d = await workspaceJson(
        await gFetch(`/v1/guardian/workspaces/${w.id}/connections`, {
          method: "POST",
          body: JSON.stringify({ name, pay, ttlHours: Number(ttl), idempotencyKey: key }),
        }),
      );
      setToken(d.sessionKey.token);
      setKey(crypto.randomUUID());
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function seller(linkExisting = false) {
    setBusy(true);
    setError("");
    try {
      await workspaceJson(
        await gFetch(`/v1/guardian/workspaces/${w.id}/seller`, {
          method: "POST",
          body: JSON.stringify({ linkExisting }),
        }),
      );
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const probe =
    typeof location !== "undefined"
      ? `${location.origin}/abi-api/v1/agent/context`
      : "/abi-api/v1/agent/context";
  return (
    <section className="minimal-page">
      <header className="minimal-page-heading">
        <h1>Connect to {w.name}</h1>
        <p>
          Each agent gets its own revocable key. Every key uses the same card, funds and shared
          limit.
        </p>
      </header>
      <div className="abi-workspace-connection-grid">
        <section>
          <h2>Create an agent connection</h2>
          <form
            className="abi-workspace-form"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label>
              Agent name
              <input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Travel assistant"
              />
            </label>
            <label>
              Key expires in
              <select value={ttl} onChange={(e) => setTtl(e.target.value)}>
                <option value="24">24 hours</option>
                <option value="168">7 days</option>
                <option value="720">30 days</option>
              </select>
            </label>
            <label className="abi-workspace-check">
              <input type="checkbox" checked={pay} onChange={(e) => setPay(e.target.checked)} />
              Allow payments from this card
            </label>
            <p>
              {pay
                ? `${w.card.remainingUsdc} USDC capacity remains under the card’s shared controls. Checkout and account approvals still apply.`
                : "Read access only. Payment permission is off by default."}
            </p>
            <Button
              disabled={readOnly || busy || !name.trim() || w.card.status !== "active"}
              type="submit"
            >
              <KeyRound size={16} />
              Create connection & key
            </Button>
          </form>
          {token && (
            <div className="abi-workspace-secret">
              <h3>Copy your key now</h3>
              <p>It is shown once. Do not share it in chat or put it in a URL.</p>
              <code>{token}</code>
              <Button
                variant="ghost"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(token)
                    .catch(() =>
                      setError("Clipboard unavailable. Select and copy the key manually."),
                    )
                }
              >
                <Copy size={15} />
                Copy key
              </Button>
              <Button variant="ghost" onClick={() => setToken("")}>
                I’ve saved it
              </Button>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
        </section>
        <section>
          <h2>Verify from your agent</h2>
          <p>
            Make this read-only request using the key as an Authorization header. A copied key or
            setup prompt does not verify a connection.
          </p>
          <pre>
            GET {probe}
            {"\n"}Authorization: Bearer &lt;your key&gt;
          </pre>
          <p>
            The response confirms its workspace, card, permissions and spending capacity. Hosted MCP
            remains testnet-only.
          </p>
          <h3>Connections</h3>
          {w.connections.length ? (
            <ul className="abi-workspace-history">
              {w.connections.map((c) => (
                <li key={c.id}>
                  <KeyRound size={17} />
                  <span>
                    <strong>{c.name}</strong>
                    <small>
                      {c.verifiedAt
                        ? `Last verified ${new Date(c.verifiedAt).toLocaleString()}`
                        : "Verification needed"}{" "}
                      · {c.status}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No agents connected yet.</p>
          )}
          <Button variant="ghost" onClick={() => void onChanged()}>
            <RefreshCw size={15} />
            Refresh verification
          </Button>
        </section>
      </div>
      <WorkspaceKeyList workspace={w} gFetch={gFetch} readOnly={readOnly} onToken={setToken} />
      <section className="minimal-section">
        <h2>Selling from this workspace</h2>
        <p>
          Use your ABI login for buying and selling. Seller verification, inventory and payouts
          remain separate from this card’s funds.
        </p>
        {w.sellerEnabled ? (
          <a
            href="/seller/catalog"
            onClick={() => sessionStorage.setItem("abi_seller_workspace", w.id)}
          >
            <Store size={16} /> Open seller inventory
          </a>
        ) : (
          <Button variant="ghost" disabled={readOnly || busy} onClick={() => void seller(false)}>
            <Store size={16} />
            Enable seller tools
          </Button>
        )}
      </section>
      {!w.sellerEnabled && (
        <>
          <p>
            Already have a seller account? Sign in to it in this browser, then link it here. Your
            existing business records and payouts are preserved.
          </p>
          <Button variant="ghost" disabled={readOnly || busy} onClick={() => void seller(true)}>
            Link existing seller account
          </Button>
        </>
      )}
    </section>
  );
}

function WorkspaceKeyList({
  workspace,
  gFetch,
  readOnly,
  onToken,
}: {
  workspace: Workspace;
  gFetch: WorkspaceFetcher;
  readOnly: boolean;
  onToken: (value: string) => void;
}) {
  const [keys, setKeys] = useState<
      { id: string; label?: string; scopes: string[]; expiresAt: string; revokedAt?: string }[]
    >([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const data = await workspaceJson(await gFetch("/v1/guardian/session-keys"));
    setKeys(data.sessionKeys ?? []);
  }

  useEffect(() => {
    let live = true;
    gFetch("/v1/guardian/session-keys")
      .then(workspaceJson)
      .then((d) => {
        if (live) setKeys(d.sessionKeys ?? []);
      })
      .catch(() => {
        if (live) setError("Keys couldn’t load. Try refreshing.");
      });
    return () => {
      live = false;
    };
  }, [workspace, gFetch]);
  async function change(id: string, operation: "revoke" | "replace") {
    setBusy(true);
    setError("");
    try {
      const data = await workspaceJson(
        await gFetch(`/v1/guardian/session-keys/${id}/${operation}`, {
          method: "POST",
          body: "{}",
        }),
      );
      if (data.sessionKey?.token) onToken(data.sessionKey.token);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="minimal-section">
      <h2>API keys</h2>
      <p>
        Rotate a key to invalidate its previous secret. Revoking one key leaves other agents
        connected.
      </p>
      {error && <p role="alert">{error}</p>}
      {keys.length ? (
        <ul className="abi-workspace-history">
          {keys.map((k) => (
            <li key={k.id}>
              <KeyRound size={16} />
              <span>
                <strong>{k.label ?? "Connection key"}</strong>
                <small>
                  {k.scopes.join(", ")} ·{" "}
                  {k.revokedAt
                    ? "Revoked"
                    : Date.parse(k.expiresAt) <= Date.now()
                      ? "Expired"
                      : `Expires ${new Date(k.expiresAt).toLocaleString()}`}
                </small>
              </span>
              <Button
                variant="ghost"
                disabled={
                  readOnly || busy || !!k.revokedAt || Date.parse(k.expiresAt) <= Date.now()
                }
                onClick={() => void change(k.id, "replace")}
              >
                Rotate
              </Button>
              <Button
                variant="ghost"
                disabled={readOnly || busy || !!k.revokedAt}
                onClick={() => void change(k.id, "revoke")}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No keys issued in this workspace.</p>
      )}
    </section>
  );
}

function WorkspaceReceive({ gFetch }: { gFetch: WorkspaceFetcher }) {
  const [open, setOpen] = useState(false),
    [profile, setProfile] = useState<import("./wallet-profile").WalletProfile | null>(null),
    [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  async function show() {
    setOpen(true);
    setCopied(false);
    setProfile(null);
    setError("");
    try {
      const value = await workspaceJson(await gFetch("/v1/guardian/wallet"));
      const { hasReceivingDetails } = await import("./wallet-receive-validation");
      if (!hasReceivingDetails(value) || !value.addressVerified)
        throw new Error("No verified receiving address is currently available.");
      setProfile(value);
    } catch (e) {
      setProfile(null);
      setError((e as Error).message);
    }
  }
  const address = profile?.addressVerified
    ? profile.assets.find((a) => a.assetId === "asset_usdc")?.receiveAddress
    : null;
  return (
    <>
      <Button variant="ghost" onClick={() => void show()}>
        <ArrowDownLeft size={16} aria-hidden="true" />
        Receive to General
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="reference-dialog abi-workspace-dialog abi-wallet-action-dialog">
          <span className="abi-dialog-symbol" aria-hidden="true">
            <ArrowDownLeft size={22} />
          </span>
          <DialogTitle>Receive funds into General</DialogTitle>
          <DialogDescription>
            Use only the supported network below. Funds arrive in this account’s General workspace;
            allocate them to another workspace afterwards.
          </DialogDescription>
          {error ? (
            <p role="alert">{error}</p>
          ) : !profile ? (
            <p role="status">Verifying receiving details…</p>
          ) : (
            <>
              <div className="abi-receive-network">
                <Wallet size={22} aria-hidden="true" />
                <div>
                  <strong>USDC</strong>
                  <span>{profile.network.name}</span>
                </div>
              </div>
              {address ? (
                <>
                  <div className="abi-receive-address">
                    <span>Receiving address</span>
                    <code>{address}</code>
                  </div>
                  <Button
                    className="abi-receive-copy"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(address)
                        .then(() => setCopied(true))
                        .catch(() =>
                          setError("Clipboard unavailable. Select and copy the address manually."),
                        )
                    }
                  >
                    {copied ? (
                      <Check size={16} aria-hidden="true" />
                    ) : (
                      <Copy size={16} aria-hidden="true" />
                    )}
                    {copied ? "Address copied" : "Copy address"}
                  </Button>
                  <p className="abi-receive-instruction">
                    Send only USDC on {profile.network.name} to this address. Transfers on a
                    different network won’t appear in this balance.
                  </p>
                  <span role="status" className="sr-only">
                    {copied ? "Receiving address copied to clipboard" : ""}
                  </span>
                </>
              ) : (
                <p>A verified USDC receiving address is unavailable.</p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
