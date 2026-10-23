"use client";

/**
 * Account access: sign out (this device or everywhere), change password, and
 * send a password-reset email — for the signed-in account user only.
 *
 * Passwords are stored as salted hashes. Nothing here can read, return or
 * reveal the stored password; the Show/Hide toggles only unmask what is being
 * typed into these fields.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  disabled: boolean;
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
  onSignedOut,
}: {
  gFetch: Fetcher;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  locked: boolean;
  /** Guardian-key sessions have no user account: nothing here applies. */
  isSessionUser: boolean;
  /** Clear client state after the server session is revoked. */
  onSignedOut?: () => void;
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

  if (!isSessionUser) return null;

  const signOut = (everywhere: boolean) =>
    act(everywhere ? "Log out everywhere" : "Log out", async () => {
      const res = await gFetch(everywhere ? "/v1/auth/logout-all" : "/v1/auth/logout", {
        method: "POST",
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not sign out"));
      onSignedOut?.();
      return everywhere ? "Signed out on every device." : "Signed out.";
    });

  const mismatch = confirm.length > 0 && next !== confirm;
  const canChange = !!current && !!next && next === confirm && !locked;

  const changePassword = () =>
    act("Change password", async () => {
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
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Account access</h2>
          <div className="sub">
            Sign out, change your password, or email yourself a reset link
            {email ? ` (${email})` : ""}.
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Button type="button" size="sm" disabled={locked} onClick={() => void signOut(false)}>
          Log out
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={locked}
          onClick={() => {
            if (window.confirm("Sign out of every device and browser, including this one?")) {
              void signOut(true);
            }
          }}
        >
          Log out everywhere
        </Button>
      </div>

      <form
        style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16, maxWidth: 420 }}
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
        />
        <PasswordField
          label="New password"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          disabled={locked}
        />
        <PasswordField
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          disabled={locked}
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
          Changing your password signs out every other session.
        </p>
      </form>

      <div style={{ marginTop: 16 }}>
        <b style={{ fontSize: 13, display: "block", marginBottom: 4 }}>Forgot it?</b>
        <p className="faint" style={{ fontSize: 11.5, margin: "0 0 8px" }}>
          We email a single-use reset link to your account address. It expires in an hour.
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={locked || !email}
          onClick={() => void sendReset()}
        >
          Send password reset email
        </Button>
      </div>
    </div>
  );
}
