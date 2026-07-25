"use client";

import Image from "next/image";
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
      <HomeInterstitial
        eyebrow="Company money → rules → agent wallet"
        title="Check the rules first. Move the money second."
        body="You keep company funds in a vault. Agents only get what you give them. Nothing leaves until it clears your spending rules."
        src="/home/interstitial-vault.png"
        alt="Vault, policy shield, and wallet connected in sequence"
      />
      <ProductTour />
      <HowItWorks />
      <Enterprise />
      <HomeInterstitial
        eyebrow="Approve → unlock → receipt"
        title="You stay in the loop on anything big."
        body="Set a dollar limit. Over that, payments wait for a person. Approve or deny, and the record stays with the payment — not buried in a chat log."
        src="/home/interstitial-approve.png"
        alt="Approval stamp, key, and receipt connected in sequence"
        flip
      />
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
            <span className="dot" /> Money controls for AI that can spend
          </span>
          <h1>
            Let AI agents pay for things — <em>without losing control.</em>
          </h1>
          <p className="hero-sub">
            Artificial Banking Incorporated sits between your AI and your money.
            Each agent gets its own wallet and budget. You set the rules. Anything
            large waits for a person. Payments settle in USDC on Base.
          </p>
          <div className="hero-ctas">
            <Link className="btn-primary" href="/console">
              Open the console <Icon name="arrowRight" size={14} />
            </Link>
            <Link className="btn-ghost" href="/console?demo=1">
              <Icon name="play" size={14} /> Try the live demo
            </Link>
          </div>
          <div className="hero-meta">
            <div>
              <b>Base + USDC</b>
              <span>where payments settle</span>
            </div>
            <div className="sep" />
            <div>
              <b>x402</b>
              <span>pay APIs automatically</span>
            </div>
            <div className="sep" />
            <div>
              <b>Coinbase CDP</b>
              <span>holds the keys for you</span>
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
                <p className="meta">ops-bot paid $1.20 · api.openai.com</p>
                <div className="hero-console-pills">
                  <i className="ok">allowed</i>
                  <i className="warn">awaiting</i>
                  <i>$45 pending</i>
                </div>
              </div>
              <div className="hero-console-card">
                <div className="row">
                  <span className="title">Move funds</span>
                  <span className="meta">you</span>
                </div>
                <p className="meta">Deposit · Withdraw · Give an agent budget — rules checked first.</p>
              </div>
            </div>
          </div>
        </div>
        <div className="chip-float chip-a">
          <span className="pill ok">
            <i /> allowed
          </span>
          <span className="mono">$1.20 · paid</span>
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
          <span className="mono">not on allowlist</span>
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
    { label: "Rule check", value: "~0ms", sub: "in the mock rail" },
    { label: "Approval ping", value: "55ms", sub: "local median" },
    { label: "Console pages", value: "10", sub: "money, agents, records" },
    { label: "Demo missions", value: "7", sub: "real API calls, real ledger" },
  ];
  return (
    <section className="metrics-band section tight">
      <div className="metrics-band-inner">
        <div className="metrics-strip">
          {metrics.map((m) => (
            <div key={m.label} className="metric-inline">
              <span className="metric-label">{m.label}</span>
              <strong className="metric-value">{m.value}</strong>
              <span className="metric-sub">{m.sub}</span>
            </div>
          ))}
        </div>
        <div className="home-float-token" aria-hidden>
          <Image
            src="/home/accent-token.png"
            alt=""
            width={112}
            height={112}
            className="home-float-token-img"
            priority={false}
          />
        </div>
      </div>
    </section>
  );
}

function HomeInterstitial({
  eyebrow,
  title,
  body,
  src,
  alt,
  flip,
}: {
  eyebrow: string;
  title: string;
  body: string;
  src: string;
  alt: string;
  flip?: boolean;
}) {
  return (
    <section
      className={`home-interstitial ${flip ? "is-flip" : ""}`}
      aria-label={title}
    >
      <div className="home-interstitial-inner">
        <div className="home-interstitial-copy">
          <span className="eyebrow">
            <span className="dot" /> {eyebrow}
          </span>
          <h2>{title}</h2>
          <p>{body}</p>
        </div>
        <div className="home-interstitial-art">
          <Image
            src={src}
            alt={alt}
            width={1200}
            height={675}
            className="home-interstitial-img"
            sizes="(max-width: 900px) 100vw, 720px"
          />
        </div>
      </div>
    </section>
  );
}

const PRODUCT_FRAMES = [
  {
    title: "Overview",
    sub: "Vault balance, agents, and money moves in one place.",
    chips: ["$12.4k vault", "8 agents", "2 approvals"],
  },
  {
    title: "Approvals",
    sub: "Payments on hold — tap approve or deny.",
    chips: ["$45 waiting", "needs you", "Telegram too"],
  },
  {
    title: "Policy simulator",
    sub: "Try your limits before agents spend for real.",
    chips: ["allowlist", "daily cap", "quiet hours"],
  },
];

function ProductTour() {
  return (
    <section id="product" className="section product-tour">
      <SectionHead
        eyebrow="Inside the console"
        title="Peek at the product before you sign in"
        sub="Three screens people actually use — balances, approvals, and testing your rules."
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
          Open the console <Icon name="arrowRight" size={14} />
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
    title: "A wallet per agent",
    lead: "Each agent gets its own budget — not one shared company card.",
    body: "You fund the company vault once, then hand each agent what it can spend. Freeze one agent without stopping the rest. Balances and history stay attached to that agent.",
    visual: {
      label: "Budget · ops-bot",
      lines: ["Available  $420.00", "On hold    $12.40", "Spent today  $38.10"],
    },
  },
  {
    icon: "sliders",
    title: "Spending rules",
    lead: "Daily caps, allowed sites, quiet hours — rules the AI cannot talk its way around.",
    body: "Change the rules live, and test them in the simulator before anything real goes out. The same checks run on every payment attempt.",
    visual: {
      label: "Rule check",
      lines: ["daily cap  $500  → ok", "site  api.openai.com  → ok", "quiet hours  02:00  → hold"],
    },
  },
  {
    icon: "check",
    title: "Human approvals",
    lead: "Past your limit, money waits until someone says yes.",
    body: "Approve from the console, chat, or Telegram. Allows and denials go in the same record, so you can see who said what — without digging through chat history.",
    visual: {
      label: "Waiting on you",
      lines: ["$45.00  api.openai.com", "limit  $25", "via  Telegram · console"],
    },
  },
  {
    icon: "swap",
    title: "Pay APIs automatically",
    lead: "Agents can pay services that charge per call — still under your rules.",
    body: "We speak x402, the machine-payment standard. Rules still run first. When a payment clears, it settles as USDC on Base.",
    visual: {
      label: "API payment",
      lines: ["seller  data.example", "paid  $1.20 of $5", "rail  Base · USDC"],
    },
  },
  {
    icon: "list",
    title: "A full money record",
    lead: "Every try, block, approval, and payment is written down.",
    body: "Export to CSV or send signed webhooks to your tools. When finance asks what an agent spent last Tuesday, you have receipts — not a chat transcript.",
    visual: {
      label: "Journal",
      lines: ["pay attempt  allowed", "hold  $1.20  → settled", "export  CSV · webhook"],
    },
  },
  {
    icon: "shield",
    title: "Keys stay out of the AI",
    lead: "The model can ask to spend. It never holds the wallet.",
    body: "Coinbase CDP (or your signer) moves the money. A kill switch can stop work in flight. Custody stays outside the prompt.",
    visual: {
      label: "Who does what",
      lines: ["AI  asks only", "rules  decide", "signer  moves money"],
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
          eyebrow="What you get"
          title="Wallets, rules, and a paper trail for AI spend"
          sub="Give agents money they can use — with limits you set, approvals when it matters, and a record you can show finance."
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
    title: "Set up your organization",
    lead: "Create an org, get a guardian key, and put money in the vault.",
    body: "The guardian key is how you (a person) open the console. Coinbase CDP can hold the vault keys — you are not pasting private keys into agent configs or chat prompts.",
    visual: {
      label: "Org setup",
      lines: ["org  demo-corp", "guardian  pv_guardian_…", "vault  +$1,000 USDC"],
    },
  },
  {
    n: "02",
    title: "Create AI agents",
    lead: "Each agent gets an API key and its own spending account.",
    body: "Create agents in the console, then put the key in your Python, Node, or MCP setup. From the first call, spend is tied to that agent — so you always know who spent what.",
    visual: {
      label: "New agent",
      lines: ["name  research-bot", "key  pv_agent_…", "budget  $100"],
    },
  },
  {
    n: "03",
    title: "Set budgets and rules",
    lead: "Caps, per-payment limits, approval thresholds, and allowed sites.",
    body: "Run the simulator with sample payments first. Better to learn a rule fires in the sandbox than after real money moved.",
    visual: {
      label: "Rules draft",
      lines: ["cap  $200 / day", "ask me  > $25", "allow  *.openai.com"],
    },
  },
  {
    n: "04",
    title: "Agents pay for work",
    lead: "They ask to pay. Rules check. Then money moves on Base.",
    body: "Holds, refunds, and blocks all land in one journal you can export. Same path every time — whether the amount is $1 or $100.",
    visual: {
      label: "Live payment",
      lines: ["ask  allowed", "sign  CDP", "settle  Base · USDC"],
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
          title="From zero to an agent that can pay — in four steps"
          sub="No smart contracts to write. Agents never get the vault keys. Scroll the first two steps, then the last two side by side."
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
    title: "Who can spend",
    body: "Roles for people, more than one approver when you need it, and fresh keys per agent.",
  },
  {
    icon: "clock",
    title: "Budgets you can defend",
    body: "We re-check the books often and flag you if a cent does not match.",
  },
  {
    icon: "list",
    title: "Complete audit trail",
    body: "Every decision, rule, and receipt is stored. Export CSV or stream signed webhooks.",
  },
  {
    icon: "check",
    title: "Approval workflows",
    body: "Send large spends to a person, Telegram, or a chat channel — with a hard ceiling above that.",
  },
  {
    icon: "zap",
    title: "Safe by default",
    body: "The AI asks. Fixed rules decide. A separate signer moves the money.",
  },
  {
    icon: "swap",
    title: "Ongoing payments",
    body: "Subscriptions, agent-to-agent holds, refunds — all still go through the same rules.",
  },
];

function Enterprise() {
  return (
    <section id="enterprise" className="section enterprise">
      <SectionHead
        eyebrow="For teams"
        title="Controls that hold up when more than one person is watching"
        sub="Because the first surprise AI bill is the one nobody forgets."
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
