"use client";

import Link from "next/link";
import {
  MarketingCta,
  MarketingShell,
  SectionHead,
} from "../lib/marketing-shell";
import { LandingMotion } from "../lib/landing-motion";
import { Icon } from "../lib/ui";

/**
 * Artificial Banking Incorporated — public landing page.
 *
 * Sits at "/". The console lives at "/console" and is reached via the
 * "Launch Console" CTAs. This page has no dependency on the console's live
 * session or API polling, so it renders instantly and stays cheap.
 */
export default function LandingPage() {
  return (
    <MarketingShell active="landing">
      <LandingMotion />
      <Hero />
      <MetricsBand />
      <TrustStrip />
      <Features />
      <ProductTour />
      <HowItWorks />
      <Enterprise />
      <MarketingCta />
    </MarketingShell>
  );
}

/* ==================================================================== hero */

function Hero() {
  return (
    <section className="hero">
      <div className="hero-halo" aria-hidden />
      <div className="hero-inner">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="dot" /> Financial infrastructure for autonomous AI
          </span>
          <h1>
            Give AI agents the ability to <em>spend safely.</em>
          </h1>
          <p className="hero-sub">
            Artificial Banking Incorporated is the authorization layer between
            your AI agents and real money. Programmable wallets, spending
            policies, human approvals and on-chain settlement — all in one
            operating system.
          </p>
          <div className="hero-ctas">
            <Link className="btn-primary" href="/console">
              Launch console <Icon name="arrowRight" size={14} />
            </Link>
            <Link className="btn-ghost" href="/console?demo=1">
              <Icon name="play" size={14} /> Live demo
            </Link>
          </div>
          <div className="hero-meta">
            <div>
              <b>Base + USDC</b>
              <span>on-chain settlement</span>
            </div>
            <div className="sep" />
            <div>
              <b>x402 native</b>
              <span>machine payments</span>
            </div>
            <div className="sep" />
            <div>
              <b>Coinbase CDP</b>
              <span>managed custody</span>
            </div>
          </div>
        </div>
        <div className="hero-visual">
          <HeroGraphic />
        </div>
      </div>
    </section>
  );
}

/** Product-shaped hero frame — shows what the console looks like before Launch. */
function HeroGraphic() {
  return (
    <div className="hero-graphic">
      <div className="hero-graphic-frame">
        <div className="hero-console-mock" aria-hidden>
          <div className="hero-console-chrome">
            <span className="hero-console-dot" />
            <span className="hero-console-dot" />
            <span className="hero-console-dot" />
            <span>Console · Overview</span>
          </div>
          <div className="hero-console-body">
            <div className="hero-console-rail">
              <span className="on" />
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="hero-console-main">
              <div className="hero-console-kpis">
                <div className="hero-console-kpi">
                  <span>Treasury</span>
                  <b>$12,480</b>
                </div>
                <div className="hero-console-kpi">
                  <span>Agents</span>
                  <b>8 live</b>
                </div>
                <div className="hero-console-kpi">
                  <span>Approvals</span>
                  <b>2 open</b>
                </div>
              </div>
              <div className="hero-console-card">
                <div className="row">
                  <span className="title">Recent activity</span>
                  <span className="meta">live</span>
                </div>
                <p className="meta">ops-bot settled $1.20 · x402 · api.openai.com</p>
                <div className="hero-console-pills">
                  <i className="ok">allowed</i>
                  <i className="warn">awaiting</i>
                  <i>$45 pending</i>
                </div>
              </div>
              <div className="hero-console-card">
                <div className="row">
                  <span className="title">Move funds</span>
                  <span className="meta">guardian</span>
                </div>
                <p className="meta">Deposit · Withdraw · Agent stipend — policy checked first.</p>
              </div>
            </div>
          </div>
        </div>
        <div className="chip-float chip-a">
          <span className="pill ok">
            <i /> allowed
          </span>
          <span className="mono">$1.20 · x402</span>
        </div>
        <div className="chip-float chip-b">
          <span className="pill warn">
            <i /> awaiting approval
          </span>
          <span className="mono">$45 · api.openai.com</span>
        </div>
        <div className="chip-float chip-c">
          <span className="pill bad">
            <i /> blocked
          </span>
          <span className="mono">off-allowlist</span>
        </div>
      </div>
    </div>
  );
}

function TrustStrip() {
  return (
    <section className="trust-strip">
      <span>Built with</span>
      <div className="trust-logos partner-logos">
        <PartnerLogo abbr="CDP">Coinbase CDP</PartnerLogo>
        <PartnerLogo abbr="BASE">Base</PartnerLogo>
        <PartnerLogo abbr="x402">x402</PartnerLogo>
        <PartnerLogo abbr="USDC">USDC</PartnerLogo>
        <PartnerLogo abbr="4337">ERC-4337</PartnerLogo>
      </div>
    </section>
  );
}

function PartnerLogo({ children, abbr }: { children: React.ReactNode; abbr: string }) {
  return (
    <span className="partner-logo" title={String(children)}>
      <svg className="partner-svg" viewBox="0 0 40 40" width="28" height="28" aria-hidden>
        <rect x="2" y="2" width="36" height="36" rx="0" stroke="currentColor" strokeWidth="2" fill="none" />
        <text
          x="20"
          y="24"
          textAnchor="middle"
          fontSize={abbr.length > 3 ? "8" : "10"}
          fontFamily="var(--mono)"
          fontWeight="700"
          fill="currentColor"
        >
          {abbr.slice(0, 4)}
        </text>
      </svg>
      <span className="partner-name">{children}</span>
    </span>
  );
}

function MetricsBand() {
  const metrics = [
    { label: "Policy probe", value: "0ms", sub: "mock rail latency" },
    { label: "Guardian round-trip", value: "55ms", sub: "local dev median" },
    { label: "Console views", value: "14", sub: "money · agents · records" },
    { label: "Playground missions", value: "7", sub: "real API, real ledger" },
  ];
  return (
    <section className="metrics-band section tight">
      <div className="metrics-grid">
        {metrics.map((m) => (
          <article key={m.label} className="metric-card">
            <span className="metric-label">{m.label}</span>
            <strong className="metric-value">{m.value}</strong>
            <span className="metric-sub">{m.sub}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

const PRODUCT_FRAMES = [
  {
    title: "Overview",
    sub: "Treasury, agents, and move funds in one glance.",
    chips: ["$12.4k vault", "8 agents", "2 approvals"],
  },
  {
    title: "Approvals",
    sub: "Parked payments with one-tap approve or deny.",
    chips: ["$45 pending", "guardian HITL", "Telegram sync"],
  },
  {
    title: "Policy simulator",
    sub: "Test caps and allowlists before agents hit production.",
    chips: ["allowlist", "daily cap", "quiet hours"],
  },
];

function ProductTour() {
  return (
    <section id="product" className="section product-tour">
      <SectionHead
        eyebrow="Inside the console"
        title="See the product before you sign in"
        sub="Three frames operators actually use — not decorative orbit art."
      />
      <div className="product-frames">
        {PRODUCT_FRAMES.map((f) => (
          <article key={f.title} className="product-frame">
            <div className="product-frame-chrome">
              <span />
              <span />
              <span />
              <em>{f.title}</em>
            </div>
            <div className="product-frame-body">
              <h3>{f.title}</h3>
              <p>{f.sub}</p>
              <div className="hero-console-pills">
                {f.chips.map((c) => (
                  <i key={c}>{c}</i>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
      <div className="product-tour-cta">
        <Link className="btn-primary" href="/console">
          Launch console <Icon name="arrowRight" size={14} />
        </Link>
      </div>
    </section>
  );
}

/* =============================================================== features */

const FEATURES: { icon: string; title: string; body: string }[] = [
  {
    icon: "wallet",
    title: "AI agent wallets",
    body: "Every agent gets a programmable stipend account with its own balance, spend history and identity.",
  },
  {
    icon: "sliders",
    title: "Spending policies",
    body: "Deterministic bands, allowlists, blocklists, velocity brakes, quiet hours — all edited live with a policy simulator.",
  },
  {
    icon: "check",
    title: "Human approvals",
    body: "Any payment past your threshold parks and waits for you. Approve from the console, chat or Telegram.",
  },
  {
    icon: "swap",
    title: "x402 payments",
    body: "Speak the machine-payment standard natively. Agents can pay any x402 seller under policy, on-chain.",
  },
  {
    icon: "list",
    title: "Immutable audit log",
    body: "Every intent, denial, approval and settlement is journaled. Replayable from genesis, exportable to CSV.",
  },
  {
    icon: "shield",
    title: "Keys never enter the model",
    body: "LLMs propose. Policy and signer authorize. EIP-712 transfers, idempotency, and a kill-switch on in-flight intents.",
  },
];

function Features() {
  return (
    <section id="features" className="section">
      <SectionHead
        eyebrow="Everything you need"
        title="A financial operating system for AI agents"
        sub="Programmable wallets and safety rails, wired straight into on-chain settlement."
      />
      <div className="feat-grid">
        {FEATURES.map((f) => (
          <article key={f.title} className="feat-card">
            <div className="feat-icon">
              <Icon name={f.icon} />
            </div>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/* =============================================================== how it works */

const STEPS = [
  {
    n: "01",
    title: "Connect your organization",
    body: "Create an org, get a guardian key, fund the vault with USDC. Coinbase CDP handles custody.",
  },
  {
    n: "02",
    title: "Create AI agents",
    body: "Each agent gets an API key and a stipend account. Plug the key into your Python, Node or MCP runtime.",
  },
  {
    n: "03",
    title: "Assign budget & policy",
    body: "Set daily caps, per-payment ceilings, approval thresholds and allowlists. Test edits in the simulator first.",
  },
  {
    n: "04",
    title: "Agents complete paid tasks",
    body: "Agents call pay verbs; the policy engine authorizes, the CDP wallet signs, USDC settles on Base.",
  },
];

function HowItWorks() {
  return (
    <section id="how" className="section how">
      <SectionHead
        eyebrow="How it works"
        title="From zero to a paying agent in four steps"
        sub="No smart contracts to deploy. No keys for your agents to leak. No custom infrastructure."
      />
      <ol className="steps-track">
        {STEPS.map((s, i) => (
          <li key={s.n} className="step-card">
            <span className="step-n">{s.n}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
            {i < STEPS.length - 1 && <span className="step-connector" aria-hidden />}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* =============================================================== enterprise */

const ENTERPRISE_POINTS = [
  {
    icon: "shield",
    title: "Spending permissions",
    body: "Role-based access, multi-guardian quorum, and a rotating key surface for every agent.",
  },
  {
    icon: "clock",
    title: "Budgets you can defend in an audit",
    body: "Journal-replay reconciliation runs every minute and screams the moment a cent is out of place.",
  },
  {
    icon: "list",
    title: "Complete audit trail",
    body: "Every decision, rule fired and receipt is journaled. Export to CSV, stream over signed webhooks.",
  },
  {
    icon: "check",
    title: "Approval workflows",
    body: "Route large spends to a person, a Telegram DM, or a chat channel — with a hard-cap always above.",
  },
  {
    icon: "zap",
    title: "Secure by default",
    body: "The LLM proposes; a deterministic policy engine and hardware-backed signer authorize.",
  },
  {
    icon: "swap",
    title: "Autonomous payments",
    body: "Recurring subscriptions, agent-to-agent escrow, refunds — every one still passes the same policy.",
  },
];

function Enterprise() {
  return (
    <section id="enterprise" className="section enterprise">
      <SectionHead
        eyebrow="For teams"
        title="Enterprise-ready guardrails from day one"
        sub="Because the first agent-driven mistake is the last one anyone forgets."
      />
      <div className="ent-grid">
        {ENTERPRISE_POINTS.map((p) => (
          <div key={p.title} className="ent-card">
            <div className="ent-icon">
              <Icon name={p.icon} />
            </div>
            <h3>{p.title}</h3>
            <p>{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* =============================================================== helpers */
