"use client";

/**
 * Account access, shown in Settings → Organization profile: sign out (this
 * device or everywhere) and change password.
 *
 * Changing the password needs the current password, which the API verifies
 * server-side. "Forgot your current password?" lives only inside the change
 * form and sends the existing single-use reset email. (The sign-in screen
 * keeps its own forgot link for signed-out users.)
 *
 * Passwords are stored as salted hashes. Nothing here can read, return or
 * reveal the stored password; the Show/Hide toggles only unmask what is being
 * typed into these fields.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PASSWORD_RULES_HINT } from "./password-rules";

type Fetcher = (p: string, i?: RequestInit) => Promise<Response>;

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } };
    return j.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  disabled,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  disabled: boolean;
  required?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
      {label}
      <span className="row" style={{ gap: 6 }}>
        <input
          className="input sm"
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          disabled={disabled}
          required={required}
          data-shortcut-ignore
          style={{ flex: 1 }}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button
          type="button"
          variant="bare"
          size="sm"
          aria-pressed={shown}
          aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          onClick={() => setShown((v) => !v)}
        >
          {shown ? "Hide" : "Show"}
        </Button>
      </span>
    </label>
  );
}

export function AccountAccessPanel({
  gFetch,
  act,
  locked,
  isSessionUser,
  onSignOut,
}: {
  gFetch: Fetcher;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  locked: boolean;
  /** Guardian-key sessions have no user account: only Log out applies. */
  isSessionUser: boolean;
  /** Shared sign-out (lib/sign-out.ts): revokes, clears, redirects. */
  onSignOut: (everywhere: boolean) => void;
}) {
  const [email, setEmail] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (!isSessionUser) return;
    void (async () => {
      try {
        const res = await gFetch("/v1/auth/me");
        if (res.ok)
          setEmail(((await res.json()) as { user?: { email?: string } }).user?.email ?? null);
      } catch {
        /* the rest of the panel still works */
      }
    })();
  }, [gFetch, isSessionUser]);

  const mismatch = confirm.length > 0 && next !== confirm;
  const canChange = !!current && !!next && next === confirm && !locked;

  const changePassword = () =>
    act("Change password", async () => {
      if (!current) throw new Error("Enter your current password.");
      if (next !== confirm) throw new Error("New password and confirmation differ.");
      const res = await gFetch("/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: current,
          newPassword: next,
          confirmPassword: confirm,
        }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not change password"));
      setCurrent("");
      setNext("");
      setConfirm("");
      return "Password changed. Every other session was signed out.";
    });

  const sendReset = () =>
    act("Send reset email", async () => {
      if (!email) throw new Error("Could not load your account email.");
      const res = await gFetch("/v1/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not send the reset email"));
      return `A reset link is on its way to ${email}. It works once and expires in an hour.`;
    });

  return (
    <div className="card" data-testid="account-access">
      <div className="card-head">
        <div>
          <h2>Account access</h2>
          <div className="sub">
            {isSessionUser
              ? `Sign out or change your password${email ? ` (${email})` : ""}.`
              : "This browser signed in with a guardian key. Log out removes it from this browser."}
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Button type="button" size="sm" disabled={locked} onClick={() => onSignOut(false)}>
          Log out
        </Button>
        {isSessionUser ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={locked}
            onClick={() => {
              if (window.confirm("Sign out of every device and browser, including this one?")) {
                onSignOut(true);
              }
            }}
          >
            Log out everywhere
          </Button>
        ) : null}
      </div>

      {isSessionUser ? (
        <form
          aria-label="Change password"
          className="settings-password-form"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginTop: 16,
            maxWidth: 420,
          }}
          onSubmit={(e) => {
            e.preventDefault();
            if (canChange) void changePassword();
          }}
        >
          <b style={{ fontSize: 13 }}>Change password</b>
          <PasswordField
            label="Current password"
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
            disabled={locked}
            required
          />
          <p className="faint" style={{ fontSize: 11.5, margin: "-4px 0 0" }}>
            <button
              type="button"
              className="link-btn"
              disabled={locked || !email}
              onClick={() => void sendReset()}
              style={{
                background: "none",
                border: 0,
                padding: 0,
                font: "inherit",
                color: "var(--accent, inherit)",
                textDecoration: "underline",
                cursor: locked || !email ? "default" : "pointer",
              }}
            >
              Forgot your current password?
            </button>{" "}
            We email a single-use reset link to your account address. It expires in an hour.
          </p>
          <PasswordField
            label="New password"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            disabled={locked}
            required
          />
          <PasswordField
            label="Confirm new password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            disabled={locked}
            required
          />
          {mismatch ? (
            <span className="faint" style={{ fontSize: 11.5, color: "var(--warn)" }}>
              The confirmation does not match.
            </span>
          ) : null}
          <div className="row" style={{ gap: 8 }}>
            <Button type="submit" size="sm" disabled={!canChange}>
              Change password
            </Button>
          </div>
          <p className="faint" style={{ fontSize: 11.5, margin: 0 }}>
            {PASSWORD_RULES_HINT} Changing your password signs out every other session.
          </p>
        </form>
      ) : null}
    </div>
  );
}
