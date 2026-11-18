"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ABLockup, ABWordmark } from "./brand";
import { Icon } from "./ui";

/** Shared marketing chrome for Home / Docs / Pricing / About. */

export type MarketingNavKey =
  | "marketplace"
  | "home"
  | "landing"
  | "docs"
  | "pricing"
  | "about"
  | "console"
  | "partnerships"
  | "waitlist";

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
      <a className="market-skip" href="#main-content">
        Skip to content
      </a>
      <main id="main-content">{children}</main>
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

const MARKETING_LINKS = [
  { label: "Home", href: "/", key: "home" },
  { label: "Marketplace", href: "/directory", key: "marketplace" },
  { label: "Login", href: "/console", key: "console" },
  { label: "About", href: "/about", key: "about" },
  { label: "Docs", href: "/docs", key: "docs" },
  { label: "GitHub", href: "https://github.com/MOMOEXPRESS/Artificial-Banking-Inc", key: "github" },
  { label: "Partnership", href: "/partnerships", key: "partnerships" },
  { label: "Join waitlist", href: WAITLIST_HREF, key: "waitlist" },
] as const;

export function MarketingNav({ active }: { active?: MarketingNavKey }) {
  const current = active === "landing" ? "home" : active;
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && !headerRef.current?.contains(e.target)) setMenuOpen(false);
    };
    const desktop = window.matchMedia("(min-width: 1081px)");
    const onResize = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    desktop.addEventListener("change", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      desktop.removeEventListener("change", onResize);
    };
  }, [menuOpen]);
  const close = () => setMenuOpen(false);
  return (
    <header
      ref={headerRef}
      className={`marketing-nav ${scrolled ? "on-scroll" : ""} ${menuOpen ? "menu-open" : ""}`}
    >
      <div className="marketing-nav-inner">
        <Link
          className="marketing-nav-brand"
          href="/"
          aria-label="Artificial Banking Incorporated home"
          onClick={close}
        >
          <ABWordmark size={26} tone="#0a0a0c" />
        </Link>
        <button
          ref={toggleRef}
          type="button"
          className="marketing-burger"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="marketing-navigation"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span>{menuOpen ? "Close" : "Menu"}</span>
          <span className="marketing-menu-icon" aria-hidden="true">
            <span />
            <span />
          </span>
        </button>
        <nav
          id="marketing-navigation"
          className="marketing-links"
          aria-label="Main navigation"
          onBlur={(e) => {
            if (e.relatedTarget instanceof Node && !headerRef.current?.contains(e.relatedTarget))
              close();
          }}
        >
          {MARKETING_LINKS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={
                `${current === item.key ? "is-active " : ""}${item.key === "waitlist" ? "marketing-links-waitlist" : ""}`.trim() ||
                undefined
              }
              aria-current={current === item.key ? "page" : undefined}
              target={item.key === "github" ? "_blank" : undefined}
              rel={item.key === "github" ? "noopener noreferrer" : undefined}
              onClick={close}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <div className="marketing-footer-inner">
        <div className="marketing-footer-brand">
          <ABWordmark size={28} tone="#252525" />
          <p>
            A marketplace where agents find products and people stay in control. Discover, buy and
            sell with budgets, approvals and a clear purchase record.
          </p>
        </div>
        <div className="marketing-footer-cols">
          <FooterCol
            title="Product"
            links={[
              ["Home", "/"],
              ["Marketplace", "/directory"],
              ["Buyer console", "/console?view=marketplace"],
              ["Seller workspace", "/partners/login"],
              ["Partnerships", "/partnerships"],
              ["Partner login", "/partners/login"],
              ["Features", "/#features"],
            ]}
          />
          <FooterCol
            title="Company"
            links={[
              ["About", "/about"],
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
  level = 2,
}: {
  eyebrow?: string;
  title: string;
  sub: string;
  level?: 1 | 2;
}) {
  return (
    <div className="section-head">
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      {level === 1 ? <h1>{title}</h1> : <h2>{title}</h2>}
      <p>{sub}</p>
    </div>
  );
}

/** Closing CTA — headline open; logo alone; actions as two grey cards. */
export function MarketingCta() {
  return (
    <section className="cta-band">
      <div className="cta-open">
        <h2>Your next purchase starts with a good brief.</h2>
        <p>
          Explore seller listings, compare products and prepare a purchase with your agent. Your
          existing spending rules govern every payment request.
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
