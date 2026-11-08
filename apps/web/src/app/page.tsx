"use client";
import Link from "next/link";
import { MarketingShell } from "../lib/marketing-shell";
import { MarketplaceCatalog } from "../lib/marketplace-catalog";
import { Icon } from "../lib/ui";
import "./home-agent-banner.css";

export default function HomePage() {
  return (
    <MarketingShell active="home">
      <div className="minimal-home">
        <section className="minimal-hero">
          <h1>
            Everything your
            <br />
            agents need.
            <br />
            <span>One marketplace.</span>
          </h1>
          <div className="minimal-hero-copy">
            <p>
              Find tools, software and physical goods. Let your agent compare the options and
              prepare a purchase, with your budget and approval rules built in.
            </p>
            <div className="minimal-actions">
              <Link className="minimal-primary" href="/console?view=connect">
                Connect your agent <Icon name="arrowRight" size={18} />
              </Link>
              <Link href="/directory">Explore the catalog</Link>
            </div>
          </div>
        </section>
        <section className="agent-connect-banner" aria-labelledby="agent-connect-title">
          <div className="agent-connect-heading">
            <span className="agent-connect-symbol" aria-hidden="true">
              <Icon name="zap" size={23} />
            </span>
            <div>
              <h2 id="agent-connect-title">Bring your own agent.</h2>
              <p>Connect through MCP or the API. You control permissions and spending.</p>
            </div>
          </div>
          <ul className="agent-connect-clients" aria-label="Compatible agent clients">
            {["Claude Code", "ChatGPT", "Cursor", "Codex CLI", "Gemini CLI"].map((client) => (
              <li key={client}>{client}</li>
            ))}
            <li className="agent-connect-custom">Your custom agent</li>
          </ul>
          <div className="agent-connect-actions">
            <Link className="minimal-primary" href="/console?view=connect">
              Connect your agent <Icon name="arrowRight" size={17} />
            </Link>
            <Link className="agent-connect-guide" href="/docs#chatgpt">
              View setup options <Icon name="arrowRight" size={15} />
            </Link>
          </div>
        </section>
        <section className="minimal-home-categories" aria-label="Marketplace categories">
          {[
            [
              "service",
              "Tools & APIs",
              "Data, services and capabilities for your next task.",
              "zap",
            ],
            ["digital", "Software", "Digital products, downloads and software.", "layers"],
            [
              "physical",
              "Physical goods",
              "Real products, with stock and delivery details.",
              "layers",
            ],
          ].map(([kind, title, description, icon]) => (
            <Link key={kind} href={`/directory?kind=${kind}`}>
              <Icon name={icon} size={26} />
              <div>
                <h2>{title}</h2>
                <p>{description}</p>
              </div>
              <Icon name="arrowRight" size={20} />
            </Link>
          ))}
        </section>
        <section className="minimal-home-section">
          <MarketplaceCatalog compact />
        </section>
        <section className="minimal-home-section minimal-how">
          <div>
            <h2>
              From a request
              <br />
              to a receipt.
            </h2>
            <p>Your agent does the legwork. You decide what it can spend.</p>
            <Link href="/docs">
              See how ABI works <Icon name="arrowRight" size={16} />
            </Link>
          </div>
          <ol>
            <li>
              <span>1</span>
              <div>
                <h3>Connect your agent</h3>
                <p>
                  Create a scoped key and set an allowance. Read access and payment permissions stay
                  explicit.
                </p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <h3>Find the right fit</h3>
                <p>
                  Search by what you need. Compare price, seller information, product attributes and
                  current availability.
                </p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <h3>Review, purchase, track</h3>
                <p>
                  Check the quote before checkout. Follow each item through payment, delivery and
                  purchase feedback.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <section className="minimal-home-section minimal-home-control">
          <h2>
            A little autonomy.
            <br />
            Clear boundaries.
          </h2>
          <div>
            <p>
              Give each agent an allowance, define its permissions and keep a record of what it
              does. Purchases remain subject to policy checks and required approvals.
            </p>
            <div className="minimal-link-rows">
              <Link href="/console?view=connect">
                <span>Scoped API keys</span>
                <Icon name="arrowRight" size={18} />
              </Link>
              <Link href="/console?view=agents">
                <span>Agent budgets & spending rules</span>
                <Icon name="arrowRight" size={18} />
              </Link>
              <Link href="/console?view=billing">
                <span>Billing & settlement balances</span>
                <Icon name="arrowRight" size={18} />
              </Link>
            </div>
            <p className="minimal-note">
              USDC settlement currently runs on Base Sepolia. Card-funded USD credits are a separate
              account and require payment-provider configuration.
            </p>
          </div>
        </section>
        <section className="minimal-home-section minimal-seller">
          <div>
            <h2>Something worth finding?</h2>
            <p>
              Publish your tools, software or physical products. Manage listings, inventory and
              fulfillment in your seller workspace.
            </p>
          </div>
          <Link className="minimal-primary" href="/partners/login">
            Sell on ABI <Icon name="arrowRight" size={18} />
          </Link>
        </section>
      </div>
    </MarketingShell>
  );
}
