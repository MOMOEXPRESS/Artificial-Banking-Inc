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
 * Artificial Banking Incorporated — public home page.
 *
 * Sits at "/". The console lives at "/console" and is reached via the
 * "Launch Console" CTAs. This page has no dependency on the console's live
 * session or API polling, so it renders instantly and stays cheap.
 */
export default function HomePage() {
  return (
    <MarketingShell active="home">
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
    { label: "Console surfaces", value: "10", sub: "money · agents · records" },
    { label: "Playground missions", value: "7", sub: "real API, real ledger" },
  ];
  return (
    <section className="metrics-band section tight">
      <div className="metrics-strip">
        {metrics.map((m) => (
          <div key={m.label} className="metric-inline">
            <span className="metric-label">{m.label}</span>
            <strong className="metric-value">{m.value}</strong>
            <span className="metric-sub">{m.sub}</span>
          </div>
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

const FEATURES: {
  icon: string;
  title: string;
  lead: string;
  body: string;
  visual: { label: string; lines: string[] };
}[] = [
  {
    icon: "wallet",
    title: "AI agent wallets",
    lead: "Every agent gets its own programmable stipend — not a shared org card.",
    body: "Balances, spend history, and identity live on the agent. You fund the vault once, then push stipends down. Agents never share a private key with each other, and you can freeze one without pausing the fleet.",
    visual: {
      label: "Stipend · ops-bot",
      lines: ["Available  $420.00", "Held       $12.40", "Spent today  $38.10"],
    },
  },
  {
    icon: "sliders",
    title: "Spending policies",
    lead: "Caps, allowlists, quiet hours — deterministic rules the model cannot talk around.",
    body: "Edit bands live and probe them in the simulator before production. Velocity brakes and blocklists sit in the same engine that authorizes every intent, so policy and payment stay one path.",
    visual: {
      label: "Policy probe",
      lines: ["daily_cap  $500  → allow", "host  api.openai.com  → allow", "quiet_hours  02:00  → park"],
    },
  },
  {
    icon: "check",
    title: "Human approvals",
    lead: "Anything past your threshold parks until a person says yes.",
    body: "Approve from the console, chat, or Telegram. Denials write the same journal as allows, so you can see who blocked what and why — without digging through model logs.",
    visual: {
      label: "Awaiting you",
      lines: ["$45.00  api.openai.com", "threshold  $25", "route  Telegram · console"],
    },
  },
  {
    icon: "swap",
    title: "x402 payments",
    lead: "Speak the machine-payment standard natively — under the same policy.",
    body: "Agents can pay any x402 seller on-chain without a custom integrator per API. Authorization still runs first; settlement is USDC on Base when the intent clears.",
    visual: {
      label: "x402 settle",
      lines: ["seller  data.example", "paid  $1.20 of $5 auth", "rail  Base · USDC"],
    },
  },
  {
    icon: "list",
    title: "Immutable audit log",
    lead: "Every intent, denial, approval, and settlement is journaled.",
    body: "Replay from genesis, export to CSV, or stream signed webhooks into your SIEM. When finance asks what an agent spent last Tuesday, you have receipts — not chat transcripts.",
    visual: {
      label: "Journal",
      lines: ["intent  pay.x402  allowed", "hold  $1.20  → settle", "export  CSV · webhook"],
    },
  },
  {
    icon: "shield",
    title: "Keys never enter the model",
    lead: "LLMs propose. Policy and signer authorize.",
    body: "EIP-712 transfers, idempotency keys, and a kill-switch on in-flight intents keep custody outside the prompt. The model can ask to spend; it cannot hold the wallet.",
    visual: {
      label: "Custody boundary",
      lines: ["model  propose only", "policy  decide", "CDP signer  execute"],
    },
  },
];

function Features() {
  const lead = FEATURES.slice(0, 2);
  const mid = FEATURES.slice(2, 4);
  const tail = FEATURES.slice(4, 6);
  return (
    <div id="features" className="pane-stack">
      <section className="section pane-intro">
        <SectionHead
          eyebrow="Everything you need"
          title="A financial operating system for AI agents"
          sub="Programmable wallets and safety rails, wired straight into on-chain settlement. Scroll each capability — denser than a card grid, clearer than a feature dump."
        />
      </section>
      {lead.map((f, i) => (
        <FeaturePane key={f.title} f={f} index={i} flip={i % 2 === 1} />
      ))}
      <section className="pane-pair" aria-label="Approvals and payments">
        {mid.map((f, i) => (
          <FeaturePane key={f.title} f={f} index={i + 2} compact />
        ))}
      </section>
      <section className="pane-pair pane-pair-alt" aria-label="Audit and custody">
        {tail.map((f, i) => (
          <FeaturePane key={f.title} f={f} index={i + 4} compact />
        ))}
      </section>
    </div>
  );
}

function FeaturePane({
  f,
  index,
  flip,
  compact,
}: {
  f: (typeof FEATURES)[number];
  index: number;
  flip?: boolean;
  compact?: boolean;
}) {
  return (
    <section
      className={`pane-block ${flip ? "pane-flip" : ""} ${compact ? "pane-compact" : ""}`}
      aria-labelledby={`feat-${index}`}
    >
      <div className="pane-inner">
        <div className="pane-copy">
          <span className="pane-index" aria-hidden>
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="pane-kicker">
            <span className="feat-icon inline">
              <Icon name={f.icon} />
            </span>
            <h3 id={`feat-${index}`}>{f.title}</h3>
          </div>
          <p className="pane-lead">{f.lead}</p>
          <p className="pane-body">{f.body}</p>
        </div>
        <div className="pane-visual" aria-hidden>
          <PaneVisual label={f.visual.label} lines={f.visual.lines} />
        </div>
      </div>
    </section>
  );
}

function PaneVisual({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div className="pane-frame">
      <div className="pane-frame-chrome">
        <span />
        <span />
        <span />
        <em>{label}</em>
      </div>
      <ul className="pane-frame-lines">
        {lines.map((line) => (
          <li key={line}>
            <code>{line}</code>
          </li>
        ))}
      </ul>
      <div className="pane-frame-glow" />
    </div>
  );
}

/* =============================================================== how it works */

const STEPS = [
  {
    n: "01",
    title: "Connect your organization",
    lead: "Stand up an org, a guardian key, and a funded vault.",
    body: "Create the organization, issue a guardian credential, and fund the vault with USDC. Coinbase CDP holds custody — you are not wiring private keys into app configs or agent prompts.",
    visual: {
      label: "Org bootstrap",
      lines: ["org  demo-corp", "guardian  gsk_…", "vault  +$1,000 USDC"],
    },
  },
  {
    n: "02",
    title: "Create AI agents",
    lead: "Each agent gets an API key and its own stipend account.",
    body: "Spin agents from the console, then drop the key into Python, Node, or MCP. Identity and balance are per-agent from the first call, so spend attribution is not a later cleanup project.",
    visual: {
      label: "New agent",
      lines: ["name  research-bot", "key  agk_…", "stipend  $100"],
    },
  },
  {
    n: "03",
    title: "Assign budget & policy",
    lead: "Caps, ceilings, thresholds, and allowlists — tested before they bite.",
    body: "Set daily caps, per-payment ceilings, approval thresholds, and host allowlists. Run the simulator against real-looking intents so production is the second place a rule fires, not the first.",
    visual: {
      label: "Policy draft",
      lines: ["cap  $200 / day", "HITL  > $25", "allow  *.openai.com"],
    },
  },
  {
    n: "04",
    title: "Agents complete paid tasks",
    lead: "Pay verbs hit policy first, then signer, then Base.",
    body: "Agents call pay verbs; the policy engine authorizes, the CDP wallet signs, and USDC settles on Base. Holds, refunds, and denials all land in the same journal you can export.",
    visual: {
      label: "Live payment",
      lines: ["intent  allowed", "sign  CDP", "settle  Base · USDC"],
    },
  },
];

function HowItWorks() {
  const lead = STEPS.slice(0, 2);
  const pair = STEPS.slice(2, 4);
  return (
    <div id="how" className="pane-stack how">
      <section className="section pane-intro">
        <SectionHead
          eyebrow="How it works"
          title="From zero to a paying agent in four steps"
          sub="No smart contracts to deploy. No keys for your agents to leak. Scroll the first two steps full-bleed, then the last two side by side."
        />
      </section>
      {lead.map((s, i) => (
        <section
          key={s.n}
          className={`pane-block ${i % 2 === 1 ? "pane-flip" : ""}`}
          aria-labelledby={`step-${s.n}`}
        >
          <div className="pane-inner">
            <div className="pane-copy">
              <span className="pane-index accent" aria-hidden>
                {s.n}
              </span>
              <h3 id={`step-${s.n}`}>{s.title}</h3>
              <p className="pane-lead">{s.lead}</p>
              <p className="pane-body">{s.body}</p>
            </div>
            <div className="pane-visual" aria-hidden>
              <PaneVisual label={s.visual.label} lines={s.visual.lines} />
            </div>
          </div>
        </section>
      ))}
      <section className="pane-pair how-pair" aria-label="Policy and paid tasks">
        {pair.map((s) => (
          <section key={s.n} className="pane-block pane-compact" aria-labelledby={`step-${s.n}`}>
            <div className="pane-inner pane-inner-stack">
              <div className="pane-copy">
                <span className="pane-index accent" aria-hidden>
                  {s.n}
                </span>
                <h3 id={`step-${s.n}`}>{s.title}</h3>
                <p className="pane-lead">{s.lead}</p>
                <p className="pane-body">{s.body}</p>
              </div>
              <div className="pane-visual" aria-hidden>
                <PaneVisual label={s.visual.label} lines={s.visual.lines} />
              </div>
            </div>
          </section>
        ))}
      </section>
    </div>
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
