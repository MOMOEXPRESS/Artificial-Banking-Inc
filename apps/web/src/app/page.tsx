"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ABLockup, ABMark, ABWordmark } from "../lib/brand";
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
    <div className="landing">
      <TopNav />
      <Hero />
      <TrustStrip />
      <Features />
      <HowItWorks />
      <Enterprise />
      <CtaBand />
      <FooterBand />
    </div>
  );
}

/* ============================================================= navigation */

function TopNav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className={`marketing-nav ${scrolled ? "on-scroll" : ""}`}>
      <div className="marketing-nav-inner">
        <ABWordmark size={26} />
        <nav className="marketing-links">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#enterprise">Enterprise</a>
          <a href="#docs">Docs</a>
          <a href="#pricing">Pricing</a>
          <a href="https://github.com/MOMOEXPRESS/Artificial-Banking-Inc" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <div className="marketing-nav-cta">
          <Link className="btn-ghost-line" href="/console">
            Sign in
          </Link>
          <Link className="btn-primary-line" href="/console">
            Launch console
          </Link>
        </div>
      </div>
    </header>
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

/**
 * Abstract animated visual — orbiting hexagons around a central vault dial.
 * Pure inline SVG so it costs nothing and scales cleanly.
 */
function HeroGraphic() {
  return (
    <div className="hero-graphic">
      <div className="hero-graphic-frame">
        <svg viewBox="0 0 520 520" className="orbit">
          <defs>
            <radialGradient id="halo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(74,158,255,0.28)" />
              <stop offset="60%" stopColor="rgba(74,158,255,0.05)" />
              <stop offset="100%" stopColor="rgba(74,158,255,0)" />
            </radialGradient>
            <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#4a9eff" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.15" />
            </linearGradient>
          </defs>
          <circle cx="260" cy="260" r="240" fill="url(#halo)" />
          {/* Outer dashed orbit */}
          <circle
            cx="260"
            cy="260"
            r="210"
            fill="none"
            stroke="url(#ring)"
            strokeWidth="1"
            strokeDasharray="4 8"
            className="orbit-spin-slow"
          />
          {/* Middle orbit */}
          <circle
            cx="260"
            cy="260"
            r="160"
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
            className="orbit-spin-mid"
          />
          {/* Inner orbit */}
          <circle
            cx="260"
            cy="260"
            r="110"
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="1"
            className="orbit-spin-fast"
          />
          {/* Orbit nodes */}
          <g className="orbit-spin-slow" style={{ transformOrigin: "260px 260px" }}>
            <Node cx={470} cy={260} label="agent" />
            <Node cx={50} cy={260} label="agent" />
          </g>
          <g className="orbit-spin-mid" style={{ transformOrigin: "260px 260px" }}>
            <Node cx={420} cy={160} label="wallet" />
            <Node cx={100} cy={360} label="wallet" />
          </g>
          <g className="orbit-spin-fast" style={{ transformOrigin: "260px 260px" }}>
            <Node cx={370} cy={260} label="x402" small />
            <Node cx={150} cy={260} label="usdc" small />
          </g>
        </svg>
        <div className="hero-graphic-mark">
          <ABMark size={110} tone="#fff" />
        </div>
        {/* Floating status chips */}
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

function Node({ cx, cy, label, small }: { cx: number; cy: number; label: string; small?: boolean }) {
  const r = small ? 8 : 14;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 6} fill="rgba(74,158,255,0.08)" />
      <circle cx={cx} cy={cy} r={r} fill="rgba(74,158,255,0.9)" />
      <text
        x={cx}
        y={cy - r - 8}
        textAnchor="middle"
        fill="rgba(255,255,255,0.7)"
        fontSize="10"
        fontFamily="var(--mono)"
      >
        {label}
      </text>
    </g>
  );
}

function TrustStrip() {
  return (
    <section className="trust-strip">
      <span>Built on</span>
      <div className="trust-logos">
        <TrustLogo>Coinbase CDP</TrustLogo>
        <TrustLogo>Base</TrustLogo>
        <TrustLogo>x402</TrustLogo>
        <TrustLogo>USDC</TrustLogo>
        <TrustLogo>ERC-4337</TrustLogo>
      </div>
    </section>
  );
}

function TrustLogo({ children }: { children: React.ReactNode }) {
  return <span className="trust-logo">{children}</span>;
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
    icon: "zap",
    title: "Coinbase CDP integration",
    body: "Managed custody with a professional signer — no seed phrases, no browser wallets, no missing keys.",
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
    icon: "book",
    title: "Organization treasury",
    body: "A single vault funds every agent. Move money in three directions with balanced double-entry bookkeeping.",
  },
  {
    icon: "clock",
    title: "Agent budgets",
    body: "Per-agent daily caps, running spend meters, burn-rate forecasts and hard ceilings the agent cannot cross.",
  },
  {
    icon: "spark",
    title: "Real-time analytics",
    body: "Vendor concentration, cost-per-deliverable P&L, anomaly detection — computed from your own ledger.",
  },
  {
    icon: "shield",
    title: "Secure on-chain payments",
    body: "EIP-712 signed transfers, per-request idempotency, kill-switch that stops in-flight intents at the engine.",
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

/* ================================================================== CTA */

function CtaBand() {
  return (
    <section className="cta-band">
      <div className="cta-inner">
        <ABLockup size={80} />
        <h2>Ship an autonomous agent this afternoon.</h2>
        <p>
          The console is free while it&rsquo;s in development. Bring an OpenAI, Anthropic, or any
          pay-per-use API — your agent starts spending under policy in minutes.
        </p>
        <div className="hero-ctas" style={{ justifyContent: "center" }}>
          <Link className="btn-primary" href="/console">
            Launch console <Icon name="arrowRight" size={14} />
          </Link>
          <Link className="btn-ghost" href="/console?demo=1">
            <Icon name="play" size={14} /> Try the demo org
          </Link>
        </div>
      </div>
    </section>
  );
}

/* =============================================================== footer */

function FooterBand() {
  return (
    <footer className="marketing-footer">
      <div className="marketing-footer-inner">
        <div className="marketing-footer-brand">
          <ABWordmark size={28} />
          <p>
            The authorization layer between AI agents and real money. Programmable, auditable and
            enterprise-safe.
          </p>
        </div>
        <div className="marketing-footer-cols">
          <FooterCol
            title="Product"
            links={[
              ["Console", "/console"],
              ["Live demo", "/console?demo=1"],
              ["Features", "#features"],
              ["How it works", "#how"],
            ]}
          />
          <FooterCol
            title="Company"
            links={[
              ["About", "#"],
              ["Pricing", "#pricing"],
              ["Docs", "#docs"],
              ["GitHub", "https://github.com/MOMOEXPRESS/Artificial-Banking-Inc"],
            ]}
          />
          <FooterCol
            title="Ecosystem"
            links={[
              ["Coinbase CDP", "https://www.coinbase.com/developer-platform"],
              ["x402", "https://x402.org"],
              ["Base", "https://base.org"],
              ["USDC", "https://www.circle.com/usdc"],
            ]}
          />
        </div>
      </div>
      <div className="marketing-footer-legal">
        <span>© {new Date().getFullYear()} Artificial Banking Incorporated</span>
        <span>Not a bank. Not FDIC insured. Operators remain responsible for agent spend.</span>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4>{title}</h4>
      <ul>
        {links.map(([label, href]) => (
          <li key={label}>
            <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* =============================================================== helpers */

function SectionHead({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="section-head">
      <span className="eyebrow">
        <span className="dot" /> {eyebrow}
      </span>
      <h2>{title}</h2>
      <p>{sub}</p>
    </div>
  );
}
