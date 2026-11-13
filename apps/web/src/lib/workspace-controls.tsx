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
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
        <DialogContent className="reference-dialog abi-workspace-dialog">
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
  const [action, setAction] = useState<"allocate" | "limits" | null>(null),
    [to, setTo] = useState(""),
    [amount, setAmount] = useState(""),
    [review, setReview] = useState(false),
    [requestKey, setRequestKey] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState("");
  const [limit, setLimit] = useState(w.card.limitUsdc ?? "0"),
    [period, setPeriod] = useState(w.card.period),
    [recurring, setRecurring] = useState(w.card.allowRecurring);
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
          network="Base Sepolia"
          onOpen={() => {
            setAction("limits");
            setError("");
          }}
        />
        <div className="abi-workspace-balances">
          <dl>
            <div>
              <dt>Available</dt>
              <dd>{w.balance.availableUsdc} USDC</dd>
            </div>
            <div>
              <dt>Held</dt>
              <dd>{w.balance.heldUsdc} USDC</dd>
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
            <WorkspaceReceive gFetch={gFetch} />
            <Button
              disabled={readOnly || busy || !destinations.length}
              onClick={() => {
                setTo(destinations[0]?.id ?? "");
                setReview(false);
                setRequestKey(crypto.randomUUID());
                setError("");
                setAction("allocate");
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
        Deposits use the account’s existing verified receiving route and arrive in General. Allocate
        settled funds here; a workspace card does not imply a separate deposit address.
      </p>
      {receipt && <p role="status">{receipt}</p>}
      {error && !action && <p role="alert">{error}</p>}
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
        <DialogContent className="reference-dialog abi-workspace-dialog">
          <DialogTitle>
            {action === "allocate"
              ? review
                ? "Review allocation"
                : "Allocate between workspaces"
              : "Card spending limits"}
          </DialogTitle>
          <DialogDescription>
            {action === "allocate"
              ? "Only settled available funds move. Limits and spending history stay unchanged."
              : "One shared cap applies to every agent using this workspace card."}
          </DialogDescription>
          {action === "allocate" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!review) setReview(true);
                else
                  void mutate(`${prefix}/allocations`, {
                    toWorkspaceId: to,
                    amountUsdc: amount,
                    idempotencyKey: requestKey,
                  });
              }}
            >
              <label>
                From
                <input value={w.name} readOnly />
              </label>
              <label>
                To
                <select value={to} disabled={review} onChange={(e) => setTo(e.target.value)}>
                  {destinations.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · {x.balance.availableUsdc} USDC available
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Amount in USDC
                <input
                  required
                  inputMode="decimal"
                  pattern="[0-9]+(\.[0-9]{1,6})?"
                  value={amount}
                  disabled={review}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              {review && (
                <p>
                  Allocate {amount} USDC from {w.name} to{" "}
                  {destinations.find((x) => x.id === to)?.name}. Amounts above the treasury
                  threshold wait for approval.
                </p>
              )}
              {error && <p role="alert">{error}</p>}
              <Button type="submit" disabled={readOnly || busy || !to || !amount}>
                {busy ? "Submitting…" : review ? "Confirm allocation" : "Review allocation"}
              </Button>
              {review && (
                <Button type="button" variant="ghost" onClick={() => setReview(false)}>
                  Edit
                </Button>
              )}
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(
                  `${prefix}/card`,
                  { limitUsdc: limit, period, allowRecurring: recurring },
                  "PATCH",
                );
              }}
            >
              <label>
                Shared limit in USDC
                <input
                  required
                  inputMode="decimal"
                  pattern="[0-9]+(\.[0-9]{1,6})?"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
              </label>
              <label>
                Period
                <select value={period} onChange={(e) => setPeriod(e.target.value)}>
                  <option value="day">Per day (UTC)</option>
                  <option value="week">Per week (UTC)</option>
                  <option value="month">Per month (UTC)</option>
                  <option value="total">Total (up to 90 days)</option>
                </select>
              </label>
              <label className="abi-workspace-check">
                <input
                  type="checkbox"
                  checked={recurring}
                  onChange={(e) => setRecurring(e.target.checked)}
                />
                Allow recurring purchases under existing account controls
              </label>
              <p>
                Connected-service write actions remain unavailable. Increasing this limit does not
                add funds.
              </p>
              {error && <p role="alert">{error}</p>}
              <Button disabled={readOnly || busy} type="submit">
                Save shared limit
              </Button>
            </form>
          )}
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
      <h2>Allocations</h2>
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
    [error, setError] = useState("");
  async function show() {
    setOpen(true);
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
        Receive to General
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="reference-dialog abi-workspace-dialog">
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
              <p>{profile.network.name} · USDC</p>
              {address ? (
                <>
                  <code style={{ overflowWrap: "anywhere", display: "block" }}>{address}</code>
                  <Button
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(address)
                        .catch(() =>
                          setError("Clipboard unavailable. Select and copy the address manually."),
                        )
                    }
                  >
                    Copy verified address
                  </Button>
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
