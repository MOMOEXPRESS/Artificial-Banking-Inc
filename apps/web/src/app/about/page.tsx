"use client";

import Image from "next/image";
import Link from "next/link";
import { MarketingShell, SectionHead } from "../../lib/marketing-shell";
import { LandingMotion } from "../../lib/landing-motion";
import { Icon } from "../../lib/ui";

/**
 * About — alternating copy/visual pans with clean generated illustrations
 * (not console chrome, not sketch SVGs).
 */
export default function AboutPage() {
  return (
    <MarketingShell active="about">
      <LandingMotion />
      <section className="mkt-page about-page">
        <div className="mkt-page-inner mkt-about-hero">
          <SectionHead
            eyebrow="About"
            title="Artificial Banking Incorporated"
            sub="We help companies let AI agents spend money — with budgets, approvals, and a clear record — without handing the wallet keys to the AI."
          />
          <div className="mkt-prose mkt-prose-wide about-lede">
            <p>
              AI agents already call APIs, buy data, and book services. What they usually lack is a
              proper money setup: a budget per agent, rules that stop bad spends, a person who can
              approve big ones, and a record when something goes wrong.
            </p>
            <p>
              ABI sits between the AI and the money. The model can ask to pay. Fixed rules and a
              separate signer decide whether it happens. The keys never go into the chat prompt.
            </p>
          </div>
        </div>

        <div className="pane-stack about-panes">
          <AboutPane
            n="01"
            title="What we are"
            lead="A place to hold company funds for agents, set rules, and approve big spends."
            body="Wallets, spending rules, approvals, API payments (x402), and an audit log. You fund a vault, give agents budgets, and set what they must clear before a cent moves. Payments can settle as USDC on Base. The vault holds its own signing key, so keys stay out of your app and out of the model."
            flip={false}
            src="/about/we-are.webp"
            alt="AB vault mark with propose, authorize, and settle symbols"
          />
          <AboutPane
            n="02"
            title="What we are not"
            lead="Not a consumer bank. Not a trading app. Not a chat that moves money."
            body="We are not FDIC insured. We do not hold retail deposits. We are not a crypto trading wallet. We do not treat free-text chat as the way money moves. Your ledger of record is the journal — not a conversation transcript."
            flip
            src="/about/we-are-not.webp"
            alt="Bank and chat icons cancelled by a prohibition mark"
          />
          <AboutPane
            n="03"
            title="How we build"
            lead="One path for money: ask → check rules → move → write it down."
            body="We ship what works today without boxing in what comes next — more payment rails, richer approvals, deeper reports. Agents should keep using the same spend path even as the product grows around it."
            flip={false}
            src="/about/how-we-build.webp"
            alt="Person building at a laptop on a clean desk"
          />
          <AboutPane
            n="04"
            title="Who it is for"
            lead="Teams that want agents to spend — under budget, with a human able to stop large payments."
            body="Start in the playground. Move to production when the agents prove useful. People set the rules. Agents call the same API you will use in production."
            flip
            src="/about/who-for.webp"
            alt="Operators reviewing a shared spend-control card"
          />
        </div>

        <div className="mkt-page-inner">
          <div className="mkt-doc-cta">
            <Link className="btn-primary" href="/console">
              Open the console <Icon name="arrowRight" size={14} />
            </Link>
            <Link className="btn-ghost" href="/docs">
              Read the docs
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

function AboutPane({
  n,
  title,
  lead,
  body,
  flip,
  src,
  alt,
}: {
  n: string;
  title: string;
  lead: string;
  body: string;
  flip?: boolean;
  src: string;
  alt: string;
}) {
  return (
    <section className={`pane-block about-pane ${flip ? "pane-flip" : ""}`} aria-labelledby={`about-${n}`}>
      <div className="pane-inner">
        <div className="pane-copy">
          <span className="pane-index">{n}</span>
          <h3 id={`about-${n}`}>{title}</h3>
          <p className="pane-lead">{lead}</p>
          <p className="pane-body">{body}</p>
        </div>
        <div className="pane-visual about-visual">
          <div className="about-art">
            <Image
              src={src}
              alt={alt}
              width={1536}
              height={1024}
              className="about-art-img"
              sizes="(max-width: 860px) 100vw, 520px"
              priority={n === "01"}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
