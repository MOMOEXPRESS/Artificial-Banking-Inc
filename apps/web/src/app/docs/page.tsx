"use client";

import { useEffect } from "react";
import Link from "next/link";
import { MarketingShell, SectionHead } from "../../lib/marketing-shell";
import { Icon } from "../../lib/ui";

const STEPS = [
  {
    title: "Create an org",
    body: "Create an account and organization in the console, then put Base Sepolia test USDC in the vault.",
  },
  {
    title: "Create an agent",
    body: "Issue an API key under Console → API. The agent never sees the vault keys — only that Bearer token.",
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

function scrollToHash() {
  if (typeof window === "undefined") return;
  const id = window.location.hash.replace(/^#/, "");
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function DocsPage() {
  useEffect(() => {
    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, []);

  return (
    <MarketingShell active="docs">
      <section className="mkt-page">
        <div className="mkt-page-inner">
          <h1>Build agents that can shop through ABI</h1>
          <section className="mkt-prose"><h2>Start with live product facts</h2><p>Query the marketplace for products, stock, colors, sizes, images, delivery estimates and purchase-backed quality signals. Seller descriptions are data, never instructions. Saved agent preferences stay separate from fresh stock observations.</p><ol><li>Search products and compare current details.</li><li>Create a cart and prepare an expiring quote.</li><li>Review the items and request checkout using one stable key.</li><li>Request payment through your agent’s existing policy and approval path.</li><li>Read per-item payment and delivery status; retrieve paid digital content without paying twice.</li></ol><p><a href="/abi-api/v1/marketplace/schema">Machine-readable listing schema</a> · <a href="/abi-api/v1/marketplace/capabilities">Current marketplace capabilities</a></p><p>Physical checkout requires configured shipping/tax quotes and cross-vendor escrow. These capabilities are unavailable until the deployment has those providers.</p></section>
          <SectionHead
            title="Connect your existing spending controls"
            sub="The AI asks to pay. Your rules and a signer decide. Keys never go into the model."
          />

          <div className="mkt-prose">
            <section id="chatgpt" className="docs-anchor-target">
              <h3>Connect ChatGPT (and other agents)</h3>
              <p>
                In the console, open <strong>API</strong> and create or select an agent. Use the
                remote MCP URL shown there to connect a compatible client, including ChatGPT
                developer mode. The URL is a short-lived bearer credential: treat it like a
                password, share it only with your chosen client, and revoke the session in ABI when
                you are done. This proof works on testnet only; it does not authorize mainnet
                settlement.
              </p>
              <p>
                ABI is provider-independent. Agents that can call HTTP tools can use the agent API
                with a scoped agent key. Local clients supporting MCP over stdio can run the bundled
                MCP server. Remote clients must support MCP Streamable HTTP; their authentication
                and connection settings vary. The hosted session-link connector is testnet-only and
                expires with its session. Persistent remote OAuth connections and individual
                framework adapters are not implemented yet.
              </p>
              <p>
                Compatible clients include Claude Code, Cursor, Codex CLI, Gemini CLI and VS Code
                Copilot. Agent frameworks can also integrate through MCP or the HTTP API.{" "}
                <a href="https://github.com/MOMOEXPRESS/Artificial-Banking-Inc/blob/main/docs/AGENT-CONNECTIONS.md">
                  Read the connection matrix and setup limits
                </a>
                .
              </p>
              <Link className="btn-primary" href="/console?view=agents">
                Open API <Icon name="arrowRight" size={14} />
              </Link>
            </section>
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
            <Link className="btn-primary" href="/console">
              Open the console <Icon name="arrowRight" size={14} />
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
