"use client";
import Link from "next/link";
import Image from "next/image";
import { MarketingShell } from "../lib/marketing-shell";
import { MarketplaceCatalog } from "../lib/marketplace-catalog";
import { Icon } from "../lib/ui";
import { AgentLogoCluster } from "../lib/agent-logo-cluster";
import "./home-agent-banner.css";

const AGENT_CLIENTS = [
  { name: "OpenAI / ChatGPT", symbol: "openai", wordmark: "openai-text" },
  { name: "Claude Code", symbol: "claude-color", wordmark: "claude-text" },
  { name: "Codex CLI", symbol: "codex", wordmark: "codex-text" },
  { name: "GitHub Copilot", symbol: "githubcopilot", wordmark: "githubcopilot-text" },
  { name: "Gemini CLI", symbol: "gemini-color", wordmark: "gemini-text" },
  { name: "Cursor", symbol: "cursor", wordmark: "cursor-text" },
];

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
                Connect your agent <AgentLogoCluster /> <Icon name="arrowRight" size={18} />
              </Link>
              <Link href="/directory">Explore the catalog</Link>
            </div>
          </div>
        </section>
        <section className="agent-logo-band" aria-label="Connect your AI agent">
          <div className="agent-logo-band-heading">
            <Link href="/console?view=connect">
              Connect the agent you already use <Icon name="arrowRight" size={15} />
            </Link>
            <Link href="/docs#chatgpt">MCP & API setup</Link>
          </div>
          <div className="agent-logo-window">
            <div className="agent-logo-track">
              {[0, 1].map((copy) => (
                <ul
                  className="agent-logo-cycle"
                  key={copy}
                  aria-label={copy === 0 ? "Compatible agent clients" : undefined}
                  aria-hidden={copy === 1 ? true : undefined}
                >
                  {AGENT_CLIENTS.map((client) => (
                    <li key={client.name}>
                      <span className="sr-only">{client.name}</span>
                      <Image
                        src={`/agent-logos/${client.symbol}.svg`}
                        alt=""
                        width={30}
                        height={30}
                      />
                      <Image
                        className="agent-logo-wordmark"
                        src={`/agent-logos/${client.wordmark}.svg`}
                        alt=""
                        width={118}
                        height={30}
                      />
                    </li>
                  ))}
                </ul>
              ))}
            </div>
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
