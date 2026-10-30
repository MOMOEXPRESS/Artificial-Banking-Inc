"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ABLockup, ABWordmark } from "./brand";
import { Icon } from "./ui";

/** Shared marketing chrome for Home / Docs / Pricing / About. */

export type MarketingNavKey =
  "home" | "landing" | "docs" | "pricing" | "about" | "console" | "partnerships" | "waitlist";

/** Public waitlist signup page. No account needed. */
export const WAITLIST_HREF = "/waitlist";

export function MarketingShell({
  children,
  active,
}: {
  children: ReactNode;
  active?: MarketingNavKey;
}) {
  const navActive = active === "landing" ? "home" : active;
  return (
    <div className="landing">
      <MarketingNav active={navActive} />
      {children}
      <MarketingFooter />
      <CookieNotice />
    </div>
  );
}

const COOKIE_NOTICE_KEY = "abi_cookie_notice";

/** Informational only: ABI sets strictly necessary cookies, so there is nothing to consent to. */
export function CookieNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(localStorage.getItem(COOKIE_NOTICE_KEY) !== "1");
    } catch {
      setShow(false);
    }
  }, []);
  if (!show) return null;
  return (
    <div className="cookie-notice" role="region" aria-label="Cookie notice">
      <p>
        ABI uses only strictly necessary cookies to sign you in and keep sessions safe. No tracking.{" "}
        <a href="/cookies">Cookie notice</a>
      </p>
      <button
        className="sm"
        onClick={() => {
          try {
            localStorage.setItem(COOKIE_NOTICE_KEY, "1");
          } catch {
            /* private mode: just hide */
          }
          setShow(false);
        }}
      >
        Got it
      </button>
    </div>
  );
}

export function MarketingNav({ active }: { active?: MarketingNavKey }) {
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
    <header
      className={`marketing-nav ${scrolled ? "on-scroll" : ""} ${menuOpen ? "menu-open" : ""}`}
    >
      <div className="marketing-nav-inner">
        <Link href="/" aria-label="Artificial Banking Incorporated home" onClick={close}>
          <ABWordmark size={26} tone="#0a0a0c" />
        </Link>
        <nav className="marketing-links">
          <Link href="/" className={current === "home" ? "is-active" : undefined} onClick={close}>
            Home
          </Link>
          <Link
            href="/console"
            className={current === "console" ? "is-active" : undefined}
            onClick={close}
          >
            Console
          </Link>
          <Link
            href="/docs"
            className={current === "docs" ? "is-active" : undefined}
            onClick={close}
          >
            Docs
          </Link>
          <Link
            href="/pricing"
            className={current === "pricing" ? "is-active" : undefined}
            onClick={close}
          >
            Pricing
          </Link>
          <Link
            href="/partnerships"
            className={current === "partnerships" ? "is-active" : undefined}
            onClick={close}
          >
            Partnerships
          </Link>
          <Link
            href="/about"
            className={current === "about" ? "is-active" : undefined}
            onClick={close}
          >
            About
          </Link>
          {/* Mobile menu only: on desktop the same link sits beside "Open console". */}
          <Link
            href={WAITLIST_HREF}
            className={`marketing-links-waitlist${current === "waitlist" ? " is-active" : ""}`}
            onClick={close}
          >
            Join waitlist
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
          <Link
            className="btn-ghost-line marketing-nav-waitlist"
            href={WAITLIST_HREF}
            aria-current={current === "waitlist" ? "page" : undefined}
            onClick={close}
          >
            Join waitlist
          </Link>
          <Link className="btn-primary-line" href="/console" onClick={close}>
            Open console
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
            Controls so AI agents can spend money — with budgets you set, approvals when it matters,
            and a record you can show people.
          </p>
        </div>
        <div className="marketing-footer-cols">
          <FooterCol
            title="Product"
            links={[
              ["Home", "/"],
              ["Buyer console", "/console"],
              ["Partnerships", "/partnerships"],
              ["Partner login", "/partners/login"],
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
            title="Ecosystem reading"
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
        <span>
          <a href="/terms">Terms</a>
          {" · "}
          <a href="/privacy">Privacy</a>
          {" · "}
          <a href="/cookies">Cookies</a>
          {" · "}
          Not a bank or licensed money transmitter. Not FDIC insured. Testnet only (Base Sepolia);
          test USDC has no cash value. Operators remain responsible for agent spend.
        </span>
        <span className="marketing-footer-tm">
          Third-party names and logos are trademarks of their owners, shown to describe
          compatibility only; no endorsement or partnership is implied.
        </span>
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
  eyebrow?: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="section-head">
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
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
        <h2>Try an agent that can spend — this afternoon.</h2>
        <p>
          The console is free while we&rsquo;re building. Bring an OpenAI, Anthropic, or any
          pay-per-use API key. Your agent can start paying under your rules in a few minutes.
        </p>
      </div>
      <div className="cta-lockup" aria-hidden>
        <ABLockup size={220} tone="#0a0a0c" />
      </div>
      <div className="cta-action-row">
        <Link className="cta-action-card" href="/console">
          <span className="cta-action-kicker">Console</span>
          <strong>Open the console</strong>
          <span className="cta-action-sub">Balances, approvals, and rules.</span>
        </Link>
        <Link className="cta-action-card" href="/waitlist?ref=home-cta">
          <span className="cta-action-kicker">Early access</span>
          <strong>Join the waitlist</strong>
          <span className="cta-action-sub">We&rsquo;ll email you when there&rsquo;s a spot.</span>
        </Link>
      </div>
    </section>
  );
}
