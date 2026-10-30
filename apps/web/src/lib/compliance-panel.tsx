"use client";

/**
 * Settings → Compliance: in-house KYC (who owns this organization) and KYA
 * (know your agent). Copy is deliberately plain about what these are:
 * self-attested internal checks, not regulated identity verification.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { okJson } from "./api-response";

type Limits = {
  state: "blocked" | "capped" | "policy";
  reason: string;
  perPaymentUsdc?: string;
  dailyUsdc?: string;
};
type KycProfile = {
  entityType: "individual" | "business";
  legalName: string;
  businessName: string;
  registrationNumber: string;
  country: string;
  ageAttested: boolean;
  sanctionsAttested: boolean;
  pepDeclared: boolean;
  intendedUse: string;
  expectedMonthlyVolume: "under_1k" | "1k_10k" | "10k_100k" | "over_100k";
  termsVersion?: string | null;
  termsAcceptedAt?: string | null;
  submittedAt?: string | null;
  verifiedAt?: string | null;
};
type KycView = {
  status: "unverified" | "pending" | "verified" | "restricted";
  riskTier: "low" | "medium" | "high" | null;
  reasons: string[];
  profile: KycProfile | null;
  ownerEmailVerified: boolean;
  grandfathered: boolean;
  capsEnforced: boolean;
  orgLimits: Limits;
  starterLimits: { perPaymentUsdc: string; dailyUsdc: string };
  termsVersion: string;
  sanctionsListVersion: string;
  embargoedCountries: Record<string, string>;
  events: {
    id: number;
    subjectKind: string;
    subjectId: string;
    action: string;
    actor?: string;
    createdAt: string;
  }[];
  disclaimer: string;
};
type AgentKya = {
  agentId: string;
  name: string;
  keyFingerprint: string;
  status: "unattested" | "attested" | "suspended";
  purpose: string;
  operator: string;
  model: string;
  provider: string;
  allowedCategories: string[];
  allowedCounterparties: string[];
  attestedBy: string | null;
  attestedAt: string | null;
  suspendedReason: string | null;
  riskTier: "low" | "medium" | "high";
  anomalyFlags: { code: string; message: string }[];
  spending: Limits;
};

const COUNTRY_CODES =
  "AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW".split(
    " ",
  );

const STATUS_PILL: Record<string, string> = {
  verified: "ok",
  attested: "ok",
  pending: "warn",
  unverified: "warn",
  unattested: "warn",
  restricted: "bad",
  suspended: "bad",
};

const EMPTY: KycProfile = {
  entityType: "individual",
  legalName: "",
  businessName: "",
  registrationNumber: "",
  country: "",
  ageAttested: false,
  sanctionsAttested: false,
  pepDeclared: false,
  intendedUse: "",
  expectedMonthlyVolume: "under_1k",
};

function LimitsLine({ limits }: { limits: Limits }) {
  if (limits.state === "policy") return <span className="faint">{limits.reason}</span>;
  if (limits.state === "blocked")
    return <span style={{ color: "var(--bad, #b42318)" }}>{limits.reason}</span>;
  return (
    <span>
      {limits.reason} Up to <b>${limits.perPaymentUsdc}</b> per payment and{" "}
      <b>${limits.dailyUsdc}</b> per 24h per agent.
    </span>
  );
}

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

export function CompliancePanel({
  gFetch,
  act,
  canEdit,
}: {
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  canEdit: boolean;
}) {
  const [kyc, setKyc] = useState<KycView | null>(null);
  const [agents, setAgents] = useState<AgentKya[] | null>(null);
  const [form, setForm] = useState<KycProfile>(EMPTY);
  const [terms, setTerms] = useState(false);
  const [editing, setEditing] = useState(false);
  const [agentEdit, setAgentEdit] = useState<string | null>(null);
  const [agentForm, setAgentForm] = useState({
    purpose: "",
    operator: "",
    model: "",
    provider: "",
    categories: "",
    counterparties: "",
  });
  const [loadError, setLoadError] = useState("");

  const regionName = useMemo(() => {
    try {
      const dn = new Intl.DisplayNames(["en"], { type: "region" });
      return (c: string) => dn.of(c) ?? c;
    } catch {
      return (c: string) => c;
    }
  }, []);
  const countries = useMemo(
    () =>
      COUNTRY_CODES.map((c) => ({ code: c, name: regionName(c) })).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [regionName],
  );

  const load = useCallback(async () => {
    const [k, a] = await Promise.all([
      gFetch("/v1/guardian/compliance/kyc").then(okJson),
      gFetch("/v1/guardian/compliance/agents").then(okJson),
    ]);
    if (k?.status) {
      setKyc(k as KycView);
      setLoadError("");
      if (k.profile) setForm({ ...EMPTY, ...k.profile });
    } else {
      setLoadError(
        "Compliance status could not be loaded. It will retry when you reopen this page.",
      );
    }
    if (Array.isArray(a?.agents)) setAgents(a.agents as AgentKya[]);
  }, [gFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitKyc = () =>
    act("Verification", async () => {
      const res = await gFetch("/v1/guardian/compliance/kyc", {
        method: "PUT",
        body: JSON.stringify({
          entityType: form.entityType,
          legalName: form.legalName,
          businessName: form.businessName || undefined,
          registrationNumber: form.registrationNumber || undefined,
          country: form.country,
          ageAttested: form.ageAttested,
          sanctionsAttested: form.sanctionsAttested,
          pepDeclared: form.pepDeclared,
          intendedUse: form.intendedUse,
          expectedMonthlyVolume: form.expectedMonthlyVolume,
          termsAccepted: terms,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? `HTTP ${res.status}`);
      setEditing(false);
      await load();
      return d.status === "verified"
        ? "Verification complete. Starter limits are lifted for attested agents."
        : d.status === "restricted"
          ? "Saved. This organization is restricted and cannot make payments."
          : "Saved. Verify your email to finish.";
    });

  const startAgentEdit = (a: AgentKya) => {
    setAgentEdit(a.agentId);
    setAgentForm({
      purpose: a.purpose,
      operator: a.operator,
      model: a.model,
      provider: a.provider,
      categories: a.allowedCategories.join(", "),
      counterparties: a.allowedCounterparties.join(", "),
    });
  };

  const split = (s: string) =>
    s
      .split(/[,\n]/)
      .map((x) => x.trim())
      .filter(Boolean);

  const saveAgent = (agentId: string, attest: boolean) =>
    act("Know your agent", async () => {
      const res = await gFetch(`/v1/guardian/compliance/agents/${agentId}`, {
        method: "PUT",
        body: JSON.stringify({
          purpose: agentForm.purpose,
          operator: agentForm.operator,
          model: agentForm.model || undefined,
          provider: agentForm.provider || undefined,
          allowedCategories: split(agentForm.categories),
          allowedCounterparties: split(agentForm.counterparties),
          attest,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? `HTTP ${res.status}`);
      setAgentEdit(null);
      await load();
      return attest ? "Agent attested." : "Agent details saved (not attested).";
    });

  const suspend = (a: AgentKya) => {
    const reason = window.prompt(
      `Why suspend ${a.name}? It will not be able to pay until reinstated.`,
    );
    if (!reason || reason.trim().length < 3) return;
    void act("Suspend agent", async () => {
      const res = await gFetch(`/v1/guardian/compliance/agents/${a.agentId}/suspend`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? `HTTP ${res.status}`);
      await load();
      return `${a.name} suspended.`;
    });
  };

  const reinstate = (a: AgentKya) =>
    act("Reinstate agent", async () => {
      const res = await gFetch(`/v1/guardian/compliance/agents/${a.agentId}/reinstate`, {
        method: "POST",
        body: "{}",
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? `HTTP ${res.status}`);
      await load();
      return `${a.name} reinstated.`;
    });

  if (loadError && !kyc) {
    return (
      <div className="card">
        <div className="card-head">
          <h2>Compliance</h2>
        </div>
        <p className="faint">{loadError}</p>
      </div>
    );
  }
  if (!kyc) return <div className="card faint">Loading compliance…</div>;

  const showForm = canEdit && (editing || !kyc.profile);
  const embargoed = form.country && kyc.embargoedCountries[form.country];

  return (
    <>
      <div className="banner compliance-disclaimer" role="note">
        <span className="txt">
          <b>Internal checks, not regulated verification</b>
          <span>
            {kyc.disclaimer} ABI is not a bank and does not hold customer deposits. Testnet only.
          </span>
        </span>
      </div>

      <div className="card" id="kyc">
        <div className="card-head">
          <div>
            <h2 style={{ margin: 0 }}>Know your customer</h2>
            <div className="sub">
              Who stands behind this organization. Filled in once by an owner.
            </div>
          </div>
          <span className={`pill ${STATUS_PILL[kyc.status] ?? "mute"}`}>
            <i /> {kyc.status}
            {kyc.riskTier ? ` · ${kyc.riskTier} risk` : ""}
          </span>
        </div>

        <div className="compliance-limits">
          <b>Spending limits from verification</b>
          <LimitsLine limits={kyc.orgLimits} />
          {kyc.grandfathered && (
            <span className="faint">
              This organization existed before these checks shipped, so starter limits do not apply
              to it. Completing the profile is still recommended.
            </span>
          )}
          {!kyc.capsEnforced && !kyc.grandfathered && (
            <span className="faint">Starter limits are not enforced on this deployment.</span>
          )}
        </div>

        {kyc.reasons.length > 0 && (
          <ul className="compliance-reasons">
            {kyc.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}

        {kyc.profile && !showForm && (
          <div className="compliance-summary">
            <div>
              <span>Legal name</span>
              <b>{kyc.profile.legalName}</b>
            </div>
            <div>
              <span>Type</span>
              <b>
                {kyc.profile.entityType === "business"
                  ? `Business · ${kyc.profile.businessName}`
                  : "Individual"}
              </b>
            </div>
            <div>
              <span>Country</span>
              <b>{regionName(kyc.profile.country)}</b>
            </div>
            <div>
              <span>Terms</span>
              <b>
                v{kyc.profile.termsVersion} · {when(kyc.profile.termsAcceptedAt)}
              </b>
            </div>
            <div>
              <span>Submitted</span>
              <b>{when(kyc.profile.submittedAt)}</b>
            </div>
            <div>
              <span>Verified</span>
              <b>{when(kyc.profile.verifiedAt)}</b>
            </div>
            {canEdit && (
              <button className="ghost sm" onClick={() => setEditing(true)}>
                Update details
              </button>
            )}
          </div>
        )}

        {!canEdit && !kyc.profile && <p className="faint">An owner needs to complete this.</p>}

        {showForm && (
          <div className="compliance-form">
            <div className="field">
              <label htmlFor="kyc-type">Account type</label>
              <select
                id="kyc-type"
                value={form.entityType}
                onChange={(e) =>
                  setForm({ ...form, entityType: e.target.value as KycProfile["entityType"] })
                }
              >
                <option value="individual">Individual</option>
                <option value="business">Business</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="kyc-name">Your full legal name</label>
              <input
                id="kyc-name"
                autoComplete="name"
                maxLength={120}
                value={form.legalName}
                onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                placeholder="As on your ID"
              />
            </div>
            {form.entityType === "business" && (
              <>
                <div className="field">
                  <label htmlFor="kyc-biz">Registered business name</label>
                  <input
                    id="kyc-biz"
                    autoComplete="organization"
                    maxLength={160}
                    value={form.businessName}
                    onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="kyc-reg">
                    Registration number <span>Optional</span>
                  </label>
                  <input
                    id="kyc-reg"
                    maxLength={80}
                    value={form.registrationNumber}
                    onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
                    placeholder="e.g. SIREN, EIN, Companies House no."
                  />
                </div>
              </>
            )}
            <div className="field">
              <label htmlFor="kyc-country">Country of residence or incorporation</label>
              <select
                id="kyc-country"
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
              >
                <option value="">Choose a country…</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
              {embargoed && (
                <span className="compliance-warn">
                  {embargoed} is on ABI&apos;s embargoed list. Saving will restrict this
                  organization.
                </span>
              )}
            </div>
            <div className="field">
              <label htmlFor="kyc-volume">Expected monthly agent spend</label>
              <select
                id="kyc-volume"
                value={form.expectedMonthlyVolume}
                onChange={(e) =>
                  setForm({
                    ...form,
                    expectedMonthlyVolume: e.target.value as KycProfile["expectedMonthlyVolume"],
                  })
                }
              >
                <option value="under_1k">Under $1,000</option>
                <option value="1k_10k">$1,000 – $10,000</option>
                <option value="10k_100k">$10,000 – $100,000</option>
                <option value="over_100k">Over $100,000</option>
              </select>
            </div>
            <div className="field compliance-wide">
              <label htmlFor="kyc-use">What will your agents pay for?</label>
              <input
                id="kyc-use"
                maxLength={500}
                value={form.intendedUse}
                onChange={(e) => setForm({ ...form, intendedUse: e.target.value })}
                placeholder="e.g. research APIs and data feeds"
              />
            </div>
            <label className="compliance-check compliance-wide">
              <input
                type="checkbox"
                checked={form.ageAttested}
                onChange={(e) => setForm({ ...form, ageAttested: e.target.checked })}
              />
              <span>I am at least 18 years old.</span>
            </label>
            <label className="compliance-check compliance-wide">
              <input
                type="checkbox"
                checked={form.sanctionsAttested}
                onChange={(e) => setForm({ ...form, sanctionsAttested: e.target.checked })}
              />
              <span>
                Neither I nor the organization is on a sanctions list or acting for anyone who is,
                and we are not located in an embargoed country or region.
              </span>
            </label>
            <label className="compliance-check compliance-wide">
              <input
                type="checkbox"
                checked={form.pepDeclared}
                onChange={(e) => setForm({ ...form, pepDeclared: e.target.checked })}
              />
              <span>I am a politically exposed person (or a close associate of one).</span>
            </label>
            <label className="compliance-check compliance-wide">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
              <span>
                I accept the{" "}
                <a href="/terms" target="_blank">
                  Terms of Use
                </a>{" "}
                and{" "}
                <a href="/privacy" target="_blank">
                  Privacy Notice
                </a>{" "}
                (version {kyc.termsVersion}), and confirm the above is true.
              </span>
            </label>
            <div className="compliance-actions compliance-wide">
              <button
                onClick={() => void submitKyc()}
                disabled={!terms || !form.legalName.trim() || !form.country}
              >
                {kyc.profile ? "Save and re-check" : "Submit verification"}
              </button>
              {kyc.profile && (
                <button className="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              )}
              <span className="faint">
                Checked locally against a bundled list ({kyc.sanctionsListVersion}). No documents
                are collected and nothing is sent to a third party.
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="card" id="kya">
        <div className="card-head">
          <div>
            <h2 style={{ margin: 0 }}>Know your agent</h2>
            <div className="sub">
              Each agent is bound to this organization. An owner declares what it is for and who
              runs it, then vouches for it. Unattested agents keep starter limits; suspended agents
              cannot pay.
            </div>
          </div>
        </div>
        {!agents?.length && <p className="faint">No agents yet. Create one under API.</p>}
        <div className="kya-list">
          {agents?.map((a) => (
            <div className="kya-row" key={a.agentId}>
              <div className="kya-head">
                <div style={{ minWidth: 0 }}>
                  <b className="kya-name">{a.name}</b>
                  <span
                    className="faint mono kya-fp"
                    title="Fingerprint of the agent's API key (never the key)"
                  >
                    key {a.keyFingerprint}
                  </span>
                </div>
                <div className="kya-pills">
                  <span className={`pill ${STATUS_PILL[a.status] ?? "mute"}`}>
                    <i /> {a.status}
                  </span>
                  <span
                    className={`pill ${a.riskTier === "low" ? "ok" : a.riskTier === "high" ? "bad" : "mute"}`}
                  >
                    {a.riskTier} risk
                  </span>
                </div>
              </div>
              <div className="kya-meta">
                <span>
                  <em>Purpose</em> {a.purpose || "—"}
                </span>
                <span>
                  <em>Operator</em> {a.operator || "—"}
                </span>
                <span>
                  <em>Model</em> {[a.provider, a.model].filter(Boolean).join(" · ") || "—"}
                </span>
                <span>
                  <em>Scope</em>{" "}
                  {a.allowedCategories.length || a.allowedCounterparties.length
                    ? [...a.allowedCategories, ...a.allowedCounterparties].join(", ")
                    : "any (policy decides)"}
                </span>
                {a.attestedAt && (
                  <span>
                    <em>Attested</em> {a.attestedBy} · {when(a.attestedAt)}
                  </span>
                )}
                {a.suspendedReason && (
                  <span>
                    <em>Suspended</em> {a.suspendedReason}
                  </span>
                )}
              </div>
              <div className="kya-spend">
                <LimitsLine limits={a.spending} />
              </div>
              {a.anomalyFlags.length > 0 && (
                <ul className="compliance-reasons">
                  {a.anomalyFlags.map((f) => (
                    <li key={f.code}>{f.message}</li>
                  ))}
                </ul>
              )}
              {canEdit && agentEdit !== a.agentId && (
                <div className="compliance-actions">
                  {a.status !== "suspended" && (
                    <button className="sm" onClick={() => startAgentEdit(a)}>
                      {a.status === "attested" ? "Edit" : "Declare & attest"}
                    </button>
                  )}
                  {a.status === "suspended" ? (
                    <button className="sm" onClick={() => void reinstate(a)}>
                      Reinstate
                    </button>
                  ) : (
                    <button className="sm danger" onClick={() => suspend(a)}>
                      Suspend
                    </button>
                  )}
                </div>
              )}
              {agentEdit === a.agentId && (
                <div className="compliance-form">
                  <div className="field compliance-wide">
                    <label>Purpose</label>
                    <input
                      maxLength={300}
                      value={agentForm.purpose}
                      onChange={(e) => setAgentForm({ ...agentForm, purpose: e.target.value })}
                      placeholder="e.g. buys market data for weekly reports"
                    />
                  </div>
                  <div className="field">
                    <label>Operator (person or team responsible)</label>
                    <input
                      maxLength={120}
                      value={agentForm.operator}
                      onChange={(e) => setAgentForm({ ...agentForm, operator: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>
                      Model provider <span>Optional</span>
                    </label>
                    <input
                      maxLength={80}
                      value={agentForm.provider}
                      onChange={(e) => setAgentForm({ ...agentForm, provider: e.target.value })}
                      placeholder="e.g. Anthropic, OpenAI, self-hosted"
                    />
                  </div>
                  <div className="field">
                    <label>
                      Model <span>Optional</span>
                    </label>
                    <input
                      maxLength={80}
                      value={agentForm.model}
                      onChange={(e) => setAgentForm({ ...agentForm, model: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>
                      Allowed categories <span>Optional, enforced</span>
                    </label>
                    <input
                      value={agentForm.categories}
                      onChange={(e) => setAgentForm({ ...agentForm, categories: e.target.value })}
                      placeholder="comma-separated, e.g. data, compute"
                    />
                  </div>
                  <div className="field compliance-wide">
                    <label>
                      Allowed counterparties <span>Optional, enforced</span>
                    </label>
                    <input
                      value={agentForm.counterparties}
                      onChange={(e) =>
                        setAgentForm({ ...agentForm, counterparties: e.target.value })
                      }
                      placeholder="domains or 0x addresses, comma-separated"
                    />
                  </div>
                  <div className="compliance-actions compliance-wide">
                    <button
                      onClick={() => void saveAgent(a.agentId, true)}
                      disabled={
                        agentForm.purpose.trim().length < 4 || agentForm.operator.trim().length < 2
                      }
                    >
                      Attest this agent
                    </button>
                    <button className="ghost" onClick={() => void saveAgent(a.agentId, false)}>
                      Save without attesting
                    </button>
                    <button className="ghost" onClick={() => setAgentEdit(null)}>
                      Cancel
                    </button>
                    <span className="faint">
                      Attesting means you vouch that this agent is yours and does what you
                      described.
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {kyc.events.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2 style={{ margin: 0 }}>Compliance history</h2>
          </div>
          <ul className="compliance-history">
            {kyc.events.map((e) => (
              <li key={e.id}>
                <span className="mono">{e.action}</span>
                <span className="faint">
                  {e.subjectKind === "agent"
                    ? (agents?.find((a) => a.agentId === e.subjectId)?.name ?? e.subjectId)
                    : "organization"}
                  {e.actor ? ` · ${e.actor}` : ""} · {when(e.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
