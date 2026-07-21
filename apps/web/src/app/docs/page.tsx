"use client";

import Link from "next/link";
import { MarketingShell, SectionHead } from "../../lib/marketing-shell";
import { Icon } from "../../lib/ui";

const STEPS = [
  {
    title: "Create an org",
    body: "Open the console, start a demo org, and put test USDC in the vault.",
  },
  {
    title: "Create an agent",
    body: "Issue an API key. The agent never sees the vault keys — only that Bearer token.",
  },
  {
    title: "Set the rules",
    body: "Caps, allowed sites, when to ask a person, quiet hours. Test in the simulator first.",
  },
  {
    title: "Pay under the rules",
    body: "Agents call pay / pay_api / escrow_lock. We check the rules, then move the money.",
  },
];

const ENDPOINTS = [
  { method: "POST", path: "/v1/agent/pay_api", note: "Pay an API (x402)" },
  { method: "POST", path: "/v1/agent/pay", note: "Transfer from the agent budget" },
  { method: "POST", path: "/v1/agent/escrow/lock", note: "Hold money between agents" },
  { method: "GET", path: "/v1/openapi.json", note: "Full API schema" },
  { method: "POST", path: "/v1/guardian/chat", note: "Console chat (fixed replies)" },
];

export default function DocsPage() {
  return (
    <MarketingShell active="docs">
      <section className="mkt-page">
        <div className="mkt-page-inner">
          <SectionHead
            eyebrow="Documentation"
            title="Build agents that can spend — safely"
            sub="The AI asks to pay. Your rules and a signer decide. Keys never go into the model."
          />

          <div className="mkt-prose">
            <h3>How money moves</h3>
            <p>
              Every spend follows one path: the agent asks → we check your rules → we may screen the
              destination → we hold the amount on the ledger → we pay (x402 or transfer) → we sign
              with custody → we finalize and notify you.
            </p>
            <pre className="mkt-code mono">
{`handleIntent → evaluatePolicy → executeIntent
  → screenDestination
  → ledger hold
  → rails (x402 | transfer)
  → finalize + notify`}
            </pre>
          </div>

          <div className="mkt-card-row">
            {STEPS.map((s, i) => (
              <article key={s.title} className="mkt-card">
                <span className="mkt-card-n mono">{String(i + 1).padStart(2, "0")}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </article>
            ))}
          </div>

          <div className="mkt-prose" style={{ marginTop: 48 }}>
            <h3>Core endpoints</h3>
            <p>
              Point your agent SDK or MCP tools at the API. The full schema is at{" "}
              <code className="mono">GET /v1/openapi.json</code>.
            </p>
          </div>

          <ul className="mkt-endpoint-list">
            {ENDPOINTS.map((e) => (
              <li key={e.path}>
                <span className="mono pill-method">{e.method}</span>
                <code className="mono">{e.path}</code>
                <span>{e.note}</span>
              </li>
            ))}
          </ul>

          <div className="mkt-doc-cta">
            <Link className="btn-primary" href="/console?demo=1">
              Open the live demo <Icon name="arrowRight" size={14} />
            </Link>
            <a
              className="btn-ghost"
              href="https://github.com/MOMOEXPRESS/Artificial-Banking-Inc"
              target="_blank"
              rel="noreferrer"
            >
              View source on GitHub
            </a>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
