"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ABLockup, ABWordmark } from "./brand";
import { Icon } from "./ui";

/** Shared marketing chrome for Landing / Docs / Pricing / About. */

export function MarketingShell({
  children,
  active,
}: {
  children: ReactNode;
  active?: "landing" | "docs" | "pricing" | "about" | "console";
}) {
  return (
    <div className="landing">
      <MarketingNav active={active} />
      {children}
      <MarketingFooter />
    </div>
  );
}

export function MarketingNav({
  active,
}: {
  active?: "landing" | "docs" | "pricing" | "about" | "console";
}) {
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
        <Link href="/" aria-label="Artificial Banking Incorporated home">
          <ABWordmark size={26} tone="#0a0a0c" />
        </Link>
        <nav className="marketing-links">
          <Link href="/" className={active === "landing" ? "is-active" : undefined}>
            Landing
          </Link>
          <Link href="/console" className={active === "console" ? "is-active" : undefined}>
            Console
          </Link>
          <Link href="/docs" className={active === "docs" ? "is-active" : undefined}>
            Docs
          </Link>
          <Link href="/pricing" className={active === "pricing" ? "is-active" : undefined}>
            Pricing
          </Link>
          <Link href="/about" className={active === "about" ? "is-active" : undefined}>
            About
          </Link>
          <a
            href="https://github.com/MOMOEXPRESS/Artificial-Banking-Inc"
            target="_blank"
            rel="noreferrer"
          >
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

export function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <div className="marketing-footer-inner">
        <div className="marketing-footer-brand">
          <ABWordmark size={28} tone="#fff" />
          <p>
            The authorization layer between AI agents and real money. Programmable, auditable and
            enterprise-safe.
          </p>
        </div>
        <div className="marketing-footer-cols">
          <FooterCol
            title="Product"
            links={[
              ["Landing", "/"],
              ["Console", "/console"],
              ["Live demo", "/console?demo=1"],
              ["Features", "/#features"],
            ]}
          />
          <FooterCol
            title="Company"
            links={[
              ["About", "/about"],
              ["Pricing", "/pricing"],
              ["Docs", "/docs"],
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

export function SectionHead({
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

export function MarketingCta() {
  return (
    <section className="cta-band">
      <div className="cta-inner">
        <ABLockup size={80} tone="#fff" />
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
