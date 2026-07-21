"use client";

import Link from "next/link";
import { MarketingShell, SectionHead } from "../../lib/marketing-shell";
import { Icon } from "../../lib/ui";

const TIERS = [
  {
    name: "Developer",
    price: "Free",
    note: "while in development",
    points: [
      "Demo org + playground missions",
      "x402 + mock rails",
      "Policy simulator",
      "ABI Chat + Telegram hooks",
    ],
    cta: "Launch console",
    href: "/console",
    featured: true,
  },
  {
    name: "Team",
    price: "Contact",
    note: "multi-guardian orgs",
    points: [
      "Shared vault + agent stipends",
      "Quorum approvals",
      "Signed webhooks",
      "Burn & vendor analytics",
    ],
    cta: "Talk to us",
    href: "/about",
    featured: false,
  },
  {
    name: "Enterprise",
    price: "Custom",
    note: "custody + compliance",
    points: [
      "Coinbase CDP custody",
      "Pluggable compliance screeners",
      "SSO / SCIM (roadmap)",
      "Dedicated support",
    ],
    cta: "Request access",
    href: "/about",
    featured: false,
  },
];

export default function PricingPage() {
  return (
    <MarketingShell active="pricing">
      <section className="mkt-page">
        <div className="mkt-page-inner">
          <SectionHead
            eyebrow="Pricing"
            title="Start free. Graduate when agents earn their keep."
            sub="No seat tax on humans who only approve. You pay when autonomous spend needs production rails."
          />

          <div className="mkt-price-grid">
            {TIERS.map((t) => (
              <article
                key={t.name}
                className={`mkt-price-card ${t.featured ? "is-featured" : ""}`}
              >
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
                <Link
                  className={t.featured ? "btn-primary" : "btn-ghost"}
                  href={t.href}
                >
                  {t.cta}
                </Link>
              </article>
            ))}
          </div>

          <p className="mkt-fineprint">
            Artificial Banking Incorporated is not a bank and does not hold customer deposits.
            Settlement uses USDC on Base; operators remain responsible for agent spend.
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
