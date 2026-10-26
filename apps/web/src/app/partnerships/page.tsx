"use client";

import Link from "next/link";
import { MarketingShell, SectionHead } from "../../lib/marketing-shell";
import { Icon } from "../../lib/ui";

const STEPS = [
  {
    title: "Become a partner",
    body: "Sign up on the partner portal. We create your seller organization from your company details — no buyer account needed.",
  },
  {
    title: "List offers in Catalog",
    body: "Each offer is an endpoint on your site plus a USDC price. Published offers are listed in the ABI buyer directory by default; opt out per offer to keep one site-only.",
  },
  {
    title: "Attach x402 (BYO or snippet)",
    body: "Paste the Integrate snippet or bring your own x402 stack. Verify an unpaid GET returns HTTP 402.",
  },
  {
    title: "Agents pay through ABI",
    body: "The agent’s buyer org evaluates policy, settles USDC to your wallet, and retries to unlock the resource.",
  },
];

const POINTS = [
  [
    "Listed unless you opt out",
    "Published offers appear in the ABI buyer directory. Turn listing off per offer to keep it site-only.",
  ],
  [
    "Separate partner account",
    "Partner logins are not linked to buyer accounts. Your seller org is yours alone.",
  ],
  ["BYO or snippet", "Verify an existing x402 server or paste generated Express middleware."],
  [
    "Wallet settlement",
    "USDC goes to your payout address via the facilitator — ABI does not custody seller funds.",
  ],
];

export default function PartnershipsPage() {
  return (
    <MarketingShell active="partnerships">
      <section className="mkt-page">
        <div className="mkt-page-inner">
          <SectionHead
            title="Get paid when agents buy on your site."
            sub="Partners get their own login and seller console: catalog, x402 setup, per-endpoint analytics, invoices and payouts, access policies, versioning, a buyer sandbox, and webhooks. It is separate from the buyer console your agents spend from."
          />

          <div className="mkt-price-grid" style={{ marginBottom: 36 }}>
            {POINTS.map(([title, body]) => (
              <article key={title} className="mkt-price-card">
                <header>
                  <h3>{title}</h3>
                </header>
                <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
                  {body}
                </p>
              </article>
            ))}
          </div>

          <div className="mkt-compare" style={{ marginBottom: 28 }}>
            <h3 className="mkt-compare-title">How it works</h3>
            <p className="mkt-compare-sub">
              Agents find your offers in the ABI directory or on your own site. ABI buyer orgs pay;
              your endpoint unlocks.
            </p>
            <ol style={{ margin: "18px 0 0", paddingLeft: 20, lineHeight: 1.7 }}>
              {STEPS.map((step) => (
                <li key={step.title} style={{ marginBottom: 12 }}>
                  <b>{step.title}</b>
                  <div className="muted">{step.body}</div>
                </li>
              ))}
            </ol>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
              marginBottom: 28,
            }}
          >
            <Link className="btn-primary" href="/partners/login">
              Open seller console
            </Link>
            <Link className="btn-ghost" href="/partners/login?mode=signup">
              Become a partner
            </Link>
            <span className="muted" style={{ fontSize: 13 }}>
              <Icon name="shield" size={14} /> Separate partner account · seller org created at
              sign-up
            </span>
          </div>

          <p className="mkt-fineprint">
            Artificial Banking Incorporated is not a bank and does not hold seller proceeds. Sellers
            receive USDC at the wallet they configure. Partnership tooling is pre-beta.
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
