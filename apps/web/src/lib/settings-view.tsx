"use client";

import { useState } from "react";
import { Icon } from "./ui";

export type Setup = {
  custody: string;
  network: string;
  settlement: string;
  telegram: boolean;
  rateLimitPerMin: number;
  approvalTtlMinutes: number;
  cdpApiKeyConfigured?: boolean;
  cdpWired?: boolean;
  note?: string;
};

export type Recon = {
  ok: boolean;
  accountsChecked: number;
  journalsReplayed: number;
  drift: unknown[];
};

type Guardian = { id: string; name: string; role: string; createdAt: string; revokedAt?: string };
type Subscription = {
  id: string;
  vendor: string;
  amountUsdc: string;
  intervalHours: number;
  status: string;
  runs: number;
  spentUsdc: string;
  nextRunAt: string;
  lastError?: string;
};

const SECTIONS = [
  { key: "golive", label: "Go live", icon: "shield" },
  { key: "org", label: "Org & compliance", icon: "shield" },
  { key: "merchants", label: "Merchants", icon: "wallet" },
  { key: "team", label: "Team & quorum", icon: "check" },
  { key: "recurring", label: "Recurring spend", icon: "clock" },
  { key: "console", label: "Console", icon: "sliders" },
  { key: "connect", label: "Connect an agent", icon: "robot" },
  { key: "danger", label: "Danger zone", icon: "alert" },
] as const;

type Section = (typeof SECTIONS)[number]["key"];

export function SettingsView({
  setup,
  recon,
  prefs,
  savePrefs,
  session,
  org,
  metrics,
  agents,
  busy,
  act,
  gFetch,
  api,
  sellerUrl,
  actorRole = "owner",
  onGoto,
}: {
  setup: Setup | null;
  recon: Recon | null;
  prefs: { autoJump: boolean; sound: boolean };
  savePrefs: (p: { autoJump: boolean; sound: boolean }) => void;
  session: { guardianKey: string; agentKeys: { agentId: string; name: string; key: string }[] };
  org: { org: { name: string; status: string }; vaultAddress: string } | null;
  metrics: { agents: number } | null;
  agents: { id: string; name: string }[];
  busy: boolean;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
  api: string;
  sellerUrl: string;
  actorRole?: "owner" | "approver" | "viewer";
  onGoto?: (view: string) => void;
}) {
  const readOnly = actorRole === "viewer";
  const [section, setSection] = useState<Section>("golive");
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [quorum, setQuorum] = useState(1);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [newGuardian, setNewGuardian] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [subForm, setSubForm] = useState({ agentId: "", vendor: "", amountUsdc: "", intervalHours: "24" });
  const [inviteRole, setInviteRole] = useState<"approver" | "viewer">("approver");
  const [orgSettings, setOrgSettings] = useState<Record<string, unknown>>({});
  const [planDraft, setPlanDraft] = useState("");
  const [compliance, setCompliance] = useState<{ screener?: string; denylistConfigured?: boolean; denylistCount?: number } | null>(null);
  const [obs, setObs] = useState<{ sink?: string } | null>(null);
  const [merchants, setMerchants] = useState<{ id: string; key: string; label?: string; category?: string }[]>([]);
  const [merchantForm, setMerchantForm] = useState({ key: "", label: "", category: "" });

  const loadTeam = async () => {
    try {
      const [g, s] = await Promise.all([
        gFetch("/v1/guardian/guardians").then((r) => r.json()),
        gFetch("/v1/guardian/subscriptions").then((r) => r.json()),
      ]);
      setGuardians(g.guardians ?? []);
      setQuorum(g.quorum ?? 1);
      setSubs(s.subscriptions ?? []);
    } catch {
      /* non-fatal */
    }
  };

  // Load the lazily-fetched sections on first visit.
  const loadPlatform = async () => {
    try {
      const [settings, comp, ob, merch] = await Promise.all([
        gFetch("/v1/guardian/settings").then((r) => r.json()),
        gFetch("/v1/guardian/compliance").then((r) => r.json()),
        gFetch("/v1/guardian/observability").then((r) => r.json()),
        gFetch("/v1/guardian/merchants").then((r) => r.json()),
      ]);
      setOrgSettings(settings.settings ?? {});
      setPlanDraft(String((settings.settings ?? {}).plan ?? ""));
      setCompliance(comp);
      setObs(ob);
      setMerchants(merch.merchants ?? []);
    } catch {
      /* non-fatal */
    }
  };

  const go = (s: Section) => {
    setSection(s);
    if (s === "team" || s === "recurring") void loadTeam();
    if (s === "org" || s === "merchants" || s === "golive") void loadPlatform();
  };

  const orgFrozen = org?.org.status === "frozen";

  const toggleFreeze = () =>
    act("Org freeze", async () => {
      const on = !orgFrozen;
      const res = await gFetch(`/v1/guardian/${on ? "freeze" : "unfreeze"}`, {
        method: "POST",
        body: JSON.stringify(on ? { reason: "org-wide kill switch" } : {}),
      });
      if (!res.ok) throw new Error(JSON.stringify((await res.json()).error ?? res.status));
      return on
        ? "ORG FROZEN — every agent is stopped until you unfreeze."
        : "Org unfrozen — agents may spend again under policy.";
    });

  const addGuardian = () =>
    act("Invite", async () => {
      const res = await gFetch("/v1/guardian/guardians", {
        method: "POST",
        body: JSON.stringify({ name: newGuardian.trim(), role: inviteRole }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "failed");
      setRevealedKey(d.guardianKey);
      setNewGuardian("");
      await loadTeam();
      return "Guardian invited — their key is shown once below.";
    });

  const setQuorumTo = (n: number) =>
    act("Quorum", async () => {
      const res = await gFetch("/v1/guardian/quorum", {
        method: "POST",
        body: JSON.stringify({ approvalQuorum: n }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "failed");
      setQuorum(n);
      return n === 1
        ? "Any single guardian can now release a payment."
        : `Payments now need ${n} different guardians to approve.`;
    });

  const revoke = (id: string) =>
    act("Revoke", async () => {
      const res = await gFetch(`/v1/guardian/guardians/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(JSON.stringify(await res.json()));
      await loadTeam();
      return "Guardian revoked — their key no longer works.";
    });

  const createSub = () =>
    act("Subscription", async () => {
      const res = await gFetch("/v1/guardian/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          agentId: subForm.agentId,
          vendor: subForm.vendor.trim(),
          amountUsdc: subForm.amountUsdc.trim(),
          intervalHours: Number(subForm.intervalHours) || 24,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "failed");
      setSubForm({ agentId: "", vendor: "", amountUsdc: "", intervalHours: "24" });
      await loadTeam();
      return "Recurring charge created — every run still passes the policy engine.";
    });

  const subAction = (id: string, action: "pause" | "resume" | "cancel") =>
    act("Subscription", async () => {
      const res = await gFetch(`/v1/guardian/subscriptions/${id}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error(JSON.stringify(await res.json()));
      await loadTeam();
      return `Subscription ${action}d.`;
    });

  const golive = [
    {
      done: !!setup?.cdpWired,
      title: "Real custody (Coinbase CDP)",
      body:
        setup?.cdpWired
          ? "CDP custody active — payments sign with a managed wallet."
          : setup?.cdpApiKeyConfigured
            ? "CDP_API_KEY_ID is set but DevLocalProvider is still wired — call setCustodyProvider(CdpProvider) to go live."
            : `Currently signing with ${setup?.custody ?? "dev-local"}. Set CDP credentials and wire CdpProvider to switch.`,
    },
    {
      done: !!setup?.cdpWired,
      title: "On-chain settlement on Base Sepolia",
      body:
        setup?.cdpWired
          ? "Settling on Base Sepolia via CDP."
          : "The x402 handshake, signature and price checks are all real — only the final chain write is mocked by the dev facilitator. Fund the vault address with testnet USDC and point the seller at the hosted facilitator to go live.",
    },
    {
      done: !!setup?.telegram,
      title: "Telegram approvals on your phone",
      body: setup?.telegram
        ? "Connected — approvals arrive as Approve/Deny buttons in your chat."
        : "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID on the API, then restart it. Approvals will DM you with buttons that resolve through the same engine as this console.",
    },
    {
      done: (recon?.journalsReplayed ?? 0) > 0 && !!recon?.ok,
      title: "Ledger reconciliation clean",
      body: recon?.ok
        ? `${recon.journalsReplayed} journal entries replayed, ${recon.accountsChecked} accounts, zero drift.`
        : "Reconciliation reports drift — investigate before trusting balances.",
    },
  ];

  return (
    <div className="set-grid">
      <nav className="set-nav">
        {SECTIONS.map((s) => (
          <button key={s.key} className={section === s.key ? "on" : ""} onClick={() => go(s.key)}>
            <Icon name={s.icon} />
            {s.label}
          </button>
        ))}
      </nav>

      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {section === "golive" && (
          <>
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Go-live checklist</h2>
                  <div className="sub">What separates this from real money on Base</div>
                </div>
                <span className={`pill ${golive.every((g) => g.done) ? "ok" : "warn"}`}>
                  <i /> {golive.filter((g) => g.done).length}/{golive.length} ready
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {golive.map((g) => (
                  <div key={g.title} className="row" style={{ alignItems: "flex-start", gap: 11, flexWrap: "nowrap" }}>
                    <span
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 9,
                        display: "grid",
                        placeItems: "center",
                        flexShrink: 0,
                        background: g.done ? "var(--green-soft)" : "var(--surface-3)",
                        color: g.done ? "var(--green)" : "var(--faint)",
                      }}
                    >
                      <Icon name={g.done ? "check" : "clock"} size={14} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <b style={{ fontSize: 13, display: "block" }}>{g.title}</b>
                      <span className="muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
                        {g.body}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Environment</h2>
              </div>
              {[
                ["Network", setup?.network ?? "—"],
                ["Custody", setup?.custody ?? "—"],
                ["Settlement", setup?.settlement ?? "—"],
                ["Telegram", setup?.telegram ? "connected" : "not configured"],
                ["Rate limit", `${setup?.rateLimitPerMin ?? "—"}/min per key`],
                ["Approval expiry", `${setup?.approvalTtlMinutes ?? "—"} minutes`],
                ["API", api],
              ].map(([k, v]) => (
                <div className="kv" key={k}>
                  <span className="k">{k}</span>
                  <span className="v">{v}</span>
                </div>
              ))}
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Organisation</h2>
              </div>
              <div className="field">
                <label>Vault address</label>
                <div className="code">{org?.vaultAddress}</div>
                <div className="hint">Fund this with Base Sepolia USDC when you switch settlement on.</div>
              </div>
              <div className="kv">
                <span className="k">Agents</span>
                <span className="v">{metrics?.agents ?? 0}</span>
              </div>
              <div className="kv">
                <span className="k">Keys held in this browser</span>
                <span className="v">{session.agentKeys.length}</span>
              </div>
              <div className="kv">
                <span className="k">Ledger</span>
                <span className="v" style={{ color: recon?.ok ? "var(--green)" : "var(--red)" }}>
                  {recon?.ok ? "clean" : "DRIFT"}
                </span>
              </div>
            </div>
          </>
        )}

        {section === "org" && (
          <>
            {readOnly && (
              <div className="banner">
                <span className="txt">
                  <b>Viewer mode</b>
                  <span>You can inspect settings but cannot change them.</span>
                </span>
              </div>
            )}
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Organization settings</h2>
                  <div className="sub">Feature flags and plan metadata stored in OrgSettings JSON</div>
                </div>
              </div>
              <div className="field">
                <label>Plan</label>
                <input
                  value={planDraft}
                  disabled={readOnly}
                  onChange={(e) => setPlanDraft(e.target.value)}
                  placeholder="demo / growth / enterprise"
                />
              </div>
              <button
                className="sm"
                disabled={busy || readOnly}
                onClick={() =>
                  void act("Save settings", async () => {
                    const res = await gFetch("/v1/guardian/settings", {
                      method: "PATCH",
                      body: JSON.stringify({ settings: { plan: planDraft.trim() || undefined } }),
                    });
                    const d = await res.json();
                    if (!res.ok) throw new Error(d.error?.message ?? "failed");
                    setOrgSettings(d.settings ?? {});
                    return "Org settings saved.";
                  })
                }
              >
                Save settings
              </button>
              <pre className="code" style={{ marginTop: 12, fontSize: 11 }}>
                {JSON.stringify(orgSettings, null, 2)}
              </pre>
            </div>
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Compliance & observability</h2>
                  <div className="sub">Live screener + sink status</div>
                </div>
              </div>
              <div className="kv">
                <span className="k">Screener</span>
                <span className="v mono">{compliance?.screener ?? "—"}</span>
              </div>
              <div className="kv">
                <span className="k">Denylist</span>
                <span className="v">
                  {compliance?.denylistConfigured
                    ? `${compliance.denylistCount} entries (ABI_COMPLIANCE_DENYLIST)`
                    : "not configured"}
                </span>
              </div>
              <div className="kv">
                <span className="k">Observability sink</span>
                <span className="v mono">{obs?.sink ?? "—"}</span>
              </div>
              <div className="kv">
                <span className="k">Custody provider</span>
                <span className="v mono">{setup?.custody ?? "—"}</span>
              </div>
              {setup?.note && (
                <p className="muted" style={{ fontSize: 12.5 }}>{setup.note}</p>
              )}
            </div>
          </>
        )}

        {section === "merchants" && (
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Merchant directory</h2>
                <div className="sub">Metadata layered on allowlisted counterparties</div>
              </div>
            </div>
            <div className="grid g-2" style={{ gap: "0 14px" }}>
              <div className="field">
                <label>Key</label>
                <input
                  value={merchantForm.key}
                  disabled={readOnly}
                  onChange={(e) => setMerchantForm({ ...merchantForm, key: e.target.value })}
                  placeholder="api.openai.com"
                />
              </div>
              <div className="field">
                <label>Label</label>
                <input
                  value={merchantForm.label}
                  disabled={readOnly}
                  onChange={(e) => setMerchantForm({ ...merchantForm, label: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Category</label>
                <input
                  value={merchantForm.category}
                  disabled={readOnly}
                  onChange={(e) => setMerchantForm({ ...merchantForm, category: e.target.value })}
                  placeholder="llm / data / tools"
                />
              </div>
            </div>
            <button
              className="sm"
              disabled={busy || readOnly || !merchantForm.key.trim()}
              onClick={() =>
                void act("Upsert merchant", async () => {
                  const res = await gFetch("/v1/guardian/merchants", {
                    method: "POST",
                    body: JSON.stringify({
                      key: merchantForm.key.trim(),
                      label: merchantForm.label.trim() || undefined,
                      category: merchantForm.category.trim() || undefined,
                    }),
                  });
                  const d = await res.json();
                  if (!res.ok) throw new Error(d.error?.message ?? "failed");
                  setMerchantForm({ key: "", label: "", category: "" });
                  await loadPlatform();
                  return "Merchant saved.";
                })
              }
            >
              Save merchant
            </button>
            <table style={{ marginTop: 14 }}>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Label</th>
                  <th>Category</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {merchants.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{m.key}</td>
                    <td>{m.label ?? "—"}</td>
                    <td className="faint">{m.category ?? "—"}</td>
                    <td>
                      <button
                        className="ghost sm"
                        disabled={busy || readOnly}
                        onClick={() =>
                          void act("Delete merchant", async () => {
                            const res = await gFetch(`/v1/guardian/merchants/${m.id}`, {
                              method: "DELETE",
                            });
                            if (!res.ok) throw new Error(JSON.stringify(await res.json()));
                            await loadPlatform();
                          })
                        }
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!merchants.length && (
              <p className="muted" style={{ fontSize: 12.5 }}>No merchants yet — add one or allocate spend to seed known counterparties.</p>
            )}
          </div>
        )}

        {section === "team" && (
          <>
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Approval quorum</h2>
                  <div className="sub">
                    How many different guardians must approve before a parked payment executes.
                    A denial from any one of them stops it immediately.
                  </div>
                </div>
              </div>
              <div className="row">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    className={quorum === n ? "" : "ghost"}
                    disabled={busy}
                    onClick={() => void setQuorumTo(n)}
                  >
                    {n === 1 ? "Any one guardian" : `${n} guardians`}
                  </button>
                ))}
                <span className="faint" style={{ fontSize: 11.5 }}>
                  {guardians.filter((g) => !g.revokedAt).length + 1} seats available
                </span>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Guardians</h2>
                  <div className="sub">Anyone with a guardian key can approve spending for this org.</div>
                </div>
                <div className="row">
                  <input
                    style={{ width: 170 }}
                    placeholder="Name"
                    value={newGuardian}
                    onChange={(e) => setNewGuardian(e.target.value)}
                  />
                  <select
                    style={{ width: 120 }}
                    value={inviteRole}
                    disabled={readOnly}
                    onChange={(e) => setInviteRole(e.target.value as "approver" | "viewer")}
                  >
                    <option value="approver">approver</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <button className="sm" disabled={busy || readOnly || !newGuardian.trim()} onClick={() => void addGuardian()}>
                    <Icon name="plus" size={12} /> Invite
                  </button>
                </div>
              </div>
              {revealedKey && (
                <div className="code" style={{ marginBottom: 12 }}>
                  Guardian key (shown once):
                  <div style={{ marginTop: 6, color: "var(--accent)" }}>{revealedKey}</div>
                  <button className="ghost sm" style={{ marginTop: 8 }} onClick={() => setRevealedKey(null)}>
                    I saved it
                  </button>
                </div>
              )}
              <div className="kv">
                <span className="k">You (founding key)</span>
                <span className="v">owner</span>
              </div>
              {guardians.map((g) => (
                <div className="kv" key={g.id}>
                  <span className="k">
                    {g.name} {g.revokedAt && <span className="pill bad">revoked</span>}
                  </span>
                  <span className="v" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {g.role}
                    {!g.revokedAt && (
                      <button className="bare sm" disabled={busy} onClick={() => void revoke(g.id)}>
                        revoke
                      </button>
                    )}
                  </span>
                </div>
              ))}
              {!guardians.length && (
                <p className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
                  No additional guardians. Quorum above 1 requires at least that many people.
                </p>
              )}
            </div>
          </>
        )}

        {section === "recurring" && (
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Recurring spend moved</h2>
                <div className="sub">
                  Subscriptions and one-shot schedules live under Payments so money surfaces stay together.
                </div>
              </div>
            </div>
            <button className="sm" onClick={() => onGoto?.("payments")}>
              Open Payments → Subscriptions
            </button>
          </div>
        )}

        {section === "console" && (
          <div className="card">
            <div className="card-head">
              <h2>Console behaviour</h2>
            </div>
            <div className="between" style={{ marginBottom: 16 }}>
              <div style={{ minWidth: 0, paddingRight: 14 }}>
                <b style={{ fontSize: 13, display: "block" }}>Jump me to approvals automatically</b>
                <span className="muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
                  When an agent parks a payment, switch the console to Approvals instantly instead
                  of only showing a banner.
                </span>
              </div>
              <button
                className={`switch ${prefs.autoJump ? "on" : ""}`}
                onClick={() => savePrefs({ ...prefs, autoJump: !prefs.autoJump })}
                aria-label="Toggle auto-jump"
              />
            </div>
            <div className="kv">
              <span className="k">Guardian key</span>
              <span className="v">{session.guardianKey.slice(0, 22)}…</span>
            </div>
            <p className="faint" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.6 }}>
              This key authenticates the console. Treat it like a root password — anyone holding it
              can approve spending and change policy.
            </p>
          </div>
        )}

        {section === "connect" && (
          <div className="card">
            <div className="card-head">
              <h2>Connect your own agent</h2>
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0, lineHeight: 1.7 }}>
              Any program that can make an HTTP request can be an agent. Create one on the Overview
              screen, give it the key, and these money verbs appear on its tool menu.
            </p>
            <div className="code" style={{ whiteSpace: "pre-wrap" }}>
              {`curl -X POST ${api}/v1/agent/pay_api \\
  -H "Authorization: Bearer pv_agent_…" \\
  -H "Content-Type: application/json" \\
  -d '{"amountUsdc":"2",
       "destination":"${sellerUrl}",
       "idempotencyKey":"job-1"}'`}
            </div>
            <div className="divider" />
            <p className="muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.7 }}>
              For Claude, Eliza or LangGraph, point the MCP server at this API and the same verbs
              become native tools — <span className="mono">get_budget</span>,{" "}
              <span className="mono">pay_api</span>, <span className="mono">escrow_lock</span>.
              The agent never sees a key or a wallet.
            </p>
          </div>
        )}

        {section === "danger" && (
          <div className="card">
            <div className="card-head">
              <h2 style={{ color: "var(--red)" }}>Danger zone</h2>
            </div>
            <div className="between">
              <div style={{ minWidth: 0, paddingRight: 14 }}>
                <b style={{ fontSize: 13, display: "block" }}>Org-wide kill switch</b>
                <span className="muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
                  Freezes every agent at once. In-flight intents are denied at the policy engine,
                  not merely hidden. Escrow releases are blocked too.
                </span>
              </div>
              <button className={orgFrozen ? "ghost" : "danger"} disabled={busy} onClick={() => void toggleFreeze()}>
                {orgFrozen ? "Unfreeze org" : "Freeze everything"}
              </button>
            </div>
            {orgFrozen && (
              <div className="banner" style={{ marginTop: 14 }}>
                <span className="ico">
                  <Icon name="alert" size={16} />
                </span>
                <span className="txt">
                  <b>This org is frozen</b>
                  <span>No agent can spend anything until you unfreeze.</span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
