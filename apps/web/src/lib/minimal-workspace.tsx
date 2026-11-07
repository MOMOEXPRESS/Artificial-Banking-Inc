"use client";
import { useCallback, useEffect, useState } from "react";
import type { AgentKey, OrgView, View } from "./console-types";
import { marketplaceJson } from "./marketplace-catalog";
import { Icon } from "./ui";
type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;
type Props = { org: OrgView | null | undefined; onNavigate: (view: View) => void };
const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
function usdc(value?: string) {
  return value ?? "0.00";
}
export function MinimalOverview({ org, onNavigate }: Props) {
  const agents = org?.agents ?? [];
  const available = org?.balances.find((b) => b.kind === "org_available")?.usdc;
  return (
    <section className="minimal-page minimal-overview">
      <header className="minimal-page-heading">
        <div>
          <h1>Your workspace</h1>
          <p>Everything your agents need, with you in control.</p>
        </div>
        <button className="minimal-primary" onClick={() => onNavigate("connect")}>
          <Icon name="key" size={16} />
          Connect an agent
        </button>
      </header>
      <section className="minimal-section">
        <h2>Get started</h2>
        <ol className="minimal-checklist">
          <li>
            <span className="minimal-check" aria-label={agents.length ? "Complete" : "Incomplete"}>
              {agents.length ? <Icon name="check" size={16} /> : null}
            </span>
            <span>Connect your agent</span>
            <button onClick={() => onNavigate("connect")}>Connect</button>
          </li>
          <li>
            <span className="minimal-check" />
            <span>Find a tool, software or product</span>
            <button className="minimal-primary" onClick={() => onNavigate("marketplace")}>
              Explore catalog
            </button>
          </li>
          <li>
            <span className="minimal-check" />
            <span>Set a budget before your first purchase</span>
            <button onClick={() => onNavigate("agents")}>Set limits</button>
          </li>
        </ol>
      </section>
      <section className="minimal-workspace-summary">
        <div>
          <h2>{org?.org.name ?? "General"}</h2>
          <p>Your agent workspace</p>
        </div>
        <button className="minimal-balance" onClick={() => onNavigate("treasury")}>
          <strong>{usdc(available)} USDC</strong>
          <span>
            View settlement funds <Icon name="arrowRight" size={16} />
          </span>
        </button>
      </section>
      <section className="minimal-section">
        <div className="minimal-section-heading">
          <h2>Agents & allowances</h2>
          <button onClick={() => onNavigate("agents")}>Manage agents</button>
        </div>
        {agents.length ? (
          <div className="minimal-allowances">
            {agents.map((a) => (
              <article className="minimal-allowance" key={a.id}>
                <Icon name="key" size={24} />
                <div>
                  <h3>{a.name}</h3>
                  <p>{a.budget?.name ?? "No budget assigned"}</p>
                </div>
                <strong>{usdc(a.availableUsdc)} USDC available</strong>
                <span>{a.status}</span>
              </article>
            ))}
          </div>
        ) : (
          <div className="minimal-empty">
            <h3>Your first agent starts here</h3>
            <p>Create an agent, assign its spending rules, then issue a scoped API key.</p>
            <button onClick={() => onNavigate("agents")}>Create an agent</button>
          </div>
        )}
        <p className="minimal-note">
          Allowances are spending permissions. They are separate from payment cards.
        </p>
      </section>
      <section className="minimal-section">
        <div className="minimal-section-heading">
          <h2>Purchases & activity</h2>
          <button onClick={() => onNavigate("marketplace")}>Open marketplace</button>
        </div>
        <div className="minimal-link-rows">
          <button onClick={() => onNavigate("payments")}>
            <Icon name="list" size={20} />
            <span>Payments, approvals and receipts</span>
            <Icon name="arrowRight" size={18} />
          </button>
          <button onClick={() => onNavigate("insights")}>
            <Icon name="book" size={20} />
            <span>Workspace activity</span>
            <Icon name="arrowRight" size={18} />
          </button>
        </div>
      </section>
    </section>
  );
}
type KeyRow = {
  id: string;
  agentId: string;
  label?: string;
  scopes: string[];
  expiresAt: string;
  revokedAt?: string;
  x402BudgetUsdc?: string;
  x402SpentUsdc?: string;
};
export function MinimalConnect({
  org,
  gFetch,
  readOnly,
  onNavigate,
  onKeyRevealed,
}: Props & { gFetch: Fetcher; readOnly: boolean; onKeyRevealed?: (entry: AgentKey) => void }) {
  const [keys, setKeys] = useState<KeyRow[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [secret, setSecret] = useState(""),
    [tab, setTab] = useState("setup"),
    [agent, setAgent] = useState(""),
    [label, setLabel] = useState("Shopping agent"),
    [pay, setPay] = useState(false),
    [budget, setBudget] = useState("5"),
    [ttl, setTtl] = useState("24");
  const load = useCallback(async () => {
    try {
      const data = await marketplaceJson(await gFetch("/v1/guardian/session-keys"));
      setKeys(data.sessionKeys);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load keys. Refresh to retry.");
    }
  }, [gFetch]);
  useEffect(() => {
    void load();
  }, [load]);
  const agents = (org?.agents ?? []).filter((a) => a.status === "active");
  async function action(path: string, body: unknown = {}) {
    setBusy(true);
    setError("");
    setNotice("");
    setSecret("");
    try {
      const data = await marketplaceJson(
        await gFetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      if (data.sessionKey?.token) {
        setSecret(data.sessionKey.token);
        const metadata = data.sessionKey.agentId
          ? data.sessionKey
          : keys.find((k) => k.id === data.sessionKey.id);
        if (metadata?.scopes?.includes("pay"))
          onKeyRevealed?.({
            agentId: metadata.agentId,
            name: org?.agents.find((a) => a.id === metadata.agentId)?.name ?? "Shopping agent",
            key: data.sessionKey.token,
          });
      } else setNotice("Key revoked. It can no longer authorize requests.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied to clipboard.");
    } catch {
      setError("Clipboard access failed. Select the text and copy it manually.");
    }
  }
  const endpoint =
    typeof window !== "undefined" ? window.location.origin + "/abi-api/mcp" : "/abi-api/mcp";
  return (
    <section className="minimal-page">
      <header className="minimal-page-heading">
        <div>
          <h1>Connect</h1>
          <p>Give your agent access. Keep its permissions precise.</p>
        </div>
        <button onClick={() => onNavigate("agents")}>Agents & allowances</button>
      </header>
      <div className="minimal-tabs" role="group" aria-label="Connection views">
        {[
          ["setup", "Setup"],
          ["keys", "API keys"],
        ].map(([v, l]) => (
          <button key={v} aria-pressed={tab === v} onClick={() => setTab(v)}>
            {l}
          </button>
        ))}
      </div>
      {error && (
        <p className="minimal-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {secret && (
        <section className="minimal-secret" aria-label="New API key">
          <h2>Save your key now</h2>
          <p>
            This secret is shown once. Store it privately; anyone holding it can use its
            permissions.
          </p>
          <code>{secret}</code>
          <div className="minimal-actions">
            <button onClick={() => void copy(secret)}>Copy key</button>
            <button onClick={() => setSecret("")}>I’ve saved it</button>
          </div>
        </section>
      )}
      {tab === "setup" ? (
        <>
          <section className="minimal-section">
            <h2>Set up your shopping agent</h2>
            <p>
              Create an agent and allowance, issue a key below, then add ABI to its tools. ABI
              checks the key’s scope, spending rules and approvals before payment.
            </p>
            <button className="minimal-primary" onClick={() => setTab("keys")}>
              Create an API key
            </button>
            <button
              onClick={() =>
                void copy(
                  `Connect this agent to ABI at ${endpoint}. Use an owner-issued scoped session key in the Authorization: Bearer header, stored in your secret manager. Start with read access. Search the catalog and inspect stock and attributes before preparing a quote. Request payment only with explicit pay permission and an owner-approved allowance. Never raise a spending limit yourself; reconcile uncertain orders before retrying.`,
                )
              }
            >
              Copy setup instructions
            </button>
          </section>
          <section className="minimal-section">
            <h2>Manual setup</h2>
            <h3>MCP</h3>
            <p>
              Add the server URL to your agent’s MCP settings. Send the key in the Authorization
              header.
            </p>
            <div className="minimal-copy-row">
              <code>{endpoint}</code>
              <button onClick={() => void copy(endpoint)}>Copy URL</button>
            </div>
            <pre>Authorization: Bearer &lt;your-session-key&gt;</pre>
            <p className="minimal-note">
              Developer bearer access depends on the deployment’s MCP configuration. This MCP
              endpoint is currently testnet-only. Use the API for supported deployment workflows.
            </p>
            <a href="/docs">Read the connection guide</a>
            <h3>Shopping workflow</h3>
            <p>
              Search the catalog, inspect product details and current stock, prepare a quote, then
              request a purchase within the owner’s limits. Confirm the existing order before
              retrying an uncertain payment.
            </p>
            <button onClick={() => onNavigate("chat")}>Open Assistant</button>
          </section>
        </>
      ) : (
        <>
          <form
            className="minimal-section minimal-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action(
                `/v1/guardian/agents/${encodeURIComponent(agent || agents[0]?.id || "")}/session-keys`,
                {
                  label,
                  scopes: pay ? ["read", "pay"] : ["read"],
                  ttlHours: Number(ttl),
                  ...(pay ? { x402BudgetUsdc: budget } : {}),
                },
              );
            }}
          >
            <h2>Create a scoped key</h2>
            <p>
              Read-only by default. Payment access uses the agent’s existing policy and allowance.
            </p>
            <div className="minimal-form-grid">
              <label>
                Agent
                <select
                  required
                  value={agent || agents[0]?.id || ""}
                  onChange={(e) => setAgent(e.target.value)}
                >
                  <option value="" disabled>
                    Select an active agent
                  </option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Key name
                <input
                  required
                  maxLength={80}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
              <label>
                Expires in
                <select value={ttl} onChange={(e) => setTtl(e.target.value)}>
                  <option value="1">1 hour</option>
                  <option value="24">24 hours</option>
                  <option value="168">7 days</option>
                  <option value="720">30 days</option>
                </select>
              </label>
              <label className="minimal-checkbox">
                <input type="checkbox" checked={pay} onChange={(e) => setPay(e.target.checked)} />
                Allow payments
              </label>
              {pay && (
                <label>
                  Lifetime x402 limit (USDC)
                  <input
                    required
                    inputMode="decimal"
                    pattern="[0-9]+([.][0-9]{1,6})?"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                  />
                </label>
              )}
            </div>
            {!agents.length && <p>Create an active agent before issuing a key.</p>}
            <button className="minimal-primary" disabled={busy || readOnly || !agents.length}>
              Create key
            </button>
          </form>
          <section className="minimal-section">
            <div className="minimal-section-heading">
              <h2>API keys</h2>
              <button disabled={busy} onClick={() => void load()}>
                Refresh
              </button>
            </div>
            {keys.length ? (
              keys.map((k) => {
                const active = !k.revokedAt && Date.parse(k.expiresAt) > Date.now();
                return (
                  <article className="minimal-key-row" key={k.id}>
                    <div>
                      <h3>{k.label || "Session key"}</h3>
                      <p>
                        {k.scopes.join(", ")} ·{" "}
                        {k.revokedAt
                          ? "Revoked"
                          : active
                            ? `Expires ${new Date(k.expiresAt).toLocaleString()}`
                            : "Expired"}
                      </p>
                      {k.x402BudgetUsdc && (
                        <p>
                          {k.x402SpentUsdc ?? "0"} / {k.x402BudgetUsdc} USDC used
                        </p>
                      )}
                    </div>
                    <div className="minimal-actions">
                      <button
                        disabled={!active || busy || readOnly}
                        onClick={() =>
                          void action(
                            `/v1/guardian/session-keys/${encodeURIComponent(k.id)}/replace`,
                          )
                        }
                      >
                        Replace
                      </button>
                      <button
                        disabled={!active || busy || readOnly}
                        onClick={() =>
                          void action(
                            `/v1/guardian/session-keys/${encodeURIComponent(k.id)}/revoke`,
                          )
                        }
                      >
                        Revoke
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <p>No keys yet. Create a scoped key to connect your first agent.</p>
            )}
            <p className="minimal-note">
              Replacing a key invalidates its old secret immediately and preserves its permissions,
              expiry and spending history.
            </p>
          </section>
        </>
      )}
    </section>
  );
}
type Billing = {
  creditCents: number;
  debtCents: number;
  cardFundingAvailable: boolean;
  method: { label: string } | null;
  autoTopup: {
    enabled: boolean;
    thresholdCents: number;
    amountCents: number;
    monthlyCapCents: number;
  };
  activity: { id: string; kind: string; amountCents: number; status: string; createdAt: string }[];
};
export function MinimalBilling({
  org,
  gFetch,
  readOnly,
  onNavigate,
}: Props & { gFetch: Fetcher; readOnly: boolean }) {
  const [data, setData] = useState<Billing | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [amount, setAmount] = useState("20"),
    [settings, setSettings] = useState<Billing["autoTopup"] | null>(null),
    [attempt, setAttempt] = useState<{ kind: string; amount: number; key: string } | null>(null);
  const load = useCallback(async () => {
    setError("");
    try {
      const v = await marketplaceJson(await gFetch("/v1/guardian/billing"));
      setData(v);
      setSettings(v.autoTopup);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Billing could not load. Refresh to retry.");
    }
  }, [gFetch]);
  useEffect(() => {
    void load();
  }, [load]);
  async function checkout(setup: boolean) {
    const cents = Math.round(Number(amount) * 100);
    if (!setup && (!/^\d+(\.\d{1,2})?$/.test(amount) || cents < 500 || cents > 100000)) {
      setError("Enter an amount between $5 and $1,000, with at most two decimal places.");
      return;
    }
    const kind = setup ? "payment-method" : "checkout",
      key = attempt?.kind === kind && attempt.amount === cents ? attempt.key : crypto.randomUUID();
    setAttempt({ kind, amount: cents, key });
    setBusy(true);
    setError("");
    try {
      const v = await marketplaceJson(
        await gFetch(`/v1/guardian/billing/${kind}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requestKey: key, ...(!setup ? { amountCents: cents } : {}) }),
        }),
      );
      const url = new URL(v.url);
      if (
        url.protocol !== "https:" ||
        !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)
      )
        throw Error("Invalid checkout address. Refresh activity before trying again.");
      window.location.assign(url.href);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Checkout could not open. Refresh activity before retrying.",
      );
      setBusy(false);
    }
  }
  async function save() {
    if (!settings) return;
    setBusy(true);
    setError("");
    try {
      await marketplaceJson(
        await gFetch("/v1/guardian/billing/auto-topup", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(settings),
        }),
      );
      setNotice("Auto top-up preferences saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="minimal-page">
      <header className="minimal-page-heading">
        <div>
          <h1>Billing</h1>
          <p>Clear balances. Explicit spending limits.</p>
        </div>
        <button disabled={busy} onClick={() => void load()}>
          Refresh activity
        </button>
      </header>
      {error && (
        <p role="alert" className="minimal-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data && !error && <p role="status">Loading billing…</p>}
      {data && (
        <>
          {!data.cardFundingAvailable && (
            <p className="minimal-notice">
              Card funding is not configured for this deployment. Your existing USDC wallet and
              settlement controls remain available.
            </p>
          )}
          <section className="minimal-balances">
            <div>
              <p>Card-funded credits · USD</p>
              <strong>{usd(data.creditCents)}</strong>
              {data.debtCents > 0 && <p>Amount to resolve: {usd(data.debtCents)}</p>}
              <p className="minimal-note">
                Separate credit account. These credits do not fund USDC purchases.
              </p>
            </div>
            <div>
              <p>Settlement funds · USDC</p>
              <strong>{usdc(org?.balances.find((b) => b.kind === "org_available")?.usdc)}</strong>
              <button onClick={() => onNavigate("treasury")}>Manage USDC wallet</button>
            </div>
          </section>
          <section className="minimal-section">
            <h2>Add credits</h2>
            <p>
              Credits appear only after a verified payment. Card details are entered on the payment
              provider’s hosted page.
            </p>
            <div className="minimal-actions">
              <label>
                Amount (USD)
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={busy || !data.cardFundingAvailable || readOnly}
                />
              </label>
              <button
                className="minimal-primary"
                disabled={busy || readOnly || !data.cardFundingAvailable}
                onClick={() => void checkout(false)}
              >
                Add credits
              </button>
            </div>
          </section>
          <section className="minimal-section">
            <div className="minimal-section-heading">
              <h2>Auto top-up</h2>
              <label className="minimal-checkbox">
                <input
                  type="checkbox"
                  checked={settings?.enabled ?? false}
                  disabled={
                    busy ||
                    readOnly ||
                    (!settings?.enabled && (!data.cardFundingAvailable || !data.method))
                  }
                  onChange={(e) =>
                    settings && setSettings({ ...settings, enabled: e.target.checked })
                  }
                />
                Enabled
              </label>
            </div>
            <p>
              Charge your saved card when credits fall below your threshold. Pending payments count
              toward the monthly cap.
            </p>
            {settings && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <div className="minimal-form-grid">
                  {[
                    ["thresholdCents", "When below (USD)", 1],
                    ["amountCents", "Add (USD)", 5],
                    ["monthlyCapCents", "Monthly cap (USD)", 5],
                  ].map(([k, l, min]) => (
                    <label key={String(k)}>
                      {l}
                      <input
                        type="number"
                        min={Number(min)}
                        max={k === "monthlyCapCents" ? 10000 : 1000}
                        step="0.01"
                        value={(settings[k as keyof typeof settings] as number) / 100}
                        disabled={busy || readOnly || !data.cardFundingAvailable}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            [k]: Math.round(Number(e.target.value) * 100),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <button
                  disabled={
                    busy || readOnly || (!data.cardFundingAvailable && !data.autoTopup.enabled)
                  }
                >
                  Save auto top-up
                </button>
              </form>
            )}
            <p className="minimal-note">
              Add a verified card before enabling. Additional authentication or a failed payment
              pauses auto top-up.
            </p>
          </section>
          <section className="minimal-section">
            <div className="minimal-section-heading">
              <h2>Payment method</h2>
              <button
                disabled={busy || readOnly || !data.cardFundingAvailable}
                onClick={() => void checkout(true)}
              >
                {data.method ? "Replace card" : "Add card"}
              </button>
            </div>
            <div className="minimal-empty">{data.method?.label ?? "No saved card."}</div>
          </section>
          <section className="minimal-section">
            <h2>Funding activity</h2>
            {data.activity.length ? (
              <div className="minimal-activity">
                {data.activity.map((a) => (
                  <div key={a.id}>
                    <span>
                      {a.kind === "auto"
                        ? "Auto top-up"
                        : a.kind === "setup"
                          ? "Card verification"
                          : "Card funding"}
                      <small>{new Date(a.createdAt).toLocaleString()}</small>
                    </span>
                    <span>{a.kind === "setup" ? "—" : usd(a.amountCents)}</span>
                    <span>{a.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p>No funding activity yet.</p>
            )}
            <p className="minimal-note">
              An uncertain payment stays pending until confirmed. Refresh activity before starting
              another payment.
            </p>
          </section>
        </>
      )}
    </section>
  );
}
