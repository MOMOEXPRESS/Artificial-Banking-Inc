"use client";

import Link from "next/link";
import {
  ArrowRight, ArrowUpRight, Bot, Check, ChevronRight, CircleDollarSign,
  Code2, Database, LockKeyhole, Search, Server, ShieldCheck, Store,
  Workflow, Zap
} from "lucide-react";
import { MarketingShell } from "../lib/marketing-shell";
import styles from "./marketplace-home.module.css";

const examples = [
  { icon: Database, category: "DATA", title: "Market intelligence", description: "Structured datasets and research endpoints for autonomous workflows.", tag: "Example listing", mark: "01" },
  { icon: Server, category: "COMPUTE", title: "On-demand inference", description: "Model and compute services your agents could use as needed.", tag: "Example listing", mark: "02" },
  { icon: Code2, category: "APIS", title: "Developer services", description: "Paid tools, APIs, and software capabilities accessible to agents.", tag: "Example listing", mark: "03" },
];

const flow = [
  { num: "01", title: "Discover", description: "Find the right service for a task, from APIs and data to computing resources." },
  { num: "02", title: "Decide", description: "Check what is offered and whether the purchase fits your agent's budget and rules." },
  { num: "03", title: "Pay", description: "Use x402-enabled payments, with policy checks and human approval when required." },
  { num: "04", title: "Continue", description: "Receive the service and keep a clear record of the transaction." },
];

function ActionLink({ href, children, secondary = false }: { href: string; children: React.ReactNode; secondary?: boolean }) {
  return (
    <Link className={secondary ? styles.secondaryAction : styles.primaryAction} href={href}>
      {children}<ArrowUpRight size={17} strokeWidth={1.8} aria-hidden="true" />
    </Link>
  );
}

function MarketPreview() {
  return (
    <div className={styles.preview} aria-label="Illustrative preview of a future ABI agent marketplace">
      <div className={styles.previewBar}>
        <div className={styles.previewBrand}><span className={styles.previewBrandIcon}>A</span> ABI <span className={styles.previewSlash}>/</span> Marketplace</div>
        <span className={styles.previewDemo}>CONCEPT PREVIEW</span>
      </div>
      <div className={styles.previewHeading}>
        <div><span className={styles.microLabel}>AGENT MARKETPLACE</span><h2>Find what your agent needs.</h2></div>
        <span className={styles.previewCount}>01 / DISCOVER</span>
      </div>
      <div className={styles.previewSearch}><Search size={16} aria-hidden="true" /> Search tools, data, APIs, compute <span>⌘ K</span></div>
      <div className={styles.previewFilters}><span className={styles.filterActive}>All services</span><span>APIs</span><span>Data</span><span>Compute</span></div>
      <div className={styles.previewListings}>
        {examples.map(({icon: Icon, category, title, description, tag, mark}) => (
          <div key={title} className={styles.listing}>
            <div className={styles.listingTop}><span className={styles.listingIcon}><Icon size={20} strokeWidth={1.5} aria-hidden="true" /></span><span className={styles.listingIndex}>{mark}</span></div>
            <span className={styles.listingCategory}>{category}</span>
            <h3>{title}</h3>
            <p>{description}</p>
            <div className={styles.listingFoot}><span>{tag}</span><ArrowUpRight size={16} aria-hidden="true" /></div>
          </div>
        ))}
      </div>
      <p className={styles.previewDisclaimer}>Illustrative marketplace categories, not currently available inventory or live offers.</p>
    </div>
  );
}

export default function HomePage() {
  return (
    <MarketingShell active="home">
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroGrid}>
            <div className={styles.heroContent}>
              <span className={styles.eyebrow}><span className={styles.signal} /> THE COMMERCE LAYER FOR AI AGENTS</span>
              <h1>The marketplace for <em>agents that get things done.</em></h1>
              <p className={styles.heroLead}>AI agents can do more than answer questions. They need access to services, data, and tools to complete real work. ABI is building the marketplace where they can find, choose, and pay for what they need.</p>
              <div className={styles.actions}>
                <ActionLink href="/waitlist?ref=marketplace-home">Get early access</ActionLink>
                <ActionLink href="/partnerships" secondary>Sell on ABI</ActionLink>
              </div>
              <p className={styles.heroStatus}><ShieldCheck size={15} aria-hidden="true" /> Marketplace in development. Payments are currently demonstrated on Base Sepolia testnet.</p>
            </div>
            <div className={styles.heroAside} aria-hidden="true">
              <div className={styles.orb}>
                <div className={styles.orbitOne} /><div className={styles.orbitTwo} />
                <span className={styles.orbCore}><Bot size={38} strokeWidth={1.3} /></span>
                <span className={styles.orbitNode + " " + styles.nodeOne}><Database size={22} /></span>
                <span className={styles.orbitNode + " " + styles.nodeTwo}><Server size={22} /></span>
                <span className={styles.orbitNode + " " + styles.nodeThree}><CircleDollarSign size={22} /></span>
              </div>
              <div className={styles.asideFoot}><span>ONE NETWORK</span><span>ENDLESS POSSIBILITIES</span></div>
            </div>
          </div>
        </section>

        <section id="marketplace" className={styles.marketSection}>
          <div className={styles.sectionHeading}>
            <div><span className={styles.kicker}>01 / THE MARKETPLACE</span><h2>Everything an agent needs.<br /><em>One place to find it.</em></h2></div>
            <p>From a paid API call to specialized datasets and compute, ABI is designed to connect autonomous buyers with businesses that serve them.</p>
          </div>
          <MarketPreview />
          <div className={styles.marketBottom}><span>Built for machine-to-machine commerce.</span><Link href="/partnerships">Explore seller opportunities <ArrowRight size={16} aria-hidden="true" /></Link></div>
        </section>

        <section className={styles.audienceSection}>
          <div className={styles.sectionHeading}><div><span className={styles.kicker}>02 / ONE MARKETPLACE, TWO SIDES</span><h2>Built for the buyers.<br /><em>And the builders.</em></h2></div></div>
          <div className={styles.audienceGrid}>
            <article className={styles.audienceCard}>
              <div className={styles.audienceTop}><Bot size={27} strokeWidth={1.5} /><span>FOR DEVELOPERS & AGENTS</span></div>
              <h3>Give your agents the ability to buy.</h3>
              <p>Connect your agent to a growing ecosystem of services. Discover the right capabilities, request payments, and keep spending within defined limits.</p>
              <Link href="/docs">Explore the developer docs <ArrowUpRight size={18} aria-hidden="true" /></Link>
              <span className={styles.audienceWatermark}>BUY</span>
            </article>
            <article className={styles.audienceCard + " " + styles.sellerCard}>
              <div className={styles.audienceTop}><Store size={27} strokeWidth={1.5} /><span>FOR BUSINESSES & PROVIDERS</span></div>
              <h3>Make your services available to AI.</h3>
              <p>Position APIs, data, compute, and digital services for a new kind of customer: software agents that discover and purchase on behalf of people.</p>
              <Link href="/partnerships">Become a seller <ArrowUpRight size={18} aria-hidden="true" /></Link>
              <span className={styles.audienceWatermark}>SELL</span>
            </article>
          </div>
        </section>

        <section id="how-it-works" className={styles.howSection}>
          <div className={styles.sectionHeading}><div><span className={styles.kicker}>03 / HOW IT WORKS</span><h2>From intention<br /><em>to transaction.</em></h2></div><p>A simpler path from what an agent needs to what it can actually use. The marketplace discovery experience is planned; the policy engine and testnet payment path already exist.</p></div>
          <div className={styles.steps}>
            {flow.map((step) => <div className={styles.step} key={step.num}><span className={styles.stepNum}>{step.num}</span><h3>{step.title}</h3><p>{step.description}</p><ChevronRight size={19} className={styles.stepArrow} aria-hidden="true" /></div>)}
          </div>
        </section>

        <section id="trust" className={styles.trustSection}>
          <div className={styles.trustCopy}><span className={styles.kicker}>04 / BUILT-IN CONTROL</span><h2>Freedom to act.<br /><em>Rules that protect.</em></h2><p>A marketplace is only useful if you can trust what your agents do. ABI&apos;s existing policy infrastructure gives organizations control over agent spending, approvals, and transaction history.</p><ActionLink href="/console">Explore the testnet console</ActionLink></div>
          <div className={styles.controlPanel}>
            <div className={styles.controlHead}><span>POLICY CHECK / ILLUSTRATIVE</span><ShieldCheck size={22} /></div>
            <div className={styles.controlPayment}><span>Agent purchase request</span><strong>$12.00 <small>USDC</small></strong></div>
            <div className={styles.controlRows}>
              <div><Check size={16} /><span>Within assigned budget</span><b>PASS</b></div>
              <div><Check size={16} /><span>Approved service category</span><b>PASS</b></div>
              <div><LockKeyhole size={16} /><span>Human approval threshold</span><b>REVIEW</b></div>
            </div>
            <div className={styles.controlResult}><span className={styles.resultPulse} /> Held for human approval <span>→</span></div>
            <p>Example policy decision. Not a live transaction.</p>
          </div>
        </section>

        <section className={styles.railSection}>
          <span className={styles.kicker}>THE PAYMENT FOUNDATION</span>
          <div className={styles.railGrid}>
            <div><Zap size={20}/><strong>x402</strong><span>Internet-native payment protocol</span></div>
            <div><CircleDollarSign size={20}/><strong>USDC</strong><span>Stablecoin-denominated payments</span></div>
            <div><Workflow size={20}/><strong>Base Sepolia</strong><span>Testnet payment proof</span></div>
            <div><ShieldCheck size={20}/><strong>Policy engine</strong><span>Budget and approval controls</span></div>
          </div>
          <p>These describe technology and implementation, not endorsements or commercial partnerships.</p>
        </section>

        <section className={styles.finalCta}>
          <div><span className={styles.kicker}>THE NEXT GENERATION OF COMMERCE</span><h2>The internet was built for people.<br /><em>We&apos;re building for their agents.</em></h2><p>Get early access as ABI expands from agent payments into marketplace discovery and commerce.</p></div>
          <div className={styles.finalActions}><ActionLink href="/waitlist?ref=marketplace-footer">Join the waitlist</ActionLink><ActionLink href="/partnerships" secondary>List your service</ActionLink></div>
        </section>
      </main>
    </MarketingShell>
  );
}
