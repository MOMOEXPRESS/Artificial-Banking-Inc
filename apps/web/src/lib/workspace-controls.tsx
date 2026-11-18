"use client";
import { WalletConnect } from "./wallet-connect";
import { CardActivity } from "./workspace-card-activity";
import { useState, useEffect } from "react";
import { KeyRound, Plus, Copy, Store, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { WalletLimitEditor } from "./wallet-limits";
import { CustomerWalletPanel } from "./customer-wallet-panel";
import { LiquidWalletCard } from "./liquid-wallet-card";
import { workspaceJson, type Workspace, type WorkspaceFetcher } from "./workspace-client";

type Props = {
  workspace: Workspace;
  workspaces: Workspace[];
  gFetch: WorkspaceFetcher;
  onChanged: () => Promise<void>;
  onNavigate: (v: string, tab?: string) => void;
  readOnly: boolean;
  initialTab?: string;
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
  readOnly,
  initialTab,
}: Props) {
  const [tab, setTab] = useState(
    initialTab === "settings" ? "settings" : initialTab === "activity" ? "activity" : "keys",
  );
  useEffect(() => {
    setTab(
      initialTab === "settings" ? "settings" : initialTab === "activity" ? "activity" : "keys",
    );
  }, [initialTab]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function toggleFreeze() {
    setBusy(true);
    setError("");
    try {
      await workspaceJson(
        await gFetch(`/v1/guardian/workspaces/${w.id}/card`, {
          method: "PATCH",
          body: JSON.stringify({ status: w.card.status === "active" ? "frozen" : "active" }),
        }),
      );
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="minimal-page abi-card-detail">
      <div className="abi-card-overview">
        <LiquidWalletCard name={w.name} network="Workspace allocation" currency="USDC" />
        <header className="abi-card-summary">
          <h1>{w.name} card</h1>
          <strong>
            {w.card.remainingUsdc} <span>USDC available for agents</span>
          </strong>
          <p>
            {w.card.spentUsdc} spent · {w.card.pendingUsdc} reserved · {w.card.status}
          </p>
          {!!w.accountAllocations?.length && (
            <p className="minimal-note">
              {w.accountAllocations
                .map(
                  (a) =>
                    `${a.amountUsdc} USDC on ${a.assetId.startsWith("base:") ? "Base" : "Ethereum"}`,
                )
                .join(" · ")}{" "}
              allocated at the account. Mainnet agent purchases are not enabled.
            </p>
          )}
          <p className="minimal-note">
            Agent spending currently uses the Base Sepolia allowance. Manage account funding and
            allocations in Billing.
          </p>
        </header>
      </div>
      <div className="abi-card-tabs" role="tablist" aria-label="Card details">
        {[
          ["keys", "Access keys"],
          ["settings", "Settings"],
          ["activity", "Activity"],
        ].map(([key, label]) => (
          <button
            key={key}
            id={`card-tab-${key}`}
            role="tab"
            type="button"
            aria-selected={tab === key}
            aria-controls="card-panel"
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
            onKeyDown={(e) => {
              const keys = ["keys", "settings", "activity"];
              const i = keys.indexOf(tab);
              const next =
                e.key === "ArrowRight"
                  ? keys[(i + 1) % 3]
                  : e.key === "ArrowLeft"
                    ? keys[(i + 2) % 3]
                    : e.key === "Home"
                      ? keys[0]
                      : e.key === "End"
                        ? keys[2]
                        : null;
              if (next) {
                e.preventDefault();
                setTab(next);
                document.getElementById(`card-tab-${next}`)?.focus();
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id="card-panel"
        role="tabpanel"
        aria-labelledby={`card-tab-${tab}`}
        className="abi-card-panel"
        key={tab}
      >
        {tab === "keys" && (
          <WalletConnect
            workspace={w}
            workspaces={workspaces}
            gFetch={gFetch}
            onChanged={onChanged}
            readOnly={readOnly}
            initialTab="keys"
            onTabChange={() => {}}
            cardOnly
          />
        )}
        {tab === "settings" && (
          <section className="minimal-section abi-card-settings">
            <h2>Spending limits</h2>
            <WalletLimitEditor
              workspace={w}
              workspaces={[w]}
              gFetch={gFetch}
              onChanged={onChanged}
              readOnly={readOnly}
              onSaved={() => {}}
              cardOnly
            />
            <div className="abi-card-freeze">
              <div>
                <h3>Card status</h3>
                <p>
                  Freezing stops new spending. Existing holds and refunds retain their original
                  accounts.
                </p>
              </div>
              <Button
                variant="ghost"
                disabled={readOnly || busy}
                onClick={() => void toggleFreeze()}
              >
                {w.card.status === "active" ? "Freeze card" : "Unfreeze card"}
              </Button>
            </div>
            {error && <p role="alert">{error}</p>}
          </section>
        )}
        {tab === "activity" && <CardActivity workspace={w} gFetch={gFetch} />}
      </div>
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

/** Historical address inspection lives in Settings, outside the deposit flow. */
export function LegacyWalletRecovery({ gFetch }: { gFetch: WorkspaceFetcher }) {
  const [profile, setProfile] = useState<import("./wallet-profile").WalletProfile | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function inspect() {
    setBusy(true);
    setError("");
    setProfile(null);
    try {
      const value = await workspaceJson(await gFetch("/v1/guardian/wallet"));
      const { hasReceivingDetails } = await import("./wallet-receive-validation");
      if (!hasReceivingDetails(value) || !value.addressVerified)
        throw new Error("No verified historical wallet address is available.");
      setProfile(value);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="minimal-section">
      <details className="abi-legacy-wallet">
        <summary>Historical wallet recovery</summary>
        <p>
          If you previously sent funds to the older account address, inspect it here. Existing funds
          remain at that address. New deposits use your workspace’s Add money action.
        </p>
        <Button variant="ghost" disabled={busy} onClick={() => void inspect()}>
          {busy ? "Checking…" : "Inspect historical wallet"}
        </Button>
        {error && <p role="alert">{error}</p>}
        {profile && (
          <dl className="abi-send-review">
            <div>
              <dt>Network</dt>
              <dd>
                {profile.network.name}
                {profile.network.testnet ? " · Testnet" : " · Mainnet"}
              </dd>
            </div>
            <div>
              <dt>Historical address</dt>
              <dd>
                <code>
                  {profile.address ??
                    profile.assets.find((a) => a.assetId === "asset_usdc")?.receiveAddress}
                </code>
              </dd>
            </div>
            <div>
              <dt>On-chain USDC</dt>
              <dd>{profile.usdc.onchainUsdc ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>ETH for network fees</dt>
              <dd>{profile.gas.balanceEth ?? "Unavailable"}</dd>
            </div>
          </dl>
        )}
      </details>
    </section>
  );
}

/** Owner recovery for assets received at a different asset account before separation. */
export function WorkspaceAssetRecovery({
  workspace,
  gFetch,
}: {
  workspace: Workspace;
  gFetch: WorkspaceFetcher;
}) {
  const [open, setOpen] = useState(false);
  const [sourceAccount, setSourceAccount] = useState<"USDC" | "ETH">("USDC");
  const [assetId, setAssetId] = useState("base:eth");
  return (
    <section className="minimal-section">
      <details>
        <summary>Recover assets at an earlier workspace address</summary>
        <p>
          Existing funds have not moved. If ETH was sent to this workspace’s original shared
          address, choose the USDC account below. Recovery uses the same reviewed transfer and
          security checks as Send.
        </p>
        <label>
          Account holding the funds
          <select
            aria-label="Recovery source account"
            value={sourceAccount}
            onChange={(e) => setSourceAccount(e.target.value as "USDC" | "ETH")}
          >
            <option value="USDC">USDC account · original workspace address</option>
            <option value="ETH">ETH account</option>
          </select>
        </label>
        <label>
          Asset and network to recover
          <select
            aria-label="Recovery asset and network"
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
          >
            {workspace.wallet?.assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.symbol} · {a.network} {a.testnet ? "Testnet" : "Mainnet"}
              </option>
            ))}
          </select>
        </label>
        <Button variant="ghost" onClick={() => setOpen(true)}>
          Review recovery transfer
        </Button>
        {open && (
          <CustomerWalletPanel
            key={`${workspace.id}:${sourceAccount}:${assetId}`}
            workspaceId={workspace.id}
            name={workspace.name}
            gFetch={gFetch}
            open={open}
            onOpenChange={setOpen}
            intent="send"
            sourceAccount={sourceAccount}
            recoveryAssetId={assetId}
          />
        )}
      </details>
    </section>
  );
}
