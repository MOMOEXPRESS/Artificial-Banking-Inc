"use client";

import Link from "next/link";
import { MarketingShell } from "../../lib/marketing-shell";
import { WaitlistForm } from "../../lib/waitlist-form";

export function WaitlistPage() {
  return (
    <MarketingShell active="waitlist">
      <section className="waitlist-page">
        
        <h1>Join the next way to buy and sell.</h1>
        <p>
          Discover products with your agent, or bring your catalog to ABI. Join the waitlist for early access to the agentic marketplace.
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
