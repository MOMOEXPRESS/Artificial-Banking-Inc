"use client";

import { useState, type FormEvent } from "react";
import { browserApiBase } from "./browser-api";
import {
  looksLikeEmail,
  parseWaitlistResponse,
  waitlistPayload,
  waitlistReferrer,
  type WaitlistResult,
  type WaitlistSource,
} from "./waitlist";

/** Email-only waitlist form. Shows a confirmation in place after joining. */
export function WaitlistForm({
  source,
  autoFocus,
}: {
  source: WaitlistSource;
  autoFocus?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WaitlistResult | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!looksLikeEmail(email)) {
      setResult({ kind: "invalid", message: "Enter a valid email address." });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`${browserApiBase()}/v1/public/waitlist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          waitlistPayload({
            email,
            source,
            referrer: waitlistReferrer(
              window.location.search,
              document.referrer,
              window.location.host,
            ),
            honeypot,
          }),
        ),
      });
      const body = await res.json().catch(() => null);
      setResult(parseWaitlistResponse(res.status, body));
    } catch {
      setResult(parseWaitlistResponse(0, null));
    } finally {
      setBusy(false);
    }
  }

  if (result?.kind === "joined") {
    return (
      <div className="waitlist-done" role="status" aria-live="polite">
        <strong>You&rsquo;re on the list.</strong>
        <span>We&rsquo;ll email {email.trim().toLowerCase()} when there&rsquo;s a spot.</span>
      </div>
    );
  }

  return (
    <form className="waitlist-form" onSubmit={submit} noValidate>
      <label className="waitlist-sr" htmlFor={`waitlist-email-${source}`}>
        Email address
      </label>
      <div className="waitlist-row">
        <input
          id={`waitlist-email-${source}`}
          className="waitlist-input"
          type="email"
          name="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={result?.kind === "invalid"}
          autoFocus={autoFocus}
          required
        />
        <button className="btn-primary waitlist-submit" type="submit" disabled={busy}>
          {busy ? "Joining…" : "Join the waitlist"}
        </button>
      </div>
      {/* Honeypot: hidden from people and screen readers; bots fill it. */}
      <div className="waitlist-hp" aria-hidden="true">
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </label>
      </div>
      {result && (
        <p className="waitlist-msg" role="alert">
          {result.message}
        </p>
      )}
      <p className="waitlist-fine">No spam. One email when there&rsquo;s a spot.</p>
    </form>
  );
}

/** Landing-page section. */
export function WaitlistBand() {
  return (
    <section id="waitlist" className="waitlist-band" aria-labelledby="waitlist-title">
      <div className="waitlist-copy">
        <span className="eyebrow">Waitlist</span>
        <h2 id="waitlist-title">Get early access.</h2>
        <p>
          ABI runs on Base Sepolia testnet today. Join the waitlist and we&rsquo;ll let you know
          when mainnet and team accounts open.
        </p>
      </div>
      <WaitlistForm source="landing" />
    </section>
  );
}
