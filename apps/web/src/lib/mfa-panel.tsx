"use client";

/**
 * Two-factor enrolment and step-up status (audit finding NEW-1).
 *
 * The whole Phase 3 second-factor API — enrol, confirm, disable, recovery
 * codes, step-up status — shipped with no console at all. An operator could
 * neither turn MFA on nor find out that a $100 approval was about to demand it.
 *
 * Recovery codes are shown exactly once, by design on the server. This panel
 * treats that seriously: they stay on screen until explicitly dismissed, and
 * the dismissal says what is being given up.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "./ui";

type MfaStatus = {
  enabled: boolean;
  pending: boolean;
  recoveryCodesRemaining: number;
  stepUp: { thresholdUsdc: string; ttlMinutes: number; active: boolean };
};

export function MfaPanel({
  gFetch,
  act,
  locked,
  isSessionUser,
}: {
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  locked: boolean;
  /** Bearer-key sessions have no user account, so none of this applies. */
  isSessionUser: boolean;
}) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [enrolling, setEnrolling] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await gFetch("/v1/auth/mfa");
      if (res.ok) setStatus(await res.json());
    } finally {
      setLoaded(true);
    }
  }, [gFetch]);

  useEffect(() => {
    if (isSessionUser) void load();
    else setLoaded(true);
  }, [isSessionUser, load]);

  if (!loaded) return null;

  if (!isSessionUser) {
    return (
      <div className="card">
        <div className="card-head">
          <div>
            <h2 style={{ margin: 0 }}>Two-factor authentication</h2>
            <div className="sub">
              This console is signed in with a bearer guardian key, which belongs to a machine
              rather than a person. Sign in with an account to enrol a second factor.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const start = () =>
    act("Start MFA enrolment", async () => {
      const res = await gFetch("/v1/auth/mfa/enroll", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "Could not start enrolment");
      setEnrolling({ secret: d.secret, otpauthUri: d.otpauthUri });
      return "Add the key to your authenticator app, then confirm with a code.";
    });

  const confirm = () =>
    act("Confirm MFA", async () => {
      const res = await gFetch("/v1/auth/mfa/confirm", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "That code is not valid");
      setEnrolling(null);
      setCode("");
      setRecoveryCodes(d.recoveryCodes ?? []);
      await load();
      return "Two-factor authentication is on.";
    });

  const disable = () =>
    act("Disable MFA", async () => {
      const res = await gFetch("/v1/auth/mfa/disable", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "Password is incorrect");
      setPassword("");
      await load();
      return "Two-factor authentication is off. High-value approvals now ask for your password.";
    });

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2 style={{ margin: 0 }}>Two-factor authentication</h2>
          <div className="sub">
            Approvals of{" "}
            <b>${status?.stepUp.thresholdUsdc ?? "100"}</b> or more ask you to re-confirm your
            identity, so an open tab is never enough on its own to move money.
          </div>
        </div>
        <span className={`pill ${status?.enabled ? "ok" : "warn"}`}>
          <i /> {status?.enabled ? "authenticator app" : "password only"}
        </span>
      </div>

      {status && !status.enabled && (
        <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 0 }}>
          Without a second factor, a high-value approval falls back to your password. That works,
          but anyone who has your password has your treasury.
        </p>
      )}

      {recoveryCodes && (
        <div
          style={{
            padding: "14px 16px",
            borderRadius: 10,
            background: "var(--surface-3)",
            border: "1px solid var(--border)",
            marginBottom: 14,
          }}
        >
          <b style={{ fontSize: 13 }}>Recovery codes — shown once</b>
          <p className="faint" style={{ fontSize: 12, margin: "6px 0 10px", lineHeight: 1.55 }}>
            Each works a single time, and they are the only way back in if you lose your
            authenticator. Store them somewhere that is not this browser.
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
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void navigator.clipboard.writeText(recoveryCodes.join("\n"))}
            >
              Copy all
            </Button>
            <Button type="button" size="sm" onClick={() => setRecoveryCodes(null)}>
              I have saved them
            </Button>
          </div>
        </div>
      )}

      {enrolling ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <b style={{ fontSize: 12.5 }}>1. Add this key to your authenticator app</b>
            <div
              className="mono"
              style={{
                marginTop: 6,
                padding: "10px 12px",
                borderRadius: 8,
                background: "var(--surface-3)",
                border: "1px solid var(--border)",
                fontSize: 13,
                wordBreak: "break-all",
              }}
            >
              {enrolling.secret}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void navigator.clipboard.writeText(enrolling.secret)}
              >
                Copy key
              </Button>
              <a href={enrolling.otpauthUri} style={{ fontSize: 12 }}>
                Open in an authenticator app
              </a>
            </div>
          </div>
          <label style={{ fontSize: 12 }}>
            2. Enter the six-digit code it shows
            <input
              className="input sm"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              disabled={locked}
              data-shortcut-ignore
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <div className="row" style={{ gap: 8 }}>
            <Button type="button" size="sm" disabled={locked || !code.trim()} onClick={() => void confirm()}>
              Turn on
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={locked}
              onClick={() => {
                setEnrolling(null);
                setCode("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : status?.enabled ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="faint" style={{ fontSize: 12.5 }}>
            {status.recoveryCodesRemaining} recovery code
            {status.recoveryCodesRemaining === 1 ? "" : "s"} left.
            {status.stepUp.active
              ? ` Step-up is active for the next ${status.stepUp.ttlMinutes} minutes.`
              : ""}
          </div>
          <details>
            <summary style={{ fontSize: 12.5, cursor: "pointer" }}>Turn it off</summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              <p className="faint" style={{ fontSize: 12, margin: 0, lineHeight: 1.55 }}>
                Removing a second factor is what someone with a stolen session would try first, so
                this asks for your password.
              </p>
              <input
                className="input sm"
                type="password"
                autoComplete="current-password"
                placeholder="Your password"
                value={password}
                disabled={locked}
                data-shortcut-ignore
                onChange={(e) => setPassword(e.target.value)}
              />
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={locked || !password}
                  onClick={() => void disable()}
                >
                  Turn off two-factor
                </Button>
              </div>
            </div>
          </details>
        </div>
      ) : (
        <div className="row" style={{ gap: 8 }}>
          <Button type="button" size="sm" disabled={locked} onClick={() => void start()}>
            <Icon name="shield" size={13} /> Set up authenticator app
          </Button>
        </div>
      )}
    </div>
  );
}
