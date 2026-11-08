"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "./ui";
import { CompliancePanel } from "./compliance-panel";
import { MfaPanel } from "./mfa-panel";
import { AccountAccessPanel } from "./account-access-panel";
import { Button } from "@/components/ui/button";
import { okJson } from "./api-response";
import { TreasuryView } from "./treasury-view";

export type Setup = {
  custody: string;
  network: string;
  settlement: string;
  telegram: boolean;
  rateLimitPerMin: number;
  approvalTtlMinutes: number;
  custodyModel?: string;
  managedCustodyProvider?: string | null;
  custodyDisclosure?: string;
  productionMode?: boolean;
  onchainMode?: boolean;
  vaultKeysEncryptedAtRest?: boolean;
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
type Merchant = {
  id: string;
  key: string;
  label?: string;
  category?: string;
  meta?: {
    gateway?: {
      status?: string;
      endpoint?: string;
      payoutAddress?: string;
      priceUsdc?: string;
      network?: string;
    };
  };
};

type MerchantPayment = {
  intentId: string;
  state: string;
  amountUsdc: string;
  chargedUsdc: string | null;
  rail: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  createdAt: string;
  error: string | null;
};

const SECTIONS = [
  {
    key: "profile",
    label: "Workspace profile",
    icon: "shield",
    group: "Workspace",
    description: "Identity, location, how this workspace uses ABI, and signing in or out.",
  },
  {
    key: "merchants",
    label: "Merchants",
    icon: "wallet",
    group: "Finance",
    description: "Approved sellers, gateway profiles, and payout routes.",
  },
  {
    key: "team",
    label: "Team & quorum",
    icon: "check",
    group: "People & access",
    description: "People, roles and the number of approvals required for a payment.",
  },
  {
    key: "security",
    label: "Security",
    icon: "shield",
    group: "People & access",
    description: "Authentication, key posture, and incident controls.",
  },
  {
    key: "connect",
    label: "Connect agent",
    icon: "robot",
    group: "Connections",
    description: "Give a runtime the minimum credentials and scopes it needs.",
  },
  {
    key: "compliance",
    label: "Compliance (KYC & KYA)",
    icon: "shield",
    group: "People & access",
    description:
      "Know your customer and know your agent: internal, self-attested checks that set starter limits.",
  },
] as const;

const SETTINGS_GROUPS = ["Workspace", "Finance", "People & access", "Connections"] as const;

type Section = (typeof SECTIONS)[number]["key"];

export function SettingsView({
  session,
  org,
  busy,
  act,
  gFetch,
  actorRole = "owner",
  initialSection,
  onGoto,
  onSignOut,
}: {
  setup: Setup | null;
  recon: Recon | null;
  prefs: { autoJump: boolean };
  savePrefs: (p: { autoJump: boolean }) => void;
  session: {
    mode?: "session" | "key";
    guardianKey: string;
    agentKeys: { agentId: string; name: string; key: string }[];
  };
  org: { org: { name: string; status: string }; vaultAddress: string } | null;
  metrics: { agents: number } | null;
  agents: { id: string; name: string }[];
  busy: boolean;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
  api: string;
  sellerUrl: string;
  actorRole?: "owner" | "approver" | "viewer";
  initialSection?: string | null;
  onGoto?: (view: string) => void;
  /** Shared sign-out (lib/sign-out.ts), used by Account access in Organization profile. */
  onSignOut: (everywhere: boolean) => void;
}) {
  const readOnly = actorRole === "viewer";
  const [section, setSection] = useState<Section>("profile");
  // Deep links such as /console?view=settings&section=compliance.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("section") ?? initialSection;
    if (wanted === "connect") {
      const url = new URL(window.location.href);
      url.searchParams.delete("section");
      url.searchParams.delete("tab");
      window.history.replaceState(null, "", url);
      onGoto?.("connect");
      return;
    }
    if (wanted && SECTIONS.some((item) => item.key === wanted)) setSection(wanted as Section);
  }, [initialSection, onGoto]);
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [quorum, setQuorum] = useState(1);
  const [newGuardian, setNewGuardian] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [showGuardianKey, setShowGuardianKey] = useState(false);
  const [inviteRole, setInviteRole] = useState<"approver" | "viewer">("approver");
  const [accountInviteEmail, setAccountInviteEmail] = useState("");
  const [accountInvitations, setAccountInvitations] = useState<
    { id: string; email: string; role: string; createdAt: string; expiresAt: string }[]
  >([]);
  const [revealedInviteToken, setRevealedInviteToken] = useState<string | null>(null);
  const [userSessions, setUserSessions] = useState<
    { id: string; createdAt: string; expiresAt: string; userAgent?: string; current: boolean }[]
  >([]);
  const [profile, setProfile] = useState({
    displayName: "",
    legalName: "",
    website: "",
    description: "",
    country: "",
    timezone: "UTC",
    organizationType: "other",
    intendedUse: "",
    workspace: "buyer",
    defaultCurrencyDisplay: "USD" as "USD" | "EUR",
  });
  const [profileMeta, setProfileMeta] = useState({
    orgId: "",
    environment: "",
    status: "",
    plan: "",
  });
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [selectedMerchantId, setSelectedMerchantId] = useState<string | null>(null);
  const [merchantPayments, setMerchantPayments] = useState<MerchantPayment[]>([]);
  const [activityError, setActivityError] = useState("");
  const [activityLoading, setActivityLoading] = useState(false);
  const [copiedSellerConfig, setCopiedSellerConfig] = useState(false);
  const [merchantForm, setMerchantForm] = useState({ key: "", label: "", category: "" });
  const [gatewayForm, setGatewayForm] = useState({
    label: "",
    endpoint: "",
    payoutAddress: "",
    priceUsdc: "0.01",
    category: "data",
    network: "eip155:84532",
  });

  const loadTeam = useCallback(async () => {
    try {
      const g = await gFetch("/v1/guardian/guardians").then(okJson);
      if (!g) return;
      setGuardians(g.guardians ?? []);
      setQuorum(g.quorum ?? 1);
    } catch {
      /* non-fatal */
    }
  }, [gFetch]);

  // Load the lazily-fetched sections on first visit.
  const loadPlatform = useCallback(async () => {
    try {
      const data = await gFetch("/v1/guardian/merchants").then(okJson);
      if (data) setMerchants(data.merchants ?? []);
    } catch {
      /* Existing seller details remain available until a successful refresh. */
    }
  }, [gFetch]);

  const loadProfile = useCallback(async () => {
    try {
      const [response, settingsResponse] = await Promise.all([
        gFetch("/v1/guardian/organization-profile"),
        gFetch("/v1/guardian/settings"),
      ]);
      if (!response.ok) return;
      const [data, settingsData] = await Promise.all([
        response.json(),
        settingsResponse.ok ? settingsResponse.json() : Promise.resolve(null),
      ]);
      setProfile((previous) => ({ ...previous, ...data.profile }));
      setProfileMeta({
        orgId: data.orgId ?? "",
        environment: data.environment ?? "",
        status: data.status ?? "",
        plan: settingsData?.settings?.plan ?? "",
      });
    } catch {
      /* The current profile can be reloaded on the next visit. */
    }
  }, [gFetch]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const loadAccountInvitations = useCallback(async () => {
    if (session.mode !== "session" || !profileMeta.orgId) return;
    try {
      const response = await gFetch(
        `/v1/auth/orgs/${encodeURIComponent(profileMeta.orgId)}/invitations`,
      );
      if (!response.ok) return;
      const data = (await response.json()) as { invitations?: typeof accountInvitations };
      setAccountInvitations(data.invitations ?? []);
    } catch {
      /* account invitations are unavailable to legacy guardian-key sessions */
    }
  }, [gFetch, profileMeta.orgId, session.mode]);

  useEffect(() => {
    if (section === "team") void loadAccountInvitations();
  }, [loadAccountInvitations, section]);

  const loadUserSessions = useCallback(async () => {
    if (session.mode !== "session") return;
    try {
      const response = await gFetch("/v1/auth/sessions");
      if (!response.ok) return;
      const data = (await response.json()) as { sessions?: typeof userSessions };
      setUserSessions(data.sessions ?? []);
    } catch {
      /* sessions are available to signed-in account users only */
    }
  }, [gFetch, session.mode]);

  useEffect(() => {
    if (section === "security") void loadUserSessions();
  }, [loadUserSessions, section]);

  useEffect(() => {
    if (section === "team") void loadTeam();
    if (section === "merchants") void loadPlatform();
  }, [section, loadTeam, loadPlatform]);

  const go = (next: Section) => {
    if (next === "connect") {
      const url = new URL(window.location.href);
      url.searchParams.delete("section");
      url.searchParams.delete("tab");
      window.history.replaceState(null, "", url);
      onGoto?.("connect");
      return;
    }
    setSection(next);
    const url = new URL(window.location.href);
    url.searchParams.set("section", next);
    window.history.replaceState(null, "", url);
    if (next === "profile") void loadProfile();
  };

  const loadMerchantActivity = async (merchantId: string) => {
    setSelectedMerchantId(merchantId);
    setActivityLoading(true);
    setActivityError("");
    setMerchantPayments([]);
    try {
      const response = await gFetch(`/v1/guardian/merchant-gateway/${merchantId}/activity`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not load seller activity");
      setMerchantPayments(data.settlements ?? []);
    } catch (error) {
      setActivityError(error instanceof Error ? error.message : "Could not load seller activity");
    } finally {
      setActivityLoading(false);
    }
  };

  const selectedMerchant = merchants.find((m) => m.id === selectedMerchantId);
  const sellerConfig = selectedMerchant?.meta?.gateway
    ? `X402_SELLER_ADDRESS=${selectedMerchant.meta.gateway.payoutAddress ?? "0x..."}\nX402_PRICE_USDC=$${selectedMerchant.meta.gateway.priceUsdc ?? "0.01"}\nCHAIN=${selectedMerchant.meta.gateway.network === "eip155:8453" ? "base" : "base-sepolia"}\nX402_FACILITATOR_URL=https://x402.org/facilitator`
    : "";

  const currentOrgStatus = org?.org?.status ?? profileMeta.status;
  const orgFrozen = currentOrgStatus === "frozen";
  const activeSection = SECTIONS.find((item) => item.key === section) ?? SECTIONS[0];

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

  const inviteAccountMember = () =>
    act("Email invitation", async () => {
      const res = await gFetch(
        `/v1/auth/orgs/${encodeURIComponent(profileMeta.orgId)}/invitations`,
        {
          method: "POST",
          body: JSON.stringify({ email: accountInviteEmail.trim(), role: inviteRole }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Could not send invitation");
      setRevealedInviteToken(data.invitationToken ?? null);
      setAccountInviteEmail("");
      await loadAccountInvitations();
      return data.emailSent
        ? `Invitation emailed to ${data.invitation.email}.`
        : `Email delivery is unavailable. Share the token with ${data.invitation.email} securely.`;
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

  return (
    <div className="set-grid console-page settings-page">
      <nav className="set-nav" aria-label="Settings sections">
        <div className="set-nav-head">
          <span>Settings</span>
          <small>{actorRole}</small>
        </div>
        <div
          className="set-nav-org"
          title={profile.displayName || org?.org?.name || "Organization"}
        >
          <span className="set-nav-org-mark" aria-hidden>
            {(profile.displayName || org?.org?.name || "O").trim().slice(0, 1).toUpperCase()}
          </span>
          <span>{profile.displayName || org?.org?.name || "Your organization"}</span>
        </div>
        <select
          className="settings-mobile-picker"
          aria-label="Choose settings section"
          value={section}
          onChange={(event) => go(event.target.value as Section)}
        >
          {SETTINGS_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {SECTIONS.filter((item) => item.group === group).map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {SETTINGS_GROUPS.map((group) => (
          <div className="set-nav-group" key={group}>
            <span className="set-nav-label">{group}</span>
            {SECTIONS.filter((item) => item.group === group).map((s) => (
              <button
                key={s.key}
                className={section === s.key ? "on" : ""}
                aria-current={section === s.key ? "page" : undefined}
                onClick={() => go(s.key)}
              >
                <Icon name={s.icon} />
                <span>{s.label}</span>
                {section === s.key && <Icon name="arrowRight" size={12} />}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <section className="settings-content" aria-label="Settings details">
        <section className="settings-section-summary">
          <div>
            <h1>{activeSection.label}</h1>
            <p>{activeSection.description}</p>
          </div>
        </section>
        {section === "profile" && (
          <div className="card settings-profile-card">
            <div className="settings-profile-identity">
              <span className="settings-profile-avatar" aria-hidden>
                {(profile.displayName || org?.org?.name || "O").trim().slice(0, 1).toUpperCase()}
              </span>
              <div className="settings-profile-identity-copy">
                <strong>{profile.displayName || org?.org?.name || "Your organization"}</strong>
                <span>Organization workspace</span>
              </div>
              <span className={`pill ${orgFrozen ? "bad" : currentOrgStatus ? "ok" : "warn"}`}>
                <i /> {currentOrgStatus || "loading"}
              </span>
            </div>

            {readOnly && (
              <div className="settings-readonly-note" role="status">
                You can view this profile, but only an owner can change it.
              </div>
            )}

            <details className="settings-profile-details">
              <summary>Workspace details</summary>
              <div className="settings-profile-meta" aria-label="Workspace status">
                <div>
                  <span>Organization ID</span>
                  <strong className="mono" title={profileMeta.orgId || undefined}>
                    {profileMeta.orgId || "Loading…"}
                  </strong>
                </div>
                <div>
                  <span>Environment</span>
                  <strong>
                    {profileMeta.environment === "testnet"
                      ? "Live · testnet"
                      : profileMeta.environment === "mainnet"
                        ? "Live · mainnet"
                        : profileMeta.environment || "—"}
                  </strong>
                  {profileMeta.environment === "testnet" ? (
                    <small className="faint">
                      Real Base Sepolia testnet funds only — balances come from on-chain deposits.
                    </small>
                  ) : null}
                </div>
                <div>
                  <span>Organization status</span>
                  <strong>{profileMeta.status || "—"}</strong>
                </div>
                <div>
                  <span>Plan</span>
                  <strong>{profileMeta.plan || "Not set"}</strong>
                </div>
              </div>
            </details>

            <div className="settings-form-section">
              <div className="settings-form-section-heading">
                <h2>Organization details</h2>
                <p>Display and operating details for this ABI workspace.</p>
              </div>
              <div className="settings-profile-fields">
                <div className="field">
                  <label htmlFor="profile-display">Organization name</label>
                  <input
                    id="profile-display"
                    autoComplete="organization"
                    value={profile.displayName}
                    disabled={readOnly}
                    onChange={(event) =>
                      setProfile({ ...profile, displayName: event.target.value })
                    }
                    placeholder="Your organization"
                    maxLength={80}
                  />
                </div>
                <div className="field">
                  <label htmlFor="profile-legal">
                    Legal name <span>Optional</span>
                  </label>
                  <input
                    id="profile-legal"
                    autoComplete="organization"
                    value={profile.legalName}
                    disabled={readOnly}
                    onChange={(event) => setProfile({ ...profile, legalName: event.target.value })}
                    placeholder="Registered legal entity name"
                    maxLength={160}
                  />
                </div>
                <div className="field">
                  <label htmlFor="profile-website">
                    Website <span>Optional</span>
                  </label>
                  <input
                    id="profile-website"
                    type="url"
                    autoComplete="url"
                    placeholder="https://example.com"
                    value={profile.website}
                    disabled={readOnly}
                    onChange={(event) => setProfile({ ...profile, website: event.target.value })}
                    maxLength={300}
                  />
                </div>
                <div className="field">
                  <label htmlFor="profile-country">Country or region</label>
                  <input
                    id="profile-country"
                    autoComplete="country-name"
                    value={profile.country}
                    disabled={readOnly}
                    onChange={(event) => setProfile({ ...profile, country: event.target.value })}
                    placeholder="Where your organization operates"
                    maxLength={80}
                  />
                </div>
                <div className="field">
                  <label htmlFor="profile-timezone">Time zone</label>
                  <input
                    id="profile-timezone"
                    value={profile.timezone}
                    disabled={readOnly}
                    onChange={(event) => setProfile({ ...profile, timezone: event.target.value })}
                    placeholder="Europe/Paris"
                    maxLength={100}
                  />
                </div>
                <div className="field">
                  <label htmlFor="profile-type">Organization type</label>
                  <select
                    id="profile-type"
                    value={profile.organizationType}
                    disabled={readOnly}
                    onChange={(event) =>
                      setProfile({ ...profile, organizationType: event.target.value })
                    }
                  >
                    <option value="company">Company</option>
                    <option value="individual">Individual</option>
                    <option value="nonprofit">Nonprofit</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="profile-currency">Default display currency</label>
                  <select
                    id="profile-currency"
                    value={profile.defaultCurrencyDisplay}
                    disabled={readOnly}
                    onChange={(event) =>
                      setProfile({
                        ...profile,
                        defaultCurrencyDisplay: event.target.value as "USD" | "EUR",
                      })
                    }
                  >
                    <option value="USD">USD — US dollar</option>
                    <option value="EUR">EUR — euro</option>
                  </select>
                  <p className="settings-field-help">
                    Display preference only. Settlement still uses the asset and network shown on
                    each payment.
                  </p>
                </div>
              </div>
            </div>

            <div className="settings-form-section">
              <div className="settings-form-section-heading">
                <h2>How you use ABI</h2>
                <p>
                  These details help describe your workspace; they do not change spending
                  permissions.
                </p>
              </div>
              <div className="settings-profile-fields settings-profile-fields-wide">
                <div className="field">
                  <label htmlFor="profile-workspace">Workspace role</label>
                  <select
                    id="profile-workspace"
                    value="buyer"
                    disabled
                    aria-describedby="profile-workspace-hint"
                  >
                    <option value="buyer">Buying services</option>
                  </select>
                  <p id="profile-workspace-hint" className="muted" style={{ marginTop: 8 }}>
                    Selling to agents uses a separate partner account. See{" "}
                    <a href="/partnerships">Partnerships</a>.
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="profile-description">
                    About the organization <span>Optional</span>
                  </label>
                  <textarea
                    id="profile-description"
                    value={profile.description}
                    disabled={readOnly}
                    onChange={(event) =>
                      setProfile({ ...profile, description: event.target.value })
                    }
                    placeholder="A short description of your organization"
                    maxLength={1000}
                    rows={3}
                  />
                </div>
                <div className="field">
                  <label htmlFor="profile-use">
                    Intended use <span>Optional</span>
                  </label>
                  <textarea
                    id="profile-use"
                    value={profile.intendedUse}
                    disabled={readOnly}
                    onChange={(event) =>
                      setProfile({ ...profile, intendedUse: event.target.value })
                    }
                    placeholder="What your agents will use ABI to do"
                    maxLength={500}
                    rows={3}
                  />
                </div>
              </div>
            </div>
            <Button
              size="sm"
              disabled={busy || readOnly || !profile.displayName.trim()}
              onClick={() =>
                void act("Save profile", async () => {
                  const response = await gFetch("/v1/guardian/organization-profile", {
                    method: "PATCH",
                    body: JSON.stringify(profile),
                  });
                  const data = await response.json();
                  if (!response.ok)
                    throw new Error(data.error?.message ?? "Could not save profile");
                  setProfile(data.profile);
                  return "Organization profile updated.";
                })
              }
            >
              Save changes
            </Button>
          </div>
        )}
        {section === "profile" && (
          <AccountAccessPanel
            gFetch={gFetch}
            act={act}
            locked={busy}
            isSessionUser={session.mode === "session"}
            onSignOut={onSignOut}
          />
        )}
        {section === "merchants" && (
          <>
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Merchant Gateway · accept test payments</h2>
                  <div className="sub">
                    1. Protect a GET endpoint with x402 V2. 2. Register its URL, USDC wallet and
                    price. 3. Verify the unpaid HTTP 402 challenge. 4. Make a policy-approved
                    payment and inspect the receipt below. USDC settles to the seller wallet.
                  </div>
                </div>
              </div>
              <div className="grid g-2" style={{ gap: "0 14px" }}>
                <div className="field">
                  <label>Seller name</label>
                  <input
                    value={gatewayForm.label}
                    disabled={readOnly}
                    onChange={(e) => setGatewayForm({ ...gatewayForm, label: e.target.value })}
                    placeholder="Acme Data"
                  />
                </div>
                <div className="field">
                  <label>Paid endpoint</label>
                  <input
                    value={gatewayForm.endpoint}
                    disabled={readOnly}
                    onChange={(e) => setGatewayForm({ ...gatewayForm, endpoint: e.target.value })}
                    placeholder="https://api.example.com/report"
                  />
                </div>
                <div className="field">
                  <label>USDC payout wallet</label>
                  <input
                    className="mono"
                    value={gatewayForm.payoutAddress}
                    disabled={readOnly}
                    onChange={(e) =>
                      setGatewayForm({ ...gatewayForm, payoutAddress: e.target.value })
                    }
                    placeholder="0x…"
                  />
                </div>
                <div className="field">
                  <label>Price (USDC)</label>
                  <input
                    value={gatewayForm.priceUsdc}
                    disabled={readOnly}
                    onChange={(e) => setGatewayForm({ ...gatewayForm, priceUsdc: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Category</label>
                  <input
                    value={gatewayForm.category}
                    disabled={readOnly}
                    onChange={(e) => setGatewayForm({ ...gatewayForm, category: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Network</label>
                  <select
                    value={gatewayForm.network}
                    disabled={readOnly}
                    onChange={(e) => setGatewayForm({ ...gatewayForm, network: e.target.value })}
                  >
                    <option value="eip155:84532">Base Sepolia · testnet</option>
                    <option value="eip155:8453">
                      Base · live (requires production payment setup)
                    </option>
                  </select>
                </div>
              </div>
              <Button
                size="sm"
                disabled={
                  busy ||
                  readOnly ||
                  !gatewayForm.label.trim() ||
                  !gatewayForm.endpoint.trim() ||
                  !gatewayForm.payoutAddress.trim()
                }
                onClick={() =>
                  void act("Onboard seller", async () => {
                    const res = await gFetch("/v1/guardian/merchant-gateway/onboard", {
                      method: "POST",
                      body: JSON.stringify(gatewayForm),
                    });
                    const d = await res.json();
                    if (!res.ok) throw new Error(d.error?.message ?? "onboarding failed");
                    await loadPlatform();
                    setSelectedMerchantId(d.merchant.id);
                    setMerchantPayments([]);
                    return "Seller profile saved. Verify its x402 V2 endpoint below.";
                  })
                }
              >
                Create seller profile
              </Button>
              <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                The payout address must belong to the seller. Endpoint verification checks payment
                configuration; it does not prove wallet ownership or seller identity. Buyer payments
                also require the endpoint on the agent&apos;s policy allowlist, an agent USDC
                balance, and ETH for gas. Start on Base Sepolia.
              </p>
            </div>
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
              <Button
                size="sm"
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
              <div style={{ overflowX: "auto", marginTop: 14 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Label</th>
                      <th>Category</th>
                      <th>x402</th>
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
                          {m.meta?.gateway ? (
                            <div className="row" style={{ gap: 8 }}>
                              <span
                                className={`pill ${m.meta.gateway.status === "verified" ? "ok" : "warn"}`}
                              >
                                <i />
                                {m.meta.gateway.status ?? "pending"}
                              </span>
                              {m.meta.gateway.status !== "verified" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy || readOnly}
                                  onClick={() =>
                                    void act("Verify seller", async () => {
                                      const res = await gFetch(
                                        `/v1/guardian/merchant-gateway/${m.id}/verify`,
                                        { method: "POST" },
                                      );
                                      const d = await res.json();
                                      if (!res.ok)
                                        throw new Error(d.error?.message ?? "verification failed");
                                      await loadPlatform();
                                      return "x402 V2 endpoint verified.";
                                    })
                                  }
                                >
                                  Verify
                                </Button>
                              )}
                            </div>
                          ) : (
                            <span className="faint">directory only</span>
                          )}
                        </td>
                        <td>
                          {m.meta?.gateway && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void loadMerchantActivity(m.id)}
                            >
                              {selectedMerchantId === m.id ? "Selected" : "Open"}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
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
              </div>
              {!merchants.length && (
                <p className="muted" style={{ fontSize: 12.5 }}>
                  No merchants yet — add one or allocate spend to seed known counterparties.
                </p>
              )}
            </div>
            {selectedMerchant?.meta?.gateway && (
              <div className="card" aria-label="Selected seller details">
                <div className="card-head">
                  <div>
                    <h2>{selectedMerchant.label ?? "Seller"} · gateway</h2>
                    <div className="sub">Configuration, buyer setup and settlement history</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void loadMerchantActivity(selectedMerchant.id)}
                  >
                    Refresh activity
                  </Button>
                </div>
                <div className="kv">
                  <span className="k">Endpoint</span>
                  <span className="v mono" style={{ overflowWrap: "anywhere" }}>
                    {selectedMerchant.meta.gateway.endpoint}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Wallet</span>
                  <span className="v mono" style={{ overflowWrap: "anywhere" }}>
                    {selectedMerchant.meta.gateway.payoutAddress}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Price</span>
                  <span className="v">
                    ${selectedMerchant.meta.gateway.priceUsdc} USDC ·{" "}
                    {selectedMerchant.meta.gateway.network === "eip155:8453"
                      ? "Base mainnet"
                      : "Base Sepolia"}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Endpoint check</span>
                  <span className="v">
                    {selectedMerchant.meta.gateway.status === "verified"
                      ? "x402 V2 challenge matches"
                      : "Pending verification"}
                  </span>
                </div>
                <h3 style={{ marginTop: 24 }}>Seller integration</h3>
                <p className="muted" style={{ fontSize: 12.5 }}>
                  Use x402 V2 middleware to return HTTP 402 for an unpaid GET. Configure the same
                  network, wallet and price. For a runnable Express example, see
                  <span className="mono"> apps/x402-seller/src/index.ts</span>.
                </p>
                <pre className="code" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {sellerConfig}
                </pre>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(sellerConfig);
                      setCopiedSellerConfig(true);
                    } catch {
                      setCopiedSellerConfig(false);
                    }
                  }}
                >
                  {copiedSellerConfig ? "Copied settings" : "Copy seller settings"}
                </Button>
                <p className="muted" style={{ fontSize: 12.5 }}>
                  Once verified, allowlist this exact URL in the buyer agent&apos;s policy. Send a
                  <span className="mono"> pay_api</span> request from an agent with test USDC and
                  gas. A merchant profile alone does not authorize spend.
                </p>
                <h3 style={{ marginTop: 24 }}>Payment activity</h3>
                <p className="muted" style={{ fontSize: 12 }}>
                  Receipt hashes come from the seller&apos;s x402 response. Check the transfer and
                  payout address on Basescan to confirm chain settlement.
                </p>
                {activityLoading && (
                  <p className="muted" role="status">
                    Loading payments…
                  </p>
                )}
                {activityError && (
                  <p className="muted" role="alert">
                    {activityError}
                  </p>
                )}
                {!activityLoading && !activityError && merchantPayments.length === 0 && (
                  <p className="muted">
                    No buyer payment attempts for this endpoint yet. Verification is an unpaid
                    check; run an agent payment to see a receipt here.
                  </p>
                )}
                {!!merchantPayments.length && (
                  <div style={{ overflowX: "auto" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>State</th>
                          <th>USDC</th>
                          <th>Receipt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {merchantPayments.map((payment) => (
                          <tr key={payment.intentId}>
                            <td>{new Date(payment.createdAt).toLocaleString()}</td>
                            <td>
                              <span
                                className={`pill ${payment.state === "settled" ? "ok" : "warn"}`}
                              >
                                <i />
                                {payment.state}
                              </span>
                              {payment.error && (
                                <div className="faint" title={payment.error}>
                                  Payment failed
                                </div>
                              )}
                            </td>
                            <td>{payment.chargedUsdc ?? payment.amountUsdc}</td>
                            <td>
                              {payment.txHash && payment.explorerUrl ? (
                                <a
                                  href={payment.explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mono"
                                  aria-label={`View transaction ${payment.txHash} on Basescan`}
                                >
                                  {payment.txHash.slice(0, 10)}… ↗
                                </a>
                              ) : (
                                <span className="faint">No on-chain receipt</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {section === "team" && (
          <>
            {session.mode === "session" && actorRole === "owner" && (
              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>Email invitations</h2>
                    <div className="sub">
                      Invite someone to join this organization with their own account.
                    </div>
                  </div>
                </div>
                <div className="row settings-inline-form" style={{ flexWrap: "wrap" }}>
                  <input
                    type="email"
                    autoComplete="email"
                    aria-label="Invitee email address"
                    placeholder="name@company.com"
                    value={accountInviteEmail}
                    disabled={busy}
                    onChange={(event) => setAccountInviteEmail(event.target.value)}
                  />
                  <select
                    aria-label="Invitation role"
                    value={inviteRole}
                    disabled={busy}
                    onChange={(event) => setInviteRole(event.target.value as "approver" | "viewer")}
                  >
                    <option value="approver">Approver</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <Button
                    size="sm"
                    disabled={busy || !accountInviteEmail.includes("@")}
                    onClick={() => void inviteAccountMember()}
                  >
                    <Icon name="plus" size={12} /> Send invitation
                  </Button>
                </div>
                {revealedInviteToken && (
                  <div className="code" style={{ marginTop: 12 }}>
                    Email was unavailable. Copy this invitation token and send it through a secure
                    channel:
                    <div style={{ marginTop: 6, overflowWrap: "anywhere" }}>
                      {revealedInviteToken}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      style={{ marginTop: 8 }}
                      onClick={() => setRevealedInviteToken(null)}
                    >
                      I saved it
                    </Button>
                  </div>
                )}
                <div style={{ marginTop: 14 }}>
                  {accountInvitations.length ? (
                    accountInvitations.map((invitation) => {
                      const expired = new Date(invitation.expiresAt).getTime() <= Date.now();
                      return (
                        <div className="kv" key={invitation.id}>
                          <span className="k">
                            {invitation.email} · {invitation.role}
                          </span>
                          <span className="v">
                            {expired ? "expired" : "pending"} · expires{" "}
                            {new Date(invitation.expiresAt).toLocaleDateString()}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <p className="faint" style={{ fontSize: 11.5 }}>
                      No pending account invitations.
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Approval quorum</h2>
                  <div className="sub">
                    How many different guardians must approve before a parked payment executes. A
                    denial from any one of them stops it immediately.
                  </div>
                </div>
              </div>
              <div className="row settings-quorum">
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
                  {guardians.filter((g) => !g.revokedAt && g.role !== "viewer").length + 1} seats in
                  use (owner + approvers)
                </span>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Guardians</h2>
                  <div className="sub">
                    Anyone with a guardian key can approve spending for this org.
                  </div>
                </div>
                <div className="row settings-inline-form settings-head-form">
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
                  <Button
                    size="sm"
                    disabled={busy || readOnly || !newGuardian.trim()}
                    onClick={() => void addGuardian()}
                  >
                    <Icon name="plus" size={12} /> Invite
                  </Button>
                </div>
              </div>
              {revealedKey && (
                <div className="code" style={{ marginBottom: 12 }}>
                  Guardian key (shown once):
                  <div style={{ marginTop: 6, color: "var(--accent)" }}>{revealedKey}</div>
                  <Button
                    variant="ghost"
                    size="sm"
                    style={{ marginTop: 8 }}
                    onClick={() => setRevealedKey(null)}
                  >
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
                      <Button
                        variant="bare"
                        size="sm"
                        disabled={busy || readOnly}
                        onClick={() => void revoke(g.id)}
                      >
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

        {section === "security" && (
          <>
            <section className="wallet-recovery-section">
              <h2>Security and recovery</h2>
              <p>
                Manage vault and agent key recovery. Review the consequences before confirming a
                rotation.
              </p>
              <TreasuryView
                embedded
                initialTab="recovery"
                gFetch={gFetch}
                act={act}
                busy={busy}
                readOnly={actorRole !== "owner"}
              />
            </section>
            {session.mode === "session" && (
              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>Signed-in sessions</h2>
                    <div className="sub">
                      Review active account sessions and revoke any you no longer recognize.
                    </div>
                  </div>
                </div>
                {userSessions.map((activeSession) => (
                  <div className="kv" key={activeSession.id}>
                    <span className="k">
                      {activeSession.current
                        ? "This session"
                        : activeSession.userAgent || "Browser session"}
                      <small style={{ display: "block" }}>
                        Expires {new Date(activeSession.expiresAt).toLocaleString()}
                      </small>
                    </span>
                    <span className="v">
                      {activeSession.current ? (
                        "Current"
                      ) : (
                        <Button
                          variant="bare"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void act("Revoke session", async () => {
                              const response = await gFetch(
                                `/v1/auth/sessions/${encodeURIComponent(activeSession.id)}`,
                                { method: "DELETE" },
                              );
                              if (!response.ok)
                                throw new Error(
                                  (await response.json()).error?.message ??
                                    "Could not revoke session",
                                );
                              await loadUserSessions();
                              return "Session revoked.";
                            })
                          }
                        >
                          Revoke
                        </Button>
                      )}
                    </span>
                  </div>
                ))}
                {!userSessions.length && (
                  <p className="faint" style={{ fontSize: 11.5 }}>
                    No active account sessions found.
                  </p>
                )}
              </div>
            )}
            <MfaPanel
              gFetch={gFetch}
              act={act}
              locked={busy || actorRole === "viewer"}
              isSessionUser={session.mode === "session"}
            />
            <div className="card settings-credential-card">
              <div className="card-head">
                <div>
                  <h2>Guardian credential</h2>
                  <div className="sub">
                    Authenticates this console and can approve spending or change organization
                    controls.
                  </div>
                </div>
              </div>
              <div className="field">
                <label htmlFor="guardian-key">Key for this browser</label>
                <div className="settings-secret-row">
                  <code id="guardian-key" className="code" aria-live="polite">
                    {showGuardianKey ? session.guardianKey : "••••••••••••••••••••••••••••••••"}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-pressed={showGuardianKey}
                    onClick={() => setShowGuardianKey((visible) => !visible)}
                  >
                    {showGuardianKey ? "Hide" : "Reveal"}
                  </Button>
                </div>
                <div className="hint">
                  Stored in this browser session. Keep it private; anyone who has it can act as an
                  owner.
                </div>
              </div>
              <div className="settings-security-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void navigator.clipboard.writeText(session.guardianKey).then(
                      () => act("Copy guardian key", async () => "Guardian key copied."),
                      () =>
                        act("Copy guardian key", async () => {
                          throw new Error(
                            "Clipboard blocked — reveal the key and copy it manually.",
                          );
                        }),
                    )
                  }
                >
                  Copy key
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const when = new Date().toISOString();
                    const agents = session.agentKeys
                      .map((a) => `### ${a.name}\n\n\`${a.key}\`\n\nAgent id: \`${a.agentId}\``)
                      .join("\n\n");
                    const md = `# Artificial Banking — key backup

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
                    a.download = `abi-key-backup-${when.slice(0, 10)}.md`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    void act("Download key backup", async () => "Key backup downloaded.");
                  }}
                >
                  Download key backup
                </Button>
              </div>
            </div>
          </>
        )}

        {section === "compliance" && (
          <CompliancePanel gFetch={gFetch} act={act} canEdit={actorRole === "owner"} />
        )}
      </section>
    </div>
  );
}
