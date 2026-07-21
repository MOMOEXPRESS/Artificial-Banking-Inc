"use client";

import Link from "next/link";
import { ABLockup } from "../../lib/brand";
import { MarketingShell, SectionHead } from "../../lib/marketing-shell";
import { Icon } from "../../lib/ui";

export default function AboutPage() {
  return (
    <MarketingShell active="about">
      <section className="mkt-page">
        <div className="mkt-page-inner mkt-about">
          <div className="mkt-about-hero">
            <ABLockup size={96} tone="#0a0a0c" />
            <SectionHead
              eyebrow="About"
              title="Artificial Banking Incorporated"
              sub="The financial operating system for AI agents — authorization, custody, and settlement without handing keys to a model."
            />
          </div>

          <div className="mkt-prose">
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

          <div className="mkt-card-row">
            <article className="mkt-card">
              <h3>What we are</h3>
              <p>
                An authorization layer and treasury for autonomous spend — wallets, policies,
                approvals, x402 rails, and audit.
              </p>
            </article>
            <article className="mkt-card">
              <h3>What we are not</h3>
              <p>
                Not a consumer bank. Not FDIC insured. Not a crypto trading wallet. Not an LLM
                that interprets free-text money intents.
              </p>
            </article>
            <article className="mkt-card">
              <h3>How we build</h3>
              <p>
                One money spine. Extension points for custody, compliance, and notifications.
                Ship what fits today without blocking the next thirteen pillars.
              </p>
            </article>
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
