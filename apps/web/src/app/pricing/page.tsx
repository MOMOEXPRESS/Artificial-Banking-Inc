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
    price: "Contact",
    note: "more than one approver",
    points: [
      "Org vault + treasury budgets",
      "Multi-person approvals",
      "Signed webhooks",
      "Spend & vendor reports",
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
      "Pluggable compliance checks",
      "SSO / SCIM (roadmap)",
      "Dedicated support",
    ],
    cta: "Request access",
    href: "/about",
    featured: false,
  },
];

type Cell = true | false | string;

const COMPARE_ROWS: { feature: string; developer: Cell; team: Cell; enterprise: Cell }[] = [
  { feature: "Demo org & playground", developer: true, team: true, enterprise: true },
  { feature: "Policy simulator", developer: true, team: true, enterprise: true },
  { feature: "x402 + mock rails", developer: true, team: true, enterprise: true },
  { feature: "Production USDC settlement", developer: false, team: true, enterprise: true },
  { feature: "Org vault & agent stipends", developer: false, team: true, enterprise: true },
  { feature: "Multi-guardian quorum", developer: false, team: true, enterprise: true },
  { feature: "Signed webhooks", developer: false, team: true, enterprise: true },
  { feature: "Burn & vendor analytics", developer: false, team: true, enterprise: true },
  { feature: "Coinbase CDP custody", developer: false, team: "Optional", enterprise: true },
  { feature: "Compliance screeners", developer: false, team: false, enterprise: true },
  { feature: "SSO / SCIM", developer: false, team: false, enterprise: "Roadmap" },
  { feature: "Dedicated support", developer: false, team: "Business hours", enterprise: true },
];

function CompareCell({ value }: { value: Cell }) {
  if (value === true) {
    return (
      <span className="mkt-compare-yes" title="Included">
        <Icon name="check" size={14} />
      </span>
    );
  }
  if (value === false) {
    return <span className="mkt-compare-no">—</span>;
  }
  return <span className="mkt-compare-note">{value}</span>;
}

export default function PricingPage() {
  return (
    <MarketingShell active="pricing">
      <section className="mkt-page">
        <div className="mkt-page-inner">
          <SectionHead
            eyebrow="Pricing"
            title="Start free. Pay when you need production rails."
            sub="No charge for people who only approve. You pay when agents need real settlement and team controls."
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

          <div className="mkt-compare">
            <h3 className="mkt-compare-title">Compare plans</h3>
            <p className="mkt-compare-sub">
              What you get on Developer, Team, and Enterprise — and what you do not.
            </p>
            <div className="mkt-compare-wrap">
              <table className="mkt-compare-table">
                <thead>
                  <tr>
                    <th scope="col">Capability</th>
                    <th scope="col">Developer</th>
                    <th scope="col">Team</th>
                    <th scope="col">Enterprise</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map((row) => (
                    <tr key={row.feature}>
                      <th scope="row">{row.feature}</th>
                      <td>
                        <CompareCell value={row.developer} />
                      </td>
                      <td>
                        <CompareCell value={row.team} />
                      </td>
                      <td>
                        <CompareCell value={row.enterprise} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
