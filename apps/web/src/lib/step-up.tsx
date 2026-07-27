"use client";

/**
 * Step-up re-authentication for high-value approvals (audit finding NEW-1).
 *
 * The API gates approvals at or above ABI_STEP_UP_ABOVE_USDC ($100 by default)
 * behind a fresh proof of identity, and returns 403 STEP_UP_REQUIRED until it
 * gets one. Nothing in the console could satisfy that, so a signed-in guardian
 * approving $100 hit a wall whose only instruction was to issue an HTTP request
 * by hand. The demo path uses a bearer key, which the gate exempts — so the
 * safest users hit the dead end and the common demo never did.
 *
 * This wraps the transport rather than each caller. Four places resolve an
 * approval today (approvals view, approvals page, chat, playground) and a fifth
 * will be written eventually; a prompt-and-retry that only some of them
 * remember to use is the same bug again.
 *
 * A hook rather than a context provider, because the console's authenticated
 * fetch is defined inside the same component that would have to render the
 * provider — and splitting an 1,100-line view to satisfy the hook rules would
 * be a lot of risk for no behavioural gain.
 */

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "./ui";

type Pending = {
  amountUsdc?: string;
  thresholdUsdc?: string;
  resolve: (satisfied: boolean) => void;
};

/** How this user re-proves identity. Asked, not guessed. */
type Factor = "totp" | "password";

export function useStepUp(fetcher: (path: string, init?: RequestInit) => Promise<Response>) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [factor, setFactor] = useState<Factor>("password");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  /**
   * Run a request; if it is refused for want of a step-up, ask for one and
   * replay it exactly once. A second refusal means something other than a
   * missing step-up, and looping would turn a wrong password into an
   * infinite modal.
   */
  const guard = useCallback(async (send: () => Promise<Response>): Promise<Response> => {
    const first = await send();
    if (first.status !== 403) return first;

    // Clone before reading: the caller still expects to parse this response.
    let payload: {
      error?: { code?: string };
      stepUp?: { amountUsdc?: string; thresholdUsdc?: string };
    };
    try {
      payload = await first.clone().json();
    } catch {
      return first;
    }
    if (payload?.error?.code !== "STEP_UP_REQUIRED") return first;

    try {
      const status = await fetcherRef.current("/v1/auth/mfa").then((r) => r.json());
      setFactor(status?.enabled ? "totp" : "password");
    } catch {
      // The password path works for every account; a failed status read must
      // not strand the approval.
      setFactor("password");
    }

    const satisfied = await new Promise<boolean>((resolve) => {
      setError(null);
      setSecret("");
      setPending({
        amountUsdc: payload.stepUp?.amountUsdc,
        thresholdUsdc: payload.stepUp?.thresholdUsdc,
        resolve,
      });
    });
    if (!satisfied) return first;
    return send();
  }, []);

  const submit = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetcherRef.current("/v1/auth/step-up", {
        method: "POST",
        body: JSON.stringify(factor === "totp" ? { code: secret.trim() } : { password: secret }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setError(d?.error?.message ?? "That did not work. Try again.");
        return;
      }
      pending.resolve(true);
      setPending(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }, [factor, pending, secret]);

  const cancel = useCallback(() => {
    pending?.resolve(false);
    setPending(null);
  }, [pending]);

  const modal = pending ? (
    <div
      className="pv-cmdk-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm your identity"
      onClick={cancel}
    >
      <div
        className="card"
        style={{ maxWidth: 430, margin: "12vh auto", padding: 22 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ gap: 10, marginBottom: 10 }}>
          <Icon name="shield" size={18} />
          <h2 style={{ margin: 0, fontSize: 16 }}>Confirm it&rsquo;s you</h2>
        </div>
        <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 0 }}>
          {pending.amountUsdc
            ? `Approving $${pending.amountUsdc} needs a fresh check.`
            : "This approval needs a fresh check."}
          {pending.thresholdUsdc ? ` Anything at or above $${pending.thresholdUsdc} asks for it.` : ""}{" "}
          An open tab should not be enough on its own to move money.
        </p>

        <label style={{ fontSize: 12, display: "block", marginTop: 12 }}>
          {factor === "totp" ? "Authenticator code" : "Your password"}
          <input
            className="input sm"
            type={factor === "totp" ? "text" : "password"}
            inputMode={factor === "totp" ? "numeric" : undefined}
            autoComplete={factor === "totp" ? "one-time-code" : "current-password"}
            placeholder={factor === "totp" ? "123456" : "••••••••"}
            value={secret}
            autoFocus
            data-shortcut-ignore
            onChange={(e) => setSecret(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && secret.trim() && !busy) void submit();
              if (e.key === "Escape") cancel();
            }}
          />
        </label>
        {factor === "totp" && (
          <p className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>
            A recovery code works here too, if you have lost your device.
          </p>
        )}

        {error && (
          <div className="banner" style={{ marginTop: 12 }}>
            <span className="ico">
              <Icon name="alert" size={15} />
            </span>
            <span className="txt">
              <span>{error}</span>
            </span>
          </div>
        )}

        <div className="row" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={busy || !secret.trim()} onClick={() => void submit()}>
            {busy ? "Checking…" : "Confirm"}
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  return { guard, stepUpModal: modal };
}
