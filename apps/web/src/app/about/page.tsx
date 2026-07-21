"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { MarketingShell, SectionHead } from "../../lib/marketing-shell";
import { LandingMotion } from "../../lib/landing-motion";
import { Icon } from "../../lib/ui";

/**
 * About — alternating copy/visual pans.
 * Odd sections: copy left, art right.
 * Even sections: art left, copy right (pane-flip).
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
            visual={<VisualWeAre />}
          />
          <AboutPane
            n="02"
            title="What we are not"
            lead="Not a bank. Not a trading wallet. Not a chat that moves money."
            body="Not a consumer bank. Not FDIC insured. Not a crypto trading wallet. Not an LLM that interprets free-text money intents. We do not hold retail deposits, and we do not ask you to trust a chat transcript as your ledger of record."
            flip
            visual={<VisualWeAreNot />}
          />
          <AboutPane
            n="03"
            title="How we build"
            lead="One money spine — intent, policy, custody, settle, journal."
            body="Extension points for compliance and notifications. Ship what fits today without blocking the next pillars: more rails, richer approvals, deeper analytics. The path agents take to spend should stay the same even as the surface around it grows."
            flip={false}
            visual={<VisualHowWeBuild />}
          />
          <AboutPane
            n="04"
            title="Who it is for"
            lead="Teams that want agents to spend — under budget, with a human still able to park large spends."
            body="If you need a playground today and production rails when agents earn their keep, that is the path we designed for. Guardians set policy. Agents call the same API your production fleet will use."
            flip
            visual={<VisualWhoFor />}
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
  visual,
}: {
  n: string;
  title: string;
  lead: string;
  body: string;
  flip?: boolean;
  visual: ReactNode;
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
        <div className="pane-visual about-visual" aria-hidden>
          {visual}
        </div>
      </div>
    </section>
  );
}

/** Shield / vault / authorize stack — what ABI is. */
function VisualWeAre() {
  return (
    <div className="about-art about-art-are">
      <svg viewBox="0 0 420 320" fill="none" xmlns="http://www.w3.org/2000/svg" className="about-art-svg">
        <rect width="420" height="320" rx="28" fill="#121214" />
        <rect x="24" y="24" width="372" height="272" rx="20" stroke="rgba(255,255,255,0.08)" />
        {/* vault hex */}
        <path
          d="M210 58 L278 98 V178 L210 218 L142 178 V98 Z"
          stroke="#f4f4f6"
          strokeWidth="3.5"
          fill="rgba(255,255,255,0.03)"
        />
        <circle cx="210" cy="138" r="28" stroke="#c8c8d0" strokeWidth="2.5" />
        <circle cx="210" cy="138" r="8" fill="#f4f4f6" />
        <path d="M210 110 V122 M210 154 V166 M182 138 H194 M226 138 H238" stroke="#f4f4f6" strokeWidth="2.5" strokeLinecap="round" />
        {/* flow labels */}
        <rect x="48" y="240" width="100" height="36" rx="10" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.1)" />
        <text x="98" y="263" textAnchor="middle" fill="#8e8e99" fontSize="12" fontFamily="ui-monospace, monospace">LLM proposes</text>
        <path d="M156 258 H178" stroke="#5e5e68" strokeWidth="2" markerEnd="url(#arr)" />
        <rect x="186" y="240" width="108" height="36" rx="10" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.18)" />
        <text x="240" y="263" textAnchor="middle" fill="#f4f4f6" fontSize="12" fontFamily="ui-monospace, monospace" fontWeight="600">Policy signs</text>
        <path d="M302 258 H324" stroke="#5e5e68" strokeWidth="2" />
        <rect x="328" y="240" width="64" height="36" rx="10" fill="rgba(34,197,94,0.16)" stroke="rgba(34,197,94,0.35)" />
        <text x="360" y="263" textAnchor="middle" fill="#22c55e" fontSize="12" fontFamily="ui-monospace, monospace">Settle</text>
      </svg>
      <div className="about-art-caption">Keys never enter the model</div>
    </div>
  );
}

/** Crossed-out “not a bank / not a chat wallet” composition. */
function VisualWeAreNot() {
  return (
    <div className="about-art about-art-not">
      <svg viewBox="0 0 420 320" fill="none" xmlns="http://www.w3.org/2000/svg" className="about-art-svg">
        <rect width="420" height="320" rx="28" fill="#161618" />
        <rect x="24" y="24" width="372" height="272" rx="20" stroke="rgba(255,255,255,0.07)" />
        {/* bank building */}
        <g opacity="0.55">
          <rect x="72" y="100" width="110" height="88" rx="4" stroke="#8e8e99" strokeWidth="2.5" />
          <path d="M72 100 L127 68 L182 100" stroke="#8e8e99" strokeWidth="2.5" fill="none" />
          <rect x="90" y="120" width="18" height="28" fill="#5e5e68" />
          <rect x="118" y="120" width="18" height="28" fill="#5e5e68" />
          <rect x="146" y="120" width="18" height="28" fill="#5e5e68" />
          <text x="127" y="210" textAnchor="middle" fill="#8e8e99" fontSize="13" fontFamily="system-ui,sans-serif">Bank</text>
        </g>
        {/* chat bubble */}
        <g opacity="0.55">
          <rect x="248" y="88" width="120" height="72" rx="16" stroke="#8e8e99" strokeWidth="2.5" />
          <path d="M278 160 L268 178 L298 160" stroke="#8e8e99" strokeWidth="2.5" fill="none" />
          <circle cx="278" cy="124" r="4" fill="#8e8e99" />
          <circle cx="298" cy="124" r="4" fill="#8e8e99" />
          <circle cx="318" cy="124" r="4" fill="#8e8e99" />
          <text x="308" y="210" textAnchor="middle" fill="#8e8e99" fontSize="13" fontFamily="system-ui,sans-serif">Chat wallet</text>
        </g>
        {/* prohibition stamp — not a literal giant X alone; a ringed strike */}
        <circle cx="210" cy="148" r="78" stroke="#ef4444" strokeWidth="4" opacity="0.85" />
        <path d="M155 93 L265 203" stroke="#ef4444" strokeWidth="5" strokeLinecap="round" opacity="0.9" />
        <text x="210" y="268" textAnchor="middle" fill="#f4f4f6" fontSize="14" fontFamily="system-ui,sans-serif" fontWeight="600">
          Out of scope
        </text>
      </svg>
      <div className="about-art-caption">No retail deposits · no prompt-as-ledger</div>
    </div>
  );
}

/** Builder at a terminal — how we build. */
function VisualHowWeBuild() {
  return (
    <div className="about-art about-art-build">
      <svg viewBox="0 0 420 320" fill="none" xmlns="http://www.w3.org/2000/svg" className="about-art-svg">
        <rect width="420" height="320" rx="28" fill="#0e0e10" />
        {/* desk */}
        <rect x="40" y="250" width="340" height="12" rx="2" fill="#2a2a30" />
        {/* monitor */}
        <rect x="88" y="72" width="244" height="158" rx="10" fill="#1a1a1e" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
        <rect x="100" y="86" width="220" height="118" rx="4" fill="#0c0c0e" />
        {/* code lines */}
        <rect x="112" y="98" width="88" height="6" rx="2" fill="#3b82f6" opacity="0.7" className="about-code-line" />
        <rect x="112" y="112" width="160" height="6" rx="2" fill="#8e8e99" opacity="0.5" />
        <rect x="112" y="126" width="132" height="6" rx="2" fill="#22c55e" opacity="0.55" />
        <rect x="112" y="140" width="96" height="6" rx="2" fill="#8e8e99" opacity="0.45" />
        <rect x="112" y="154" width="148" height="6" rx="2" fill="#eab308" opacity="0.45" />
        <rect x="112" y="168" width="70" height="6" rx="2" fill="#8e8e99" opacity="0.4" />
        <rect x="112" y="182" width="110" height="6" rx="2" fill="#c8c8d0" opacity="0.35" className="about-code-cursor" />
        {/* stand */}
        <rect x="196" y="230" width="28" height="20" fill="#2a2a30" />
        {/* person silhouette at desk */}
        <circle cx="320" cy="200" r="18" fill="#3a3a42" />
        <path d="M296 248 C296 228 304 218 320 218 C336 218 344 228 344 248" fill="#3a3a42" />
        {/* arm to keyboard */}
        <path d="M304 230 Q280 238 250 242" stroke="#3a3a42" strokeWidth="8" strokeLinecap="round" fill="none" />
        <rect x="220" y="240" width="70" height="8" rx="2" fill="#2a2a30" />
      </svg>
      <div className="about-art-caption">intent → policy → custody → settle → journal</div>
    </div>
  );
}

/** Operator / founder at console — who it’s for. */
function VisualWhoFor() {
  return (
    <div className="about-art about-art-who">
      <svg viewBox="0 0 420 320" fill="none" xmlns="http://www.w3.org/2000/svg" className="about-art-svg">
        <rect width="420" height="320" rx="28" fill="#121214" />
        {/* window chrome */}
        <rect x="48" y="48" width="324" height="200" rx="14" fill="#1e1e22" stroke="rgba(255,255,255,0.1)" />
        <circle cx="68" cy="68" r="5" fill="#ef4444" opacity="0.7" />
        <circle cx="86" cy="68" r="5" fill="#eab308" opacity="0.7" />
        <circle cx="104" cy="68" r="5" fill="#22c55e" opacity="0.7" />
        <text x="210" y="72" textAnchor="middle" fill="#8e8e99" fontSize="11" fontFamily="ui-monospace,monospace">guardian console</text>
        {/* sidebar + content */}
        <rect x="60" y="88" width="56" height="144" rx="8" fill="#0c0c0e" />
        <rect x="70" y="100" width="36" height="8" rx="2" fill="#f4f4f6" opacity="0.85" />
        <rect x="70" y="118" width="36" height="6" rx="2" fill="#5e5e68" />
        <rect x="70" y="132" width="36" height="6" rx="2" fill="#5e5e68" />
        <rect x="70" y="146" width="36" height="6" rx="2" fill="#5e5e68" />
        <rect x="128" y="88" width="228" height="144" rx="8" fill="#0c0c0e" />
        <rect x="144" y="108" width="120" height="10" rx="2" fill="#f4f4f6" opacity="0.7" />
        <rect x="144" y="132" width="80" height="28" rx="8" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.12)" />
        <rect x="236" y="132" width="80" height="28" rx="8" fill="rgba(249,115,22,0.2)" stroke="rgba(249,115,22,0.4)" />
        <text x="276" y="150" textAnchor="middle" fill="#f97316" fontSize="11" fontFamily="system-ui,sans-serif">Approve</text>
        {/* person typing */}
        <circle cx="340" cy="268" r="14" fill="#4a4a52" />
        <path d="M320 300 C320 284 328 276 340 276 C352 276 360 284 360 300" fill="#4a4a52" />
        <path d="M328 286 Q300 292 270 296" stroke="#4a4a52" strokeWidth="7" strokeLinecap="round" />
      </svg>
      <div className="about-art-caption">Operators · builders · agent fleets under budget</div>
    </div>
  );
}
