"use client";

import Image from "next/image";
import Link from "next/link";
import { MarketingCta, MarketingShell, SectionHead } from "../lib/marketing-shell";
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
      <ChatGPTIntegrationBand />
      <Features />
      <HomeInterstitial
        eyebrow="Company money → rules → agent wallet"
        title="Check the rules first. Move the money second."
        body="You keep company funds in a vault. Agents only get what you give them. Nothing leaves until it clears your spending rules."
        src="/home/interstitial-vault.webp"
        alt="Vault, policy shield, and wallet connected in sequence"
      />
      <ProductTour />
      <HowItWorks />
      <Enterprise />
      <HomeInterstitial
        eyebrow="Approve → unlock → receipt"
        title="You stay in the loop on anything big."
        body="Set a dollar limit. Over that, payments wait for a person. Approve or deny, and the record stays with the payment — not buried in a chat log."
        src="/home/interstitial-approve.webp"
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
    <section className="hero abi-hero">
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
            Give your agents a budget, not unlimited access. ABI checks each payment against your
            rules, asks for approval when needed, and keeps a record of every decision.
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
              <b>Rail-aware</b>
              <span>simulation, testnet, or live</span>
            </div>
            <div className="sep" />
            <div>
              <b>x402</b>
              <span>pay APIs automatically</span>
            </div>
            <div className="sep" />
            <div>
              <b>Policy engine</b>
              <span>checks every payment first</span>
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

/** Original CSS scene: no copied video, no external runtime or video download. */
function HeroGraphic() {
  return (
    <div
      className="abi-control-scene"
      role="img"
      aria-label="ABI checks agent payment requests against budget and policy before authorizing payment and recording the result."
    >
      <div className="abi-orbit orbit-one" aria-hidden />
      <div className="abi-orbit orbit-two" aria-hidden />
      <div className="abi-cube-stage" aria-hidden>
        <div className="abi-cube">
          {["front", "back", "left", "right", "top", "bottom"].map((face) => (
            <div key={face} className={`cube-face cube-${face}`}>
              <span>ABI</span>
              <small>CONTROL LAYER</small>
            </div>
          ))}
        </div>
      </div>
      <div className="abi-scene-tag scene-request">
        <span>01 / REQUEST</span>
        <b>Research API · $2.40</b>
      </div>
      <div className="abi-scene-tag scene-policy">
        <span>02 / POLICY</span>
        <b>Within approved budget</b>
        <i>ALLOW</i>
      </div>
      <div className="abi-scene-tag scene-record">
        <span>03 / RECORD</span>
        <b>Decision + payment receipt</b>
      </div>
      <span className="abi-scene-caption">ILLUSTRATIVE PAYMENT FLOW</span>
    </div>
  );
}

function TrustStrip() {
  return (
    <section className="trust-strip">
      <span>Built on</span>
      <div className="trust-logos partner-logos">
        <PartnerLogo abbr="BASE">Base</PartnerLogo>
        <PartnerLogo abbr="USDC">USDC</PartnerLogo>
        <PartnerLogo abbr="x402">x402</PartnerLogo>
        <PartnerLogo abbr="712">EIP-712</PartnerLogo>
      </div>
    </section>
  );
}

/** Connection targets are explicitly separated from verified availability. */
function ChatGPTIntegrationBand() {
  return (
    <section className="abi-ecosystem" aria-labelledby="agent-connection-title">
      <div className="abi-ecosystem-heading">
        <span className="eyebrow">YOUR AGENT. YOUR RULES.</span>
        <h2 id="agent-connection-title">
          One control layer.
          <br />
          More ways to connect.
        </h2>
        <p>
          ABI is designed around agent identities and API access, rather than one AI model. Connect
          software through REST or MCP, with a budget and an audit trail behind every request.
        </p>
      </div>
      <div className="abi-model-grid">
        <div className="abi-model">
          <ChatGPTMark />
          <h3>ChatGPT</h3>
          <span>Sandbox MCP available</span>
        </div>
        <div className="abi-model">
          <Image src="/ecosystem/claude.svg" width={106} height={32} alt="Claude" />
          <h3>Claude / Claude Code</h3>
          <span>Planned client integration</span>
        </div>
        <div className="abi-model">
          <Image src="/ecosystem/grok.svg" width={90} height={32} alt="Grok" />
          <h3>Grok</h3>
          <span>Planned client integration</span>
        </div>
        <div className="abi-model">
          <span className="abi-code-mark" aria-hidden>
            &lt;/&gt;
          </span>
          <h3>Your own agent</h3>
          <span>REST API + TypeScript SDK</span>
        </div>
      </div>
      <div className="abi-rails">
        <div>
          <span className="eyebrow">RAILS TODAY</span>
          <p>USDC · Base Sepolia · x402</p>
          <small>Testnet demonstrated. Live settlement requires a configured provider.</small>
        </div>
        <div>
          <span className="eyebrow">ECOSYSTEM EXPLORATION</span>
          <div className="abi-rail-logos">
            {["Ethereum", "Solana", "Bitcoin", "Phantom"].map((name) => (
              <span key={name}>
                <Image src={`/ecosystem/${name.toLowerCase()}.svg`} width={24} height={24} alt="" />
                {name}
              </span>
            ))}
          </div>
          <small>
            Future possibilities, not supported integrations. Phantom is a wallet; the others are
            networks.
          </small>
        </div>
      </div>
      <Link className="btn-ghost" href="/docs#chatgpt">
        Explore connection guides <Icon name="arrowRight" size={14} />
      </Link>
    </section>
  );
}

function ChatGPTMark() {
  return (
    <svg viewBox="0 0 24 24" className="chatgpt-integration-logo" aria-hidden="true">
      {/* Monochrome ChatGPT/OpenAI mark, used only to identify the supported connector. */}
      <path
        fill="currentColor"
        d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
      />
    </svg>
  );
}

function PartnerLogo({ children, abbr }: { children: React.ReactNode; abbr: string }) {
  return (
    <span className="partner-logo" title={String(children)}>
      <svg className="partner-svg" viewBox="0 0 40 40" width="28" height="28" aria-hidden>
        <rect
          x="2"
          y="2"
          width="36"
          height="36"
          rx="0"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
        />
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
            src="/home/accent-token.webp"
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
    <section className={`home-interstitial ${flip ? "is-flip" : ""}`} aria-label={title}>
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
    title: "A budget per agent",
    lead: "Each agent gets a governed allowance from the organization vault.",
    body: "You fund the organization vault, then assign each agent a spending budget. Freeze one agent without stopping the rest. Balances and history stay attached to that agent; the budget is not a separate wallet or custody account.",
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
    body: "ABI supports x402 machine payments. Rules run first. The configured rail determines whether an action is simulated, sent on testnet, or eligible for live settlement.",
    visual: {
      label: "API payment",
      lines: ["seller  data.example", "requested  $1.20 of $5", "rail  sandbox · sample USDC"],
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
    body: "The model requests an action; ABI policy decides whether it can proceed. In the current self-custody mode, signing keys are held by the application. Coinbase CDP custody is not yet connected. A freeze can block further work.",
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
    body: "The guardian key is how you (a person) open the console. The vault keeps its own signing key — you are not pasting private keys into agent configs or chat prompts.",
    visual: {
      label: "Org setup",
      lines: ["org  demo-corp", "guardian  gsk_…", "vault  +$1,000 USDC"],
    },
  },
  {
    n: "02",
    title: "Create AI agents",
    lead: "Each agent gets an API key and its own spending account.",
    body: "Create agents in the console, then put the key in your Python, Node, or MCP setup. From the first call, spend is tied to that agent — so you always know who spent what.",
    visual: {
      label: "New agent",
      lines: ["name  research-bot", "key  agk_…", "budget  $100"],
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
      lines: ["ask  allowed", "sign  vault", "settle  Base · USDC"],
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
    body: "The AI asks. ABI policy decides. The current signer is application-managed self-custody.",
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
