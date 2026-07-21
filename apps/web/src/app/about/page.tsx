"use client";

import Link from "next/link";
import { MarketingShell, SectionHead } from "../../lib/marketing-shell";
import { Icon } from "../../lib/ui";

export default function AboutPage() {
  return (
    <MarketingShell active="about">
      <section className="mkt-page">
        <div className="mkt-page-inner mkt-about">
          <SectionHead
            eyebrow="About"
            title="Artificial Banking Incorporated"
            sub="The financial operating system for AI agents — authorization, custody, and settlement without handing keys to a model."
          />

          <div className="mkt-prose mkt-prose-wide">
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

            <h3>What we are</h3>
            <p>
              An authorization layer and treasury for autonomous spend — wallets, policies,
              approvals, x402 rails, and audit. Operators fund a vault, push stipends to agents,
              and set the rules those agents must clear before a cent moves. Settlement is USDC on
              Base; custody can sit on Coinbase CDP so private keys stay out of your app and out of
              the model.
            </p>

            <h3>What we are not</h3>
            <p>
              Not a consumer bank. Not FDIC insured. Not a crypto trading wallet. Not an LLM that
              interprets free-text money intents. We do not hold retail deposits, and we do not ask
              you to trust a chat transcript as your ledger of record.
            </p>

            <h3>How we build</h3>
            <p>
              One money spine — intent, policy, custody, settle, journal — with extension points for
              compliance and notifications. Ship what fits today without blocking the next pillars:
              more rails, richer approvals, deeper analytics. The path agents take to spend should
              stay the same even as the surface around it grows.
            </p>

            <h3>Who it is for</h3>
            <p>
              Teams that want AI agents to buy APIs and data under budget, with a human still able
              to park large spends. If you need a playground today and production rails when agents
              earn their keep, that is the path we designed for.
            </p>
          </div>

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
