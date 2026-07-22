"use client";

import { useEffect, useState } from "react";
import { Icon } from "./ui";

const ROTATE_MS = 12000;
const EXIT_MS = 280;

/** Multiple tips per console page — rotates in a reserved slot (no layout jump). */
const TIPS: Record<string, string[]> = {
  overview: [
    "Vault balance, agent spend, and where money went — deposit more under Treasury → Vault.",
    "Use Move funds for treasury → agent, agent → treasury, or agent → agent transfers.",
    "Freeze an agent from Overview when spend looks off — they stay frozen until you thaw.",
    "Switch 24h / 7d / all time to change the spend window on the charts.",
  ],
  agents: [
    "Open an agent profile for session keys, wallet balance, and freeze controls.",
    "Ops labels are optional tags for freeze/bulk fund — money lives in Treasury budgets.",
    "Rotate an agent API key anytime from the agent profile if a key may have leaked.",
    "Create agents here first — fund them from a budget under Treasury → Budgets → Move.",
    "Prefer writer-finance and writer-research over one agent in many money pools.",
  ],
  payments: [
    "Settlements, invoices, escrows, schedules, and live rails (x402 + transfer-mock).",
    "Open an invoice or escrow row for status, counterparties, and next actions.",
    "Subscriptions and one-shot schedules share Payments → Scheduled — review outcomes park in Approvals.",
    "Parked HITL payments also show under Approvals when a human must decide.",
  ],
  playground: [
    "Run a preset scenario, or build a custom mission from real policy steps.",
    "Every step hits the live agent API, policy engine, and ledger — nothing is faked.",
    "Use Custom to ask: would this agent survive our policy under our conditions?",
    "Stress and smoke modes replay so you can watch policy bands fire repeatedly.",
  ],
  chat: [
    "Ask “What should I do next?” or “How is Researcher?” — ABI binds names to live roster facts.",
    "It never moves money by itself — you approve anything that needs a human.",
    "Follow-ups like “what about them?” reuse the last agents / destinations it looked up.",
    "Ask why a payment was denied — ABI maps the outcome to policy bands.",
  ],
  treasury: [
    "Vault is cash in/out (Receive / Send). Budgets hold envelopes. Move funds agents.",
    "Send is USDC-only on the spend rail — BTC/ETH holdings stay in the vault.",
    "Broke agents? Fund them from a Budget → Move, not from Send.",
  ],
  work: [
    "Deliverables and run history from Playground missions — the spend paper trail.",
    "Open a run to see steps, payments attempted, and policy outcomes.",
  ],
  approvals: [
    "Parked payments waiting on a human — approve or deny so agents can resume.",
    "Large or unknown-counterparty spends land here based on your Policy bands.",
    "Quorum may need more than one guardian vote before a move executes.",
  ],
  insights: [
    "Burn, anomalies, vendor spend, and economics rollups — read-only analytics.",
    "Use Insights to spot a noisy agent before you tighten Policy caps.",
  ],
  ledger: [
    "Double-entry journals prove every USDC move balanced — drill into a journal for lines.",
    "Demo deposits, allocations, and withdrawals all leave a trail here.",
  ],
  policy: [
    "Caps, allowlists, HITL, quiet hours, automation, and templates — save before they apply.",
    "Drag judgment bands — Ask me above, Per payment, and Daily max keep their gaps linked automatically.",
    "The judgment bands move when you drag limits — nothing is live until Save.",
    "Use Simulate to dry-run a payment against the draft policy before you commit.",
    "Starter templates are a fast baseline — then tune allowlists for your vendors.",
  ],
  webhooks: [
    "When money moves, ABI pushes a signed event to your URL — you don't poll the console.",
    "Verify x-policyvault-signature (HMAC) and dedupe on x-policyvault-delivery.",
    "Try Playground → Webhook ping for a guided demo, or register abi://demo-inbox here.",
    "HMAC-signed money events into your systems — rotate secrets when needed.",
  ],
  activity: [
    "Full decision audit trail — export CSV from the Activity header.",
    "Filter by agent or outcome when debugging a refuse or review.",
  ],
  settings: [
    "Go-live checklist splits Demo-ready vs Production — finish Demo without CDP first.",
    "Merchant directory is labels only — Policy → Allowlists gates pay_api destinations.",
    "The org kill switch freezes all agent spend immediately.",
  ],
};

/**
 * Always-on tip rail for console pages (Treasury excluded).
 * The card shell stays put — only the tip text crossfades.
 */
export function PageTour({ view }: { view: string }) {
  const tips = TIPS[view];
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"in" | "out">("in");

  useEffect(() => {
    setIndex(0);
    setPhase("in");
  }, [view]);

  useEffect(() => {
    if (!tips || tips.length <= 1) return;
    let exitTimer = 0;
    const tick = window.setInterval(() => {
      setPhase("out");
      exitTimer = window.setTimeout(() => {
        setIndex((i) => (i + 1) % tips.length);
        setPhase("in");
      }, EXIT_MS);
    }, ROTATE_MS);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(exitTimer);
    };
  }, [tips, view]);

  if (!tips?.length) return null;

  const body = tips[index % tips.length];

  return (
    <div className="page-tip-slot" aria-live="polite">
      <div className="page-tip" role="status">
        <span className="page-tip-icon" aria-hidden>
          <Icon name="spark" size={15} />
        </span>
        <div className="page-tip-body">
          <div className="page-tip-title">
            Tip
            {tips.length > 1 && (
              <span className="page-tip-count">
                {index + 1}/{tips.length}
              </span>
            )}
          </div>
          <p
            key={`${view}-${index}`}
            className={`page-tip-text ${phase === "out" ? "page-tip-text-out" : "page-tip-text-in"}`}
          >
            {body}
          </p>
        </div>
        {tips.length > 1 && <div key={`bar-${view}-${index}`} className="page-tip-bar" aria-hidden />}
      </div>
    </div>
  );
}

export function resetAllPageTours() {
  try {
    localStorage.removeItem("abi_page_tours_v1");
  } catch {
    /* ignore */
  }
}
