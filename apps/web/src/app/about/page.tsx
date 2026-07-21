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
            sub="The financial operating system for AI agents — authorization, custody, and settlement without handing keys to a model."
          />
          <div className="mkt-prose mkt-prose-wide about-lede">
            <p>
              Agents are already booking APIs, buying data, and negotiating services. What they
              lack is a bank-grade control plane: stipends, policies, human-in-the-loop, and an
              immutable journal when something goes wrong.
            </p>
            <p>
              ABI sits between the model and the money. The LLM may propose a payment; a
              deterministic policy engine and a professional signer decide whether it happens.
              Keys never enter the prompt.
            </p>
          </div>
        </div>

        <div className="pane-stack about-panes">
          <AboutPane
            n="01"
            title="What we are"
            lead="An authorization layer and treasury for autonomous spend."
            body="Wallets, policies, approvals, x402 rails, and audit. Operators fund a vault, push stipends to agents, and set the rules those agents must clear before a cent moves. Settlement is USDC on Base; custody can sit on Coinbase CDP so private keys stay out of your app and out of the model."
            flip={false}
            src="/about/we-are.png"
            alt="AB vault mark with propose, authorize, and settle symbols"
          />
          <AboutPane
            n="02"
            title="What we are not"
            lead="Not a bank. Not a trading wallet. Not a chat that moves money."
            body="Not a consumer bank. Not FDIC insured. Not a crypto trading wallet. Not an LLM that interprets free-text money intents. We do not hold retail deposits, and we do not ask you to trust a chat transcript as your ledger of record."
            flip
            src="/about/we-are-not.png"
            alt="Bank and chat icons cancelled by a prohibition mark"
          />
          <AboutPane
            n="03"
            title="How we build"
            lead="One money spine — intent, policy, custody, settle, journal."
            body="Extension points for compliance and notifications. Ship what fits today without blocking the next pillars: more rails, richer approvals, deeper analytics. The path agents take to spend should stay the same even as the surface around it grows."
            flip={false}
            src="/about/how-we-build.png"
            alt="Person building at a laptop on a clean desk"
          />
          <AboutPane
            n="04"
            title="Who it is for"
            lead="Teams that want agents to spend — under budget, with a human still able to park large spends."
            body="If you need a playground today and production rails when agents earn their keep, that is the path we designed for. Guardians set policy. Agents call the same API your production fleet will use."
            flip
            src="/about/who-for.png"
            alt="Operators reviewing a shared spend-control card"
          />
        </div>

        <div className="mkt-page-inner">
          <div className="mkt-doc-cta">
            <Link className="btn-primary" href="/console">
              Launch console <Icon name="arrowRight" size={14} />
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
