"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Icon } from "./ui";

const STORAGE_KEY = "abi_page_tours_v1";

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

/** First-visit explainer — shadcn Alert + Collapsible, localStorage-dismissed. */
export function PageTour({ view }: { view: string }) {
  const body = TOURS[view];
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    setDismissed(loadDismissed());
    setHydrated(true);
  }, []);

  if (!body || !hydrated) return null;

  const hidden = !!dismissed[view];

  if (hidden) {
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button className="bare sm" style={{ marginBottom: 10, fontSize: 11.5, opacity: 0.75 }}>
            Show page guide
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Alert variant="info" className="mb-3">
            <Icon name="spark" size={16} />
            <AlertTitle>How this page works</AlertTitle>
            <AlertDescription>{body}</AlertDescription>
          </Alert>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Alert variant="info" className="mb-3.5 flex items-start gap-3">
      <span className="mt-0.5 shrink-0">
        <Icon name="spark" size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <AlertTitle>How this page works</AlertTitle>
        <AlertDescription>{body}</AlertDescription>
      </div>
      <button
        type="button"
        className="ghost sm shrink-0"
        onClick={() => {
          const next = { ...dismissed, [view]: true };
          setDismissed(next);
          saveDismissed(next);
        }}
      >
        Got it
      </button>
    </Alert>
  );
}

export function resetAllPageTours() {
  localStorage.removeItem(STORAGE_KEY);
}
