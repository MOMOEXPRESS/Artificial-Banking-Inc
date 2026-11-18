"use client";
import { useState, useEffect, useCallback } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Wallet,
  Plug,
  ChevronDown,
  Store,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { AgentLogoCluster } from "./agent-logo-cluster";
import { workspaceJson, type Workspace, type WorkspaceFetcher } from "./workspace-client";
type KeyRow = {
  id: string;
  label?: string;
  scopes: string[];
  expiresAt: string;
  revokedAt?: string;
  workspaceIds: string[];
};
const permissionLabels: Record<string, string> = {
  read: "Run tools",
  pay: "Payments",
  "wallets:create": "Create empty wallets",
  "cards:manage": "Freeze/unfreeze cards",
  "keys:manage": "Rotate/revoke this key",
};
export function WalletConnect({
  workspace: w,
  workspaces,
  gFetch,
  onChanged,
  readOnly,
  initialTab,
  onTabChange,
  cardOnly = false,
}: {
  workspace: Workspace;
  workspaces: Workspace[];
  gFetch: WorkspaceFetcher;
  onChanged: () => Promise<void>;
  readOnly: boolean;
  initialTab?: string;
  cardOnly?: boolean;
  onTabChange: (v: string) => void;
}) {
  const [tab, setTab] = useState(initialTab === "keys" ? "keys" : "setup"),
    [keys, setKeys] = useState<KeyRow[]>([]),
    [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [wallets, setWallets] = useState<string[]>([]),
    [pay, setPay] = useState(false),
    [permissions, setPermissions] = useState<string[]>([]),
    [ttl, setTtl] = useState("24"),
    [secret, setSecret] = useState(""),
    [secretWallets, setSecretWallets] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [requestKey, setRequestKey] = useState("");
  const items = workspaces.filter((x) => x.orgId === w.orgId && (!cardOnly || x.id === w.id));
  const load = useCallback(async () => {
    const d = await workspaceJson(await gFetch("/v1/guardian/wallet-keys"));
    setKeys(cardOnly ? d.keys.filter((k: KeyRow) => k.workspaceIds.includes(w.id)) : d.keys);
  }, [gFetch, cardOnly, w.id]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  function navigate(value: string) {
    setTab(value);
    onTabChange(value);
    setError("");
    setNotice("");
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Copied to clipboard.");
    } catch {
      setError("Clipboard unavailable. Select the text and copy it manually.");
    }
  }
  async function create() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const d = await workspaceJson(
        await gFetch("/v1/guardian/wallet-keys", {
          method: "POST",
          body: JSON.stringify({
            name,
            workspaceIds: wallets,
            pay,
            permissions,
            ttlHours: Number(ttl),
            idempotencyKey: requestKey,
          }),
        }),
      );
      setSecret(d.sessionKey.token);
      setSecretWallets(d.workspaceIds);
      setOpen(false);
      await Promise.all([load(), onChanged()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function change(id: string, operation: "rotate" | "revoke") {
    setBusy(true);
    setError("");
    setSecret("");
    try {
      const d = await workspaceJson(
        await gFetch(`/v1/guardian/wallet-keys/${id}/${operation}`, { method: "POST", body: "{}" }),
      );
      if (d.sessionKey?.token) {
        setSecret(d.sessionKey.token);
        setSecretWallets(keys.find((k) => k.id === id)?.workspaceIds ?? []);
      }
      setNotice(
        operation === "rotate"
          ? "Previous secret invalidated. Save the replacement below."
          : "Key revoked for every wallet it could access.",
      );
      await Promise.all([load(), onChanged()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const base = typeof location === "undefined" ? "/abi-api" : `${location.origin}/abi-api`;
  const command = `curl --fail-with-body '${base}/v1/agent/context' \\\n+  -H "Authorization: Bearer $ABI_API_KEY" \\\n+  -H "x-abi-workspace: $ABI_WORKSPACE_ID"`;
  const prompt = `Connect to ABI using ${base}/mcp with Authorization: Bearer <owner-issued API key>. Store the key in your secret manager, never in a URL or chat. Use GET ${base}/v1/agent/wallets to discover the wallets granted to this key, then set x-abi-workspace to the chosen wallet ID. A multi-wallet key only accesses the wallets selected by its owner; do not infer access to other wallets. Verify with GET ${base}/v1/agent/context before using tools. Search the marketplace and inspect offers before requesting purchases. Payments require explicit permission, available funds, shared wallet limits and account approvals. Never raise limits or retry an uncertain payment without checking its result. Hosted MCP is testnet-only.`;
  return (
    <section className="minimal-page abi-connect-page">
      {!cardOnly && (
        <>
          <header className="minimal-page-heading">
            <h1>Connect</h1>
            <p>Your agent. Your wallets. Your controls.</p>
          </header>
          <div className="minimal-tabs" role="group" aria-label="Connection views">
            {["setup", "keys"].map((v) => (
              <button key={v} aria-pressed={tab === v} onClick={() => navigate(v)}>
                {v === "setup" ? "Setup" : "API keys"}
              </button>
            ))}
          </div>
        </>
      )}
      {error && !open && (
        <p role="alert" className="minimal-error">
          {error}
          <button onClick={() => void load().catch((e) => setError(e.message))}>Try again</button>
        </p>
      )}
      {notice && (
        <p role="status" className="abi-inline-notice">
          <Check size={16} />
          {notice}
        </p>
      )}
      {!cardOnly && tab === "setup" ? (
        <>
          <section className="abi-connect-quick">
            <button className="minimal-primary abi-setup-copy" onClick={() => void copy(prompt)}>
              <Copy size={18} />
              <span>Copy setup prompt</span>
              <AgentLogoCluster />
            </button>
            <p>
              Paste the prompt into your agent’s chat. Create a key to choose which wallets it can
              use.
            </p>
            <button className="abi-text-action" onClick={() => navigate("keys")}>
              Manage API keys <ArrowUpRight size={15} />
            </button>
          </section>
          <section className="minimal-section abi-manual-setup">
            <h2>Manual setup</h2>
            <div className="abi-setup-row">
              <Plug size={22} />
              <div>
                <h3>MCP</h3>
                <p>
                  Add ABI in your app’s MCP settings and provide your API key as a bearer token.
                </p>
                <div className="minimal-copy-row">
                  <code>{base}/mcp</code>
                  <button onClick={() => void copy(`${base}/mcp`)}>
                    <Copy size={15} />
                    Copy URL
                  </button>
                </div>
                <pre>Authorization: Bearer &lt;your API key&gt;</pre>
                <p className="minimal-note">
                  For a multi-wallet key, set the x-abi-workspace header to one of its wallet IDs.
                  Hosted MCP currently uses Base Sepolia.
                </p>
              </div>
            </div>
            <div className="abi-setup-row">
              <Terminal size={22} />
              <div>
                <h3>CLI</h3>
                <p>
                  Set ABI_API_KEY and ABI_WORKSPACE_ID privately in your terminal, then verify the
                  connection with this command.
                </p>
                <div className="abi-command">
                  <pre>{command}</pre>
                  <button aria-label="Copy CLI command" onClick={() => void copy(command)}>
                    <Copy size={16} />
                  </button>
                </div>
                <p className="minimal-note">
                  A successful response confirms the wallet, card and permissions.{" "}
                  <a href="/docs">
                    Connection guide <ArrowUpRight size={13} />
                  </a>
                </p>
              </div>
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="minimal-section-heading abi-key-heading">
            <div>
              <h2>{cardOnly ? "Access keys" : "API keys"}</h2>
              <p>
                {cardOnly
                  ? "Keys connected to this workspace card. Key values are shown only at creation."
                  : "Give each agent its own key and access to the wallets it needs."}
              </p>
            </div>
            <Button
              disabled={readOnly || busy}
              onClick={() => {
                setName("");
                setWallets([w.id]);
                setPay(false);
                setPermissions([]);
                setTtl("24");
                setError("");
                setRequestKey(crypto.randomUUID());
                setOpen(true);
              }}
            >
              <Plus size={16} />
              Create key
            </Button>
          </div>
          {secret && (
            <section className="abi-key-secret" aria-label="New API key">
              <ShieldCheck size={23} />
              <div>
                <h3>Save your key now</h3>
                <p>
                  This secret is shown once. It can access{" "}
                  {secretWallets.map((id) => items.find((x) => x.id === id)?.name ?? id).join(", ")}
                  .
                </p>
                <code>{secret}</code>
                <div className="minimal-actions">
                  <Button onClick={() => void copy(secret)}>
                    <Copy size={15} />
                    Copy key
                  </Button>
                  <Button variant="ghost" onClick={() => setSecret("")}>
                    I’ve saved it
                  </Button>
                </div>
              </div>
            </section>
          )}
          <div className="abi-key-list">
            {keys.length ? (
              keys.map((k) => {
                const inactive = !!k.revokedAt || Date.parse(k.expiresAt) <= Date.now();
                return (
                  <article key={k.id}>
                    <span className="abi-key-symbol">
                      <KeyRound size={20} />
                    </span>
                    <div>
                      <h3>{k.label ?? "Agent key"}</h3>
                      <p>
                        {k.workspaceIds
                          .map((id) => workspaces.find((x) => x.id === id)?.name ?? "Wallet")
                          .join(" · ") || "Legacy account key"}
                      </p>
                      <details className="abi-key-wallet-ids">
                        <summary>Wallet IDs & permissions</summary>
                        <p>
                          Permissions:{" "}
                          {k.scopes.map((scope) => permissionLabels[scope] ?? scope).join(", ")}
                        </p>
                        {k.workspaceIds.map((id) => (
                          <p key={id}>
                            {items.find((x) => x.id === id)?.name ?? "Wallet"}: <code>{id}</code>
                          </p>
                        ))}
                      </details>
                      <small>
                        {k.revokedAt
                          ? "Revoked"
                          : inactive
                            ? "Expired"
                            : `Expires ${new Date(k.expiresAt).toLocaleString()}`}{" "}
                        · {k.scopes.includes("pay") ? "Tools & payments" : "Read only"}
                      </small>
                    </div>
                    <div className="abi-key-actions">
                      <button
                        disabled={readOnly || busy || inactive}
                        onClick={() => void change(k.id, "rotate")}
                      >
                        Rotate
                      </button>
                      <button
                        disabled={readOnly || busy || !!k.revokedAt}
                        onClick={() => void change(k.id, "revoke")}
                      >
                        Revoke
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="abi-connect-empty">
                <KeyRound size={26} />
                <h3>A separate key for every agent</h3>
                <p>
                  Create your first key, choose its wallets, then connect through MCP or your
                  terminal.
                </p>
              </div>
            )}
          </div>
          <details className="abi-connection-status">
            <summary>
              <RefreshCw size={16} />
              Connection verification
            </summary>
            <p>Keys are verified when an agent makes a successful context or budget request.</p>
            {items.flatMap((x) =>
              x.connections.map((c) => (
                <p key={c.id}>
                  <strong>{c.name}</strong> · {x.name} ·{" "}
                  {c.verifiedAt
                    ? `Last verified ${new Date(c.verifiedAt).toLocaleString()}`
                    : "Not verified yet"}
                </p>
              )),
            )}
            <button onClick={() => void onChanged().catch((e) => setError(e.message))}>
              Refresh verification
            </button>
          </details>
        </>
      )}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <DialogContent className="reference-dialog abi-workspace-dialog abi-key-dialog">
          <DialogTitle>Create API key</DialogTitle>
          <DialogDescription>
            Choose the wallets this agent can access. Each wallet includes its dedicated card.
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label>
              Key name
              <input
                autoFocus
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Travel assistant"
              />
            </label>
            <div className="abi-form-field">
              <span>Wallet access</span>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="abi-field-trigger">
                    <Wallet size={18} />
                    <span>
                      {wallets.length
                        ? wallets.length === items.length && items.length > 1
                          ? "All current wallets"
                          : wallets.map((id) => items.find((x) => x.id === id)?.name).join(", ")
                        : "Choose wallets"}
                    </span>
                    <ChevronDown size={17} />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="abi-wallet-access-popover" align="start">
                  <p>Choose one or more wallets</p>
                  {items.map((x) => (
                    <label key={x.id}>
                      <input
                        type="checkbox"
                        checked={wallets.includes(x.id)}
                        onChange={(e) =>
                          setWallets(
                            e.target.checked
                              ? [...wallets, x.id]
                              : wallets.filter((id) => id !== x.id),
                          )
                        }
                      />
                      <Wallet size={18} />
                      <span>
                        <strong>{x.name}</strong>
                        <small>Dedicated card · {x.balance.availableUsdc} USDC</small>
                      </span>
                    </label>
                  ))}
                </PopoverContent>
              </Popover>
              <small>Access covers selected wallets only. Future wallets are not included.</small>
            </div>
            <h3>What this agent can do</h3>
            <div className="abi-permission-row">
              <span>
                Run tools<small>Read the catalog and verify connections.</small>
              </span>
              <input type="checkbox" checked disabled aria-label="Run tools" />
            </div>
            <label className="abi-permission-row">
              <span>
                Allow payments<small>Use each selected card’s funds and spending limits.</small>
              </span>
              <input type="checkbox" checked={pay} onChange={(e) => setPay(e.target.checked)} />
            </label>
            <details className="abi-owner-permissions">
              <summary>Card and key administration</summary>
              <p>Optional permissions. These never grant more funds or raise a spending limit.</p>
              {[
                [
                  "wallets:create",
                  "Create cards",
                  "Create a new, zero-funded wallet and its card. Owner approval is needed to grant access.",
                ],
                [
                  "cards:manage",
                  "Manage existing cards",
                  "Freeze or unfreeze cards in the selected wallets.",
                ],
                [
                  "keys:manage",
                  "Manage API keys",
                  "Rotate or revoke this key only, across its selected wallets.",
                ],
              ].map(([scope, label, help]) => (
                <label className="abi-permission-row" key={scope}>
                  <span>
                    {label}
                    <small>{help}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={permissions.includes(scope)}
                    onChange={(e) =>
                      setPermissions(
                        e.target.checked
                          ? [...permissions, scope]
                          : permissions.filter((p) => p !== scope),
                      )
                    }
                  />
                </label>
              ))}
            </details>
            <label>
              Expires in
              <Select value={ttl} onValueChange={setTtl}>
                <SelectTrigger aria-label="Expires in">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="abi-access-select">
                  <SelectItem value="24">24 hours</SelectItem>
                  <SelectItem value="168">7 days</SelectItem>
                  <SelectItem value="720">30 days</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {pay && wallets.some((id) => items.find((x) => x.id === id)?.card.inheritedLimits) && (
              <p role="status">
                Set an explicit spending limit for each selected wallet before enabling payments.
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            <Button type="submit" disabled={readOnly || busy || !name.trim() || !wallets.length}>
              {busy ? "Creating…" : "Create key"}
              <KeyRound size={16} />
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <SellerAccess workspace={w} gFetch={gFetch} onChanged={onChanged} readOnly={readOnly} />
    </section>
  );
}
function SellerAccess({
  workspace: w,
  gFetch,
  onChanged,
  readOnly,
}: {
  workspace: Workspace;
  gFetch: WorkspaceFetcher;
  onChanged: () => Promise<void>;
  readOnly: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function enable(linkExisting: boolean) {
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
  return (
    <details className="abi-connection-status">
      <summary>
        <Store size={16} />
        Seller access
      </summary>
      <p>
        Use your ABI login for selling. Inventory, verification and payouts remain separate from
        wallet funds.
      </p>
      {w.sellerEnabled ? (
        <a
          href="/seller/catalog"
          onClick={() => sessionStorage.setItem("abi_seller_workspace", w.id)}
        >
          Open seller inventory <ArrowUpRight size={14} />
        </a>
      ) : (
        <div className="minimal-actions">
          <button disabled={readOnly || busy} onClick={() => void enable(false)}>
            Enable seller tools
          </button>
          <button disabled={readOnly || busy} onClick={() => void enable(true)}>
            Link existing seller account
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
