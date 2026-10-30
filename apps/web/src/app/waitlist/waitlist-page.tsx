"use client";

import Link from "next/link";
import { MarketingShell } from "../../lib/marketing-shell";
import { WaitlistForm } from "../../lib/waitlist-form";

export function WaitlistPage() {
  return (
    <MarketingShell active="waitlist">
      <section className="waitlist-page">
        <span className="eyebrow">Artificial Banking Inc.</span>
        <h1>Let AI agents pay for things — without losing control.</h1>
        <p>
          ABI sits between your agents and company money. Every payment is checked against your
          rules first, and anything big waits for a person. Join the waitlist for early access.
        </p>
        <WaitlistForm source="waitlist-page" autoFocus />
        <p className="waitlist-links">
          <Link href="/">How it works</Link>
          <span aria-hidden>·</span>
          <Link href="/console">Open the console</Link>
          <span aria-hidden>·</span>
          <Link href="/docs">Docs</Link>
        </p>
      </section>
    </MarketingShell>
  );
}
