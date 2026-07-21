"use client";

import Link from "next/link";
import { MarketingShell, SectionHead } from "../../lib/marketing-shell";
import { Icon } from "../../lib/ui";

const STEPS = [
  {
    title: "Create an org",
    body: "Launch the console, bootstrap a demo org, and fund the vault with test USDC.",
  },
  {
    title: "Spawn an agent",
    body: "Issue an API key. The agent never sees custody keys — only a Bearer token.",
  },
  {
    title: "Set policy",
    body: "Caps, allowlists, HITL thresholds, quiet hours. Simulate before you ship.",
  },
  {
    title: "Pay under policy",
    body: "Agents call pay / pay_api / escrow_lock. The engine evaluates, then settles.",
  },
];

const ENDPOINTS = [
  { method: "POST", path: "/v1/agent/pay_api", note: "x402 machine payment" },
  { method: "POST", path: "/v1/agent/pay", note: "Transfer under stipend" },
  { method: "POST", path: "/v1/agent/escrow/lock", note: "Agent-to-agent escrow" },
  { method: "GET", path: "/v1/openapi.json", note: "Full OpenAPI surface" },
  { method: "POST", path: "/v1/guardian/chat", note: "ABI Chat (deterministic)" },
];

export default function DocsPage() {
  return (
    <MarketingShell active="docs">
      <section className="mkt-page">
        <div className="mkt-page-inner">
          <SectionHead
            eyebrow="Documentation"
            title="Build agents that spend safely"
            sub="LLM proposes. Policy + signer authorize. Keys never enter the model."
          />

          <div className="mkt-prose">
            <h3>Money spine</h3>
            <p>
              Every spend flows through one path: intent → policy evaluation → compliance screen →
              ledger hold → rail (x402 or transfer) → custody sign → finalize + webhooks.
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
              Point your agent SDK or MCP tools at the API. Full schema lives at{" "}
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
              Open live demo <Icon name="arrowRight" size={14} />
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
