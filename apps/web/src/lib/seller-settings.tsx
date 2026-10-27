"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { sellerApiError, sellerApiFetch as apiFetch } from "./seller-api";
import { Card, Empty, Pill, fmtDate, formGrid, rowStyle } from "./seller-features";
import { toast } from "./toast";

export type SellerProfile = {
  displayName: string;
  payoutAddress: string;
  network: string;
  status: "draft" | "ready";
  website: string;
  description: string;
  supportEmail?: string;
};

type Session = {
  id: string;
  createdAt: string;
  expiresAt: string;
  userAgent?: string;
  ip?: string;
  current: boolean;
};

type Account = {
  partner: {
    id: string;
    email: string;
    name: string;
    createdAt: string;
    lastLoginAt: string | null;
    passwordChangedAt: string | null;
    mfaEnabled: boolean;
  };
  org: { id: string; name: string };
  security: { mfaEnabled: boolean; recoveryCodesLeft: number; sessions: Session[] };
};

type PayoutChange = {
  id: string;
  oldAddress: string | null;
  newAddress: string | null;
  changedBy: string;
  createdAt: string;
};

const TABS = [
  { key: "company", label: "Company" },
  { key: "payout", label: "Payout" },
  { key: "account", label: "Account" },
  { key: "security", label: "Security" },
  { key: "danger", label: "Close account" },
] as const;

type Tab = (typeof TABS)[number]["key"];

export function SellerSettingsView({
  profile,
  onProfileSaved,
  onSignedOut,
}: {
  profile: SellerProfile | null;
  onProfileSaved: (profile: SellerProfile) => void;
  onSignedOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>("company");
  const [account, setAccount] = useState<Account | null>(null);

  const loadAccount = useCallback(async () => {
    const res = await apiFetch("/v1/partner/account").catch(() => null);
    if (res?.ok) setAccount((await res.json()) as Account);
  }, []);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 760 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="tablist">
        {TABS.map((t) => (
          <Button
            key={t.key}
            size="sm"
            role="tab"
            aria-selected={tab === t.key}
            variant={tab === t.key ? "default" : "secondary"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </Button>
        ))}
      </div>
      {tab === "company" && profile && <CompanyTab profile={profile} onSaved={onProfileSaved} />}
      {tab === "payout" && profile && (
        <PayoutTab
          profile={profile}
          mfaEnabled={Boolean(account?.security.mfaEnabled)}
          onSaved={onProfileSaved}
        />
      )}
      {tab === "account" && account && <AccountTab account={account} onSaved={loadAccount} />}
      {tab === "security" && account && (
        <SecurityTab account={account} reload={loadAccount} onSignedOut={onSignedOut} />
      )}
      {tab === "danger" && account && <CloseTab account={account} onClosed={onSignedOut} />}
    </div>
  );
}

async function saveProfile(patch: Record<string, unknown>): Promise<SellerProfile | null> {
  const res = await apiFetch("/v1/seller/profile", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    toast(await sellerApiError(res, "Could not save"), "err");
    return null;
  }
  return ((await res.json()) as { profile: SellerProfile }).profile;
}

function CompanyTab({
  profile,
  onSaved,
}: {
  profile: SellerProfile;
  onSaved: (p: SellerProfile) => void;
}) {
  const [draft, setDraft] = useState({
    displayName: profile.displayName,
    website: profile.website,
    supportEmail: profile.supportEmail ?? "",
    description: profile.description,
  });
  const [busy, setBusy] = useState(false);

  return (
    <Card title="Company profile">
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Buyers see this next to your offers in the directory.
      </p>
      <div style={formGrid}>
        <label className="field">
          <span>Display name</span>
          <input
            value={draft.displayName}
            onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Website</span>
          <input
            value={draft.website}
            placeholder="https://"
            onChange={(e) => setDraft({ ...draft, website: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Support email</span>
          <input
            type="email"
            value={draft.supportEmail}
            placeholder="support@yourcompany.com"
            onChange={(e) => setDraft({ ...draft, supportEmail: e.target.value })}
          />
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>Description</span>
          <textarea
            rows={3}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
      </div>
      <Button
        style={{ marginTop: 12 }}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const saved = await saveProfile(draft);
            if (saved) {
              onSaved(saved);
              toast("Company profile saved", "ok");
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Saving…" : "Save"}
      </Button>
    </Card>
  );
}

/** One box takes either a 6-digit authenticator code or a recovery code. */
function secondFactorBody(value: string): { code?: string; recoveryCode?: string } {
  const v = value.trim();
  if (!v) return {};
  return /^\d{6}$/.test(v) ? { code: v } : { recoveryCode: v };
}

function PayoutTab({
  profile,
  mfaEnabled,
  onSaved,
}: {
  profile: SellerProfile;
  mfaEnabled: boolean;
  onSaved: (p: SellerProfile) => void;
}) {
  const [address, setAddress] = useState(profile.payoutAddress);
  const [network, setNetwork] = useState(profile.network);
  const [password, setPassword] = useState("");
  const [factor, setFactor] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<PayoutChange[]>([]);
  const changingExisting =
    Boolean(profile.payoutAddress) &&
    address.trim().toLowerCase() !== profile.payoutAddress.toLowerCase();

  const loadHistory = useCallback(async () => {
    const res = await apiFetch("/v1/seller/profile/payout-history").catch(() => null);
    if (res?.ok) setHistory(((await res.json()) as { changes: PayoutChange[] }).changes);
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  return (
    <>
      <Card title="Payout wallet">
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Every paid call settles USDC on-chain straight to this address. ABI never holds seller
          funds. Use a wallet you control; changing it asks for your password (and your
          authenticator code when two-factor is on), emails you, and asks connected buyers to
          confirm the new address before they pay again.
        </p>
        <div style={formGrid}>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>Address</span>
            <input
              value={address}
              placeholder="0x…"
              spellCheck={false}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Default network for new offers</span>
            <select value={network} onChange={(e) => setNetwork(e.target.value)}>
              <option value="base-sepolia">Base Sepolia (test USDC)</option>
              <option value="base">Base (real USDC)</option>
            </select>
          </label>
          {changingExisting && (
            <label className="field">
              <span>Current password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          {changingExisting && mfaEnabled && (
            <label className="field">
              <span>Authenticator or recovery code</span>
              <input
                inputMode="text"
                autoComplete="one-time-code"
                value={factor}
                onChange={(e) => setFactor(e.target.value)}
              />
            </label>
          )}
        </div>
        <Button
          style={{ marginTop: 12 }}
          disabled={busy || (changingExisting && (!password || (mfaEnabled && !factor.trim())))}
          onClick={async () => {
            setBusy(true);
            try {
              const saved = await saveProfile({
                payoutAddress: address.trim(),
                network,
                ...(changingExisting
                  ? { currentPassword: password, ...secondFactorBody(factor) }
                  : {}),
              });
              if (saved) {
                onSaved(saved);
                setPassword("");
                setFactor("");
                toast("Payout settings saved", "ok");
                await loadHistory();
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save payout settings"}
        </Button>
      </Card>
      <Card title="Change history">
        {history.length === 0 ? (
          <Empty>No changes recorded.</Empty>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {history.map((h) => (
              <li key={h.id} style={{ ...rowStyle, display: "block" }}>
                <div style={{ fontSize: 12.5, wordBreak: "break-all" }}>
                  {h.oldAddress ?? "(none)"} → <b>{h.newAddress ?? "(none)"}</b>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {fmtDate(h.createdAt)} by {h.changedBy}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function AccountTab({ account, onSaved }: { account: Account; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(account.partner.name);
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Your account">
      <div style={formGrid}>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Email</span>
          <input value={account.partner.email} disabled />
        </label>
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>
        Company {account.org.name} · member since {fmtDate(account.partner.createdAt)} · last sign
        in {fmtDate(account.partner.lastLoginAt)}
      </p>
      <Button
        disabled={busy || !name.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await apiFetch("/v1/partner/account", {
              method: "PATCH",
              body: JSON.stringify({ name }),
            });
            if (!res.ok) {
              toast(await sellerApiError(res, "Could not save"), "err");
              return;
            }
            toast("Saved", "ok");
            await onSaved();
          } finally {
            setBusy(false);
          }
        }}
      >
        Save
      </Button>
    </Card>
  );
}

function SecurityTab({
  account,
  reload,
  onSignedOut,
}: {
  account: Account;
  reload: () => Promise<void>;
  onSignedOut: () => void;
}) {
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [enrolling, setEnrolling] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disablePw, setDisablePw] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title="Password">
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Last changed {fmtDate(account.partner.passwordChangedAt ?? account.partner.createdAt)}.
          Changing it signs out every other session.
        </p>
        <div style={formGrid}>
          <label className="field">
            <span>Current password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={pw.currentPassword}
              onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
            />
          </label>
          <label className="field">
            <span>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={pw.newPassword}
              onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
            />
          </label>
        </div>
        <Button
          style={{ marginTop: 12 }}
          disabled={busy || !pw.currentPassword || !pw.newPassword}
          onClick={() =>
            run(async () => {
              const res = await apiFetch("/v1/partner/auth/change-password", {
                method: "POST",
                body: JSON.stringify(pw),
              });
              if (!res.ok) {
                toast(await sellerApiError(res, "Could not change password"), "err");
                return;
              }
              setPw({ currentPassword: "", newPassword: "" });
              toast("Password changed. Other sessions were signed out.", "ok");
              await reload();
            })
          }
        >
          Change password
        </Button>
      </Card>

      <Card
        title="Two-factor authentication"
        actions={
          <Pill tone={account.security.mfaEnabled ? "ok" : "warn"}>
            {account.security.mfaEnabled ? "authenticator app" : "password only"}
          </Pill>
        }
      >
        {recoveryCodes && (
          <div style={{ marginBottom: 14 }}>
            <b style={{ fontSize: 13 }}>Recovery codes, shown once</b>
            <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 8px" }}>
              Each works a single time if you lose your authenticator. Store them outside this
              browser.
            </p>
            <div
              className="mono"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 6,
                fontSize: 12.5,
              }}
            >
              {recoveryCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void navigator.clipboard.writeText(recoveryCodes.join("\n"))}
              >
                Copy all
              </Button>
              <Button size="sm" onClick={() => setRecoveryCodes(null)}>
                I have saved them
              </Button>
            </div>
          </div>
        )}
        {enrolling ? (
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <b style={{ fontSize: 12.5 }}>1. Add this key to your authenticator app</b>
              <div className="mono" style={{ marginTop: 6, fontSize: 13, wordBreak: "break-all" }}>
                {enrolling.secret}
              </div>
              <a href={enrolling.otpauthUri} style={{ fontSize: 12 }}>
                Open in an authenticator app
              </a>
            </div>
            <label className="field">
              <span>2. Enter the six-digit code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                size="sm"
                disabled={busy || !code.trim()}
                onClick={() =>
                  run(async () => {
                    const res = await apiFetch("/v1/partner/auth/mfa/confirm", {
                      method: "POST",
                      body: JSON.stringify({ code: code.trim() }),
                    });
                    if (!res.ok) {
                      toast(await sellerApiError(res, "That code is not valid"), "err");
                      return;
                    }
                    const body = (await res.json()) as { recoveryCodes: string[] };
                    setEnrolling(null);
                    setCode("");
                    setRecoveryCodes(body.recoveryCodes);
                    toast("Two-factor authentication is on", "ok");
                    await reload();
                  })
                }
              >
                Turn on
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEnrolling(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : account.security.mfaEnabled ? (
          <div style={{ display: "grid", gap: 8 }}>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {account.security.recoveryCodesLeft} recovery codes left.
            </span>
            <details>
              <summary style={{ fontSize: 12.5, cursor: "pointer" }}>Turn it off</summary>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <input
                  type="password"
                  placeholder="Your password"
                  autoComplete="current-password"
                  value={disablePw}
                  onChange={(e) => setDisablePw(e.target.value)}
                />
                <input
                  placeholder="Authenticator or recovery code"
                  autoComplete="one-time-code"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy || !disablePw || !disableCode.trim()}
                  onClick={() =>
                    run(async () => {
                      const res = await apiFetch("/v1/partner/auth/mfa/disable", {
                        method: "POST",
                        body: JSON.stringify({
                          password: disablePw,
                          ...secondFactorBody(disableCode),
                        }),
                      });
                      if (!res.ok) {
                        toast(await sellerApiError(res, "Password or code is incorrect"), "err");
                        return;
                      }
                      setDisablePw("");
                      setDisableCode("");
                      toast("Two-factor authentication is off", "ok");
                      await reload();
                    })
                  }
                >
                  Turn off two-factor
                </Button>
              </div>
            </details>
          </div>
        ) : (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const res = await apiFetch("/v1/partner/auth/mfa/enroll", {
                  method: "POST",
                  body: "{}",
                });
                if (!res.ok) {
                  toast(await sellerApiError(res, "Could not start"), "err");
                  return;
                }
                setEnrolling((await res.json()) as { secret: string; otpauthUri: string });
              })
            }
          >
            Set up authenticator app
          </Button>
        )}
      </Card>

      <Card
        title="Signed-in sessions"
        actions={
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (!window.confirm("Sign out of every session, including this one?")) return;
                await apiFetch("/v1/partner/auth/logout-all", { method: "POST", body: "{}" });
                onSignedOut();
              })
            }
          >
            Sign out everywhere
          </Button>
        }
      >
        {account.security.sessions.length === 0 ? (
          <Empty>No active sessions.</Empty>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {account.security.sessions.map((s) => (
              <li key={s.id} style={rowStyle}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13 }}>
                    {s.userAgent ? s.userAgent.slice(0, 80) : "Unknown device"}{" "}
                    {s.current && <Pill tone="ok">this device</Pill>}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {s.ip ?? "unknown IP"} · signed in {fmtDate(s.createdAt)} · expires{" "}
                    {fmtDate(s.expiresAt)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const res = await apiFetch(`/v1/partner/auth/sessions/${s.id}`, {
                        method: "DELETE",
                      });
                      if (!res.ok) {
                        toast(await sellerApiError(res, "Could not revoke"), "err");
                        return;
                      }
                      if (s.current) {
                        onSignedOut();
                        return;
                      }
                      toast("Session revoked", "ok");
                      await reload();
                    })
                  }
                >
                  {s.current ? "Sign out" : "Revoke"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function CloseTab({ account, onClosed }: { account: Account; onClosed: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Close seller account">
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Every offer goes off sale and you are signed out. Past settlements and statements are kept
        for your records and the buyers who paid you.
      </p>
      <div style={formGrid}>
        <label className="field">
          <span>Type {account.org.name} to confirm</span>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      </div>
      <Button
        style={{ marginTop: 12 }}
        variant="destructive"
        disabled={busy || confirm !== account.org.name || !password}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await apiFetch("/v1/partner/account/close", {
              method: "POST",
              body: JSON.stringify({ confirm, password }),
            });
            if (!res.ok) {
              toast(await sellerApiError(res, "Could not close the account"), "err");
              return;
            }
            toast("Account closed", "ok");
            onClosed();
          } finally {
            setBusy(false);
          }
        }}
      >
        Close account
      </Button>
    </Card>
  );
}
