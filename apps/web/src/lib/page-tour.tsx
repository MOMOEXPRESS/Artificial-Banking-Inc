"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

const STORAGE_KEY = "abi_page_tours_v1";
const SHOW_MS = 6500;
const EXIT_MS = 380;

const TOURS: Record<string, string> = {
  overview:
    "Your command center: vault balance, agent spend, where money went, and quick allocate/freeze. Deposit more under Treasury → Fund.",
  treasury:
    "Fund the org vault (demo deposit or vault address), withdraw, then move money across org / dept / shared / agent wallets. Cash flow + runway live under Cash & forecast.",
  agents:
    "Roster, profiles, session keys, and groups. Groups are real desks — freeze the whole swarm or fund every member equally.",
  payments:
    "Recent settlements, invoices, escrows, one-shot schedules, subscriptions, and which payment rails are live (x402 + transfer-mock today).",
  playground:
    "Pick a persona / use-case mission and run mode. Every step hits the real agent API, policy engine, and ledger — nothing is faked.",
  chat: "ABI Assistant answers with facts from your org and can surface approvals inline. It never moves money by itself.",
  work: "Deliverables and run history from Playground missions — the paper trail for what spend bought.",
  approvals: "Parked payments waiting on a human. Approve or deny; agents resume or replan.",
  insights: "Burn, anomalies, vendor spend, and economics rollups — read-only analytics.",
  ledger: "Double-entry journals that prove every USDC move balanced.",
  policy: "Caps, allowlists, HITL, quiet hours, automation, versions, and starter templates.",
  webhooks: "HMAC-signed money events into your systems. Rotate secrets when needed.",
  activity: "Full decision audit trail — export CSV from Settings or the Activity header.",
  settings: "Go-live checklist, org settings, merchants, team / quorum, and the org kill switch.",
};

function loadDismissed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

function saveDismissed(map: Record<string, boolean>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

/**
 * First-visit tip: slides in once, auto-dismisses with exit motion.
 * No “Got it” required — tips reappear only after resetAllPageTours().
 */
export function PageTour({ view }: { view: string }) {
  const body = TOURS[view];
  const [phase, setPhase] = useState<"idle" | "enter" | "exit" | "gone">("idle");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    setPhase("idle");

    if (!body) return;

    const dismissed = loadDismissed();
    if (dismissed[view]) {
      setPhase("gone");
      return;
    }

    const enterId = window.setTimeout(() => setPhase("enter"), 40);
    const exitId = window.setTimeout(() => setPhase("exit"), SHOW_MS);
    const goneId = window.setTimeout(() => {
      const next = { ...loadDismissed(), [view]: true };
      saveDismissed(next);
      setPhase("gone");
    }, SHOW_MS + EXIT_MS);
    timers.current = [enterId, exitId, goneId];

    return () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    };
  }, [view, body]);

  if (!body || phase === "idle" || phase === "gone") return null;

  return (
    <div
      className={`page-tip ${phase === "exit" ? "page-tip-out" : "page-tip-in"}`}
      role="status"
      aria-live="polite"
    >
      <span className="page-tip-icon" aria-hidden>
        <Icon name="spark" size={15} />
      </span>
      <div className="page-tip-body">
        <div className="page-tip-title">Tip</div>
        <p>{body}</p>
      </div>
      <div className="page-tip-bar" aria-hidden />
    </div>
  );
}

export function resetAllPageTours() {
  localStorage.removeItem(STORAGE_KEY);
}
