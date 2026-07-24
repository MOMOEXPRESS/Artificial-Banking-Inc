"use client";

import { useState } from "react";
import { Icon } from "./ui";
import { Button } from "@/components/ui/button";

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

const SECTIONS = [
  { key: "golive", label: "Go live", icon: "shield" },
  { key: "org", label: "Org & compliance", icon: "shield" },
  { key: "merchants", label: "Merchants", icon: "wallet" },
  { key: "team", label: "Team & quorum", icon: "check" },
  { key: "recurring", label: "Recurring spend", icon: "clock" },
  { key: "webhooks", label: "Webhooks", icon: "zap" },
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
  prefs: { autoJump: boolean };
  savePrefs: (p: { autoJump: boolean }) => void;
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
  const [newGuardian, setNewGuardian] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<"approver" | "viewer">("approver");
  const [orgSettings, setOrgSettings] = useState<Record<string, unknown>>({});
  const [planDraft, setPlanDraft] = useState("");
  const [treasuryHitlDraft, setTreasuryHitlDraft] = useState("50");
  const [compliance, setCompliance] = useState<{ screener?: string; denylistConfigured?: boolean; denylistCount?: number } | null>(null);
  const [obs, setObs] = useState<{ sink?: string } | null>(null);
  const [merchants, setMerchants] = useState<{ id: string; key: string; label?: string; category?: string }[]>([]);
  const [merchantForm, setMerchantForm] = useState({ key: "", label: "", category: "" });

  const loadTeam = async () => {
    try {
      const g = await gFetch("/v1/guardian/guardians").then((r) => r.json());
      setGuardians(g.guardians ?? []);
      setQuorum(g.quorum ?? 1);
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
      setTreasuryHitlDraft(String((settings.settings ?? {}).treasuryHitlUsdc ?? "50"));
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

  const networkLabel =
    setup?.network === "base" ? "Base" : setup?.network === "base-sepolia" ? "Base Sepolia" : setup?.network ?? "Base Sepolia";

  const golive = [
    {
      done: !!setup?.cdpWired,
      title: "Real custody (Coinbase CDP)",
      body:
        setup?.cdpWired
          ? `CDP custody active on ${networkLabel} — vault address unchanged; set both CDP keys and redeployed.`
          : setup?.cdpApiKeyConfigured
            ? "CDP keys look set but custody is still dev-local — redeploy / restart the API so CdpVaultProvider loads."
            : `Currently ${setup?.custody ?? "dev-local"}. In Vercel → Environment Variables set CDP_API_KEY_ID + CDP_API_KEY_SECRET, then Redeploy.`,
    },
    {
      done: !!setup?.cdpWired,
      title: `On-chain settlement (${networkLabel})`,
      body:
        setup?.cdpWired
          ? `Settling on ${networkLabel}. Fund the vault with USDC + ETH (gas), Sync, allowlist your wallet, then agent pay.`
          : `Handshake and policy are real; CDP label is optional for Sepolia ERC-20 pays. Still fund vault with ${networkLabel} USDC + ETH.`,
    },
    {
      done: false,
      title: "E2E proof: agent USDC → your wallet",
      body:
        "1) Vault USDC + ETH (Fund auto-credits)  2) Move stipend to agent  3) Playground → Agent pays your wallet — paste Base Sepolia 0x → Run  4) Approve if HITL  5) Basescan Transfer. NOT Treasury Send. Track: docs/E2E-ONCHAIN-AGENT-PAY.md",
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
                ["CDP keys", setup?.cdpApiKeyConfigured ? "configured" : "missing"],
                ["Settlement", setup?.settlement ?? "—"],
                ["Telegram", setup?.telegram ? "connected" : "not configured"],
                ["Rate limit", `${setup?.rateLimitPerMin ?? "—"}/min per key`],
                ["Approval expiry", `${setup?.approvalTtlMinutes ?? "—"} minutes`],
                ["API", api],
              ].map(([k, v]) => (
                <div className="kv" key={k}>
                  <span className="k">{k}</span>
                  <span
                    className="v"
                    style={
                      k === "Custody"
                        ? { color: setup?.cdpWired ? "var(--green)" : "var(--amber, var(--warn))" }
                        : undefined
                    }
                  >
                    {v}
                  </span>
                </div>
              ))}
              {setup?.note ? (
                <div className="hint" style={{ marginTop: 10 }}>
                  {setup.note}
                </div>
              ) : null}
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Organisation</h2>
              </div>
              <div className="field">
                <label>Vault address</label>
                <div className="code">{org?.vaultAddress}</div>
                <div className="hint">
                  Fund with {networkLabel} <b>USDC</b> (agent spend) and a little <b>ETH</b> (gas for
                  on-chain agent pays). Sync deposits on Treasury → Vault. Proof path:{" "}
                  <code>docs/E2E-ONCHAIN-AGENT-PAY.md</code>.
                </div>
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
              <div className="field">
                <label>Treasury move approval threshold (USDC)</label>
                <input
                  value={treasuryHitlDraft}
                  disabled={readOnly}
                  onChange={(e) => setTreasuryHitlDraft(e.target.value)}
                  placeholder="50"
                  inputMode="decimal"
                />
                <p className="faint" style={{ margin: "6px 0 0", fontSize: 11.5, lineHeight: 1.5 }}>
                  Moves above this amount park in Treasury → Move (multi-guardian queue) — not
                  Payments → Approvals.
                </p>
              </div>
              <Button size="sm"
                disabled={busy || readOnly}
                onClick={() =>
                  void act("Save settings", async () => {
                    const hitl = treasuryHitlDraft.trim();
                    if (hitl && (Number.isNaN(Number(hitl)) || Number(hitl) < 0)) {
                      throw new Error("Treasury HITL threshold must be a non-negative USDC amount");
                    }
                    const res = await gFetch("/v1/guardian/settings", {
                      method: "PATCH",
                      body: JSON.stringify({
                        settings: {
                          plan: planDraft.trim() || undefined,
                          treasuryHitlUsdc: hitl || "50",
                        },
                      }),
                    });
                    const d = await res.json();
                    if (!res.ok) throw new Error(d.error?.message ?? "failed");
                    setOrgSettings(d.settings ?? {});
                    setPlanDraft(String((d.settings ?? {}).plan ?? ""));
                    setTreasuryHitlDraft(String((d.settings ?? {}).treasuryHitlUsdc ?? "50"));
                    return "Org settings saved.";
                  })
                }
              >
                Save settings
              </Button>
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
                <div className="sub">
                  Labels and categories for vendors — does not gate spend. Use Policy → Allowlists
                  to permit pay_api destinations.
                </div>
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
            <Button size="sm"
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
            </Button>
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
                      <Button variant="ghost" size="sm"
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
                      </Button>
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
                    disabled={busy || readOnly}
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
                    disabled={readOnly}
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
                  <Button size="sm" disabled={busy || readOnly || !newGuardian.trim()} onClick={() => void addGuardian()}>
                    <Icon name="plus" size={12} /> Invite
                  </Button>
                </div>
              </div>
              {revealedKey && (
                <div className="code" style={{ marginBottom: 12 }}>
                  Guardian key (shown once):
                  <div style={{ marginTop: 6, color: "var(--accent)" }}>{revealedKey}</div>
                  <Button variant="ghost" size="sm" style={{ marginTop: 8 }} onClick={() => setRevealedKey(null)}>
                    I saved it
                  </Button>
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
                      <Button variant="bare" size="sm" disabled={busy || readOnly} onClick={() => void revoke(g.id)}>
                        revoke
                      </Button>
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
            <Button size="sm" onClick={() => onGoto?.("payments")}>
              Open Payments → Scheduled
            </Button>
          </div>
        )}

        {section === "webhooks" && (
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Webhooks</h2>
                <div className="sub">
                  Delivery endpoints live with the rest of org config. Open the dedicated surface to
                  add URLs and inspect the delivery log.
                </div>
              </div>
            </div>
            <Button size="sm" onClick={() => onGoto?.("webhooks")}>
              Open Webhooks
            </Button>
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
            <div className="field">
              <label>Guardian key (this browser)</label>
              <div className="code" style={{ wordBreak: "break-all", userSelect: "all" }}>
                {session.guardianKey}
              </div>
              <div className="hint">
                Held in this browser only. Copy or download a backup — the server cannot re-show it
                later.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void navigator.clipboard.writeText(session.guardianKey).then(
                    () => act("Copy guardian key", async () => "Guardian key copied."),
                    () => act("Copy guardian key", async () => {
                      throw new Error("Clipboard blocked — select the key and copy manually.");
                    }),
                  )
                }
              >
                Copy guardian key
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const when = new Date().toISOString();
                  const agents = session.agentKeys
                    .map((a) => `### ${a.name}\n\n\`${a.key}\`\n\nAgent id: \`${a.agentId}\``)
                    .join("\n\n");
                  const md = `# Artificial Banking — org keys

Generated: ${when}
${org?.org ? `Org: ${org.org.name}` : ""}

## Guardian key

\`${session.guardianKey}\`

## Agent API keys held in this browser

${agents || "_None saved in this browser session._"}
`;
                  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `artificial-banking-keys-${when.slice(0, 10)}.md`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                  void act("Download keys", async () => "Downloaded keys markdown.");
                }}
              >
                Download .md
              </Button>
            </div>
            <p className="faint" style={{ fontSize: 11.5, marginTop: 14, lineHeight: 1.6 }}>
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
              <button className={orgFrozen ? "ghost" : "danger"} disabled={busy || readOnly} onClick={() => void toggleFreeze()}>
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
