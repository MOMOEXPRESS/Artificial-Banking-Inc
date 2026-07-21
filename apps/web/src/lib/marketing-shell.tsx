"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ABLockup, ABWordmark } from "./brand";
import { Icon } from "./ui";

/** Shared marketing chrome for Home / Docs / Pricing / About. */

export function MarketingShell({
  children,
  active,
}: {
  children: ReactNode;
  active?: "home" | "landing" | "docs" | "pricing" | "about" | "console";
}) {
  const navActive = active === "landing" ? "home" : active;
  return (
    <div className="landing">
      <MarketingNav active={navActive} />
      {children}
      <MarketingFooter />
    </div>
  );
}

export function MarketingNav({
  active,
}: {
  active?: "home" | "landing" | "docs" | "pricing" | "about" | "console";
}) {
  const current = active === "landing" ? "home" : active;
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  const close = () => setMenuOpen(false);
  return (
    <header className={`marketing-nav ${scrolled ? "on-scroll" : ""} ${menuOpen ? "menu-open" : ""}`}>
      <div className="marketing-nav-inner">
        <Link href="/" aria-label="Artificial Banking Incorporated home" onClick={close}>
          <ABWordmark size={26} tone="#0a0a0c" />
        </Link>
        <nav className="marketing-links">
          <Link href="/" className={current === "home" ? "is-active" : undefined} onClick={close}>
            Home
          </Link>
          <Link href="/console" className={current === "console" ? "is-active" : undefined} onClick={close}>
            Console
          </Link>
          <Link href="/docs" className={current === "docs" ? "is-active" : undefined} onClick={close}>
            Docs
          </Link>
          <Link href="/pricing" className={current === "pricing" ? "is-active" : undefined} onClick={close}>
            Pricing
          </Link>
          <Link href="/about" className={current === "about" ? "is-active" : undefined} onClick={close}>
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
          <Link className="btn-primary-line" href="/console" onClick={close}>
            Launch console
          </Link>
          <button
            type="button"
            className="marketing-burger"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Icon name="list" size={18} />
          </button>
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
              ["Home", "/"],
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

/** Closing CTA — headline open; logo alone; actions as two grey cards. */
export function MarketingCta() {
  return (
    <section className="cta-band">
      <div className="cta-open">
        <h2>Ship an autonomous agent this afternoon.</h2>
        <p>
          The console is free while it&rsquo;s in development. Bring an OpenAI, Anthropic, or any
          pay-per-use API — your agent starts spending under policy in minutes.
        </p>
      </div>
      <div className="cta-lockup" aria-hidden>
        <ABLockup size={72} tone="#0a0a0c" />
      </div>
      <div className="cta-action-row">
        <Link className="cta-action-card" href="/console">
          <span className="cta-action-kicker">Console</span>
          <strong>Launch console</strong>
          <span className="cta-action-sub">Guardian desk, live balances, policy.</span>
        </Link>
        <Link className="cta-action-card" href="/console?demo=1">
          <span className="cta-action-kicker">Demo</span>
          <strong>Try demo org</strong>
          <span className="cta-action-sub">$100 float, two agents, real ledger.</span>
        </Link>
      </div>
    </section>
  );
}
