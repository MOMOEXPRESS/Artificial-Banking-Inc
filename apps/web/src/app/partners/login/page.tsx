"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ABLockup } from "../../../lib/brand";
import { browserApiBase } from "../../../lib/browser-api";
import { PASSWORD_RULES_HINT, newPasswordProblem } from "../../../lib/password-rules";
import { Icon } from "../../../lib/ui";

const API = browserApiBase();

type Mode = "signin" | "signup";

async function post(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return { ok: res.ok, error: json?.error?.message };
}

export default function PartnerLoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [payoutAddress, setPayoutAddress] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "signup") setMode("signup");
    void fetch(`${API}/v1/partner/auth/me`, { credentials: "include", cache: "no-store" })
      .then((r) => {
        if (r.ok) window.location.replace("/seller");
      })
      .catch(() => undefined);
  }, []);

  async function submit() {
    setError(null);
    if (mode === "signup") {
      const pw = newPasswordProblem(password, password);
      if (pw) return setError(pw);
    }
    setBusy(true);
    try {
      const result =
        mode === "signin"
          ? await post("/v1/partner/auth/login", { email: email.trim(), password })
          : await post("/v1/partner/auth/signup", {
              email: email.trim(),
              password,
              name: name.trim(),
              companyName: companyName.trim(),
              website: website.trim(),
              description: description.trim(),
              payoutAddress: payoutAddress.trim(),
            });
      if (!result.ok) {
        setError(result.error ?? (mode === "signin" ? "Could not sign in" : "Could not sign up"));
        return;
      }
      window.location.assign("/seller");
    } catch {
      setError("Could not reach the ABI API.");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    mode === "signin"
      ? Boolean(email.trim() && password)
      : Boolean(email.trim() && password && name.trim() && companyName.trim());

  return (
    <div className="login-wrap is-ready">
      <Link href="/partnerships" className="login-back">
        <Icon name="arrowLeft" size={14} />
        Back to Partnerships
      </Link>

      <div className="login-reveal">
        <div className="login-brand-beat">
          <ABLockup size={160} tone="#fff" />
        </div>

        <form
          className="login-card"
          data-testid="partner-login"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit && !busy) void submit();
          }}
        >
          <p className="eyebrow" style={{ margin: "0 0 6px" }}>
            Partner portal
          </p>
          <p className="login-sub">
            Sell to AI agents on your own site. Partner accounts are separate from the buyer
            console — sign up here and we create your seller organization for you.
          </p>

          <div className="login-mode-row" role="tablist" aria-label="Partner access">
            {(
              [
                ["signin", "Sign in"],
                ["signup", "Become a partner"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                className={`login-mode-btn ${mode === id ? "on" : ""}`}
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setMode(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "signup" && (
            <>
              <div className="field">
                <label htmlFor="p-name">Your name</label>
                <input
                  id="p-name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="p-company">Company</label>
                <input
                  id="p-company"
                  autoComplete="organization"
                  placeholder="Acme Data"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="field">
            <label htmlFor="p-email">Work email</label>
            <input
              id="p-email"
              type="email"
              autoComplete="username"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="p-password">Password</label>
            <input
              id="p-password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === "signup" && (
              <p className="faint" style={{ fontSize: 11.5, margin: "6px 0 0" }}>
                {PASSWORD_RULES_HINT}
              </p>
            )}
          </div>

          {mode === "signup" && (
            <>
              <div className="field">
                <label htmlFor="p-website">Website (optional)</label>
                <input
                  id="p-website"
                  type="url"
                  placeholder="https://yoursite.com"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="p-description">What you sell (optional)</label>
                <input
                  id="p-description"
                  placeholder="Market data reports"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="p-payout">Payout wallet (optional)</label>
                <input
                  id="p-payout"
                  placeholder="0x… (you can add this later)"
                  spellCheck={false}
                  value={payoutAddress}
                  onChange={(e) => setPayoutAddress(e.target.value)}
                />
              </div>
            </>
          )}

          {error && (
            <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, margin: "4px 0 10px" }}>
              {error}
            </p>
          )}

          <button type="submit" style={{ width: "100%" }} disabled={busy || !canSubmit}>
            {busy
              ? mode === "signin"
                ? "Signing in…"
                : "Creating your seller org…"
              : mode === "signin"
                ? "Sign in to seller console"
                : "Create partner account"}
          </button>

          <p className="faint" style={{ fontSize: 11.5, marginTop: 14, lineHeight: 1.55 }}>
            Looking to give your agents a wallet instead?{" "}
            <Link href="/console">Buyer console</Link> uses a separate account.
          </p>
        </form>
      </div>
    </div>
  );
}
