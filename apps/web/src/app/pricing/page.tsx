"use client";

import Link from "next/link";
import { MarketingShell, SectionHead } from "../../lib/marketing-shell";
import { Icon } from "../../lib/ui";

const TIERS = [
  {
    name: "Developer",
    price: "Free",
    note: "while we're building",
    points: [
      "Demo org + playground missions",
      "x402 + mock payment rails",
      "Rule simulator",
      "Console chat + Telegram hooks",
    ],
    cta: "Open the console",
    href: "/console",
    featured: true,
  },
  {
    name: "Team",
    price: "Not for sale yet",
    note: "billing and entitlements are not enabled",
    points: [
      "Org vault + treasury budgets",
      "Multi-person approvals",
      "Signed webhooks",
      "Spend & vendor reports",
    ],
    cta: "Explore current features",
    href: "/docs",
    featured: false,
  },
  {
    name: "Enterprise",
    price: "Roadmap",
    note: "availability and terms not defined",
    points: [
      "Managed custody (roadmap)",
      "Pluggable compliance checks (roadmap)",
      "SSO / SCIM (roadmap)",
      "Dedicated support",
    ],
    cta: "Read product status",
    href: "/about",
    featured: false,
  },
];

const CAPABILITIES = [
  ["Sandbox organization and playground", "Available in code; enabled by deployment configuration"],
  ["Policy simulator, budgets, and approvals", "Available in code; test with sandbox data"],
  ["x402 and mock payment rails", "Development rails; live behavior depends on provider setup"],
  ["Base Sepolia settlement", "Testnet support; requires RPC and signer configuration"],
  ["Coinbase CDP custody", "Not connected"],
  ["Billing, plan gates, and paid support", "Not enabled"],
  ["Compliance screening, SSO, and SCIM", "Roadmap; not available as a service"],
];

export default function PricingPage() {
  return (
    <MarketingShell active="pricing">
      <section className="mkt-page">
        <div className="mkt-page-inner">
          <SectionHead
            eyebrow="Pricing"
            title="Explore ABI while we build."
            sub="ABI is in pre-beta. These are indicative product areas, not purchasable plans: billing, tier entitlements, and live settlement are not enabled."
          />

          <div className="mkt-price-grid">
            {TIERS.map((t) => (
              <article key={t.name} className={`mkt-price-card ${t.featured ? "is-featured" : ""}`}>
                <header>
                  <h3>{t.name}</h3>
                  <p className="mkt-price">
                    {t.price}
                    <span>{t.note}</span>
                  </p>
                </header>
                <ul>
                  {t.points.map((p) => (
                    <li key={p}>
                      <Icon name="check" size={14} /> {p}
                    </li>
                  ))}
                </ul>
                <Link className={t.featured ? "btn-primary" : "btn-ghost"} href={t.href}>
                  {t.cta}
                </Link>
              </article>
            ))}
          </div>

          <div className="mkt-compare">
            <h3 className="mkt-compare-title">Current capabilities and roadmap</h3>
            <p className="mkt-compare-sub">
              Availability is not enforced by subscription. Sandbox and testnet capabilities depend
              on deployment configuration.
            </p>
            <div className="mkt-compare-wrap">
              <table className="mkt-compare-table">
                <thead>
                  <tr>
                    <th scope="col">Capability</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {CAPABILITIES.map(([feature, status]) => (
                    <tr key={feature}>
                      <th scope="row">{feature}</th>
                      <td>{status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mkt-fineprint">
            Artificial Banking Incorporated is not a bank and does not hold customer deposits. ABI
            is pre-beta. No subscription purchases or live custody service are offered through this
            page.
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
