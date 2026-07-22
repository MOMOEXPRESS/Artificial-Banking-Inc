/** Shared Guardian Console types. */
export type AgentKey = { agentId: string; name: string; key: string };

export type Session = {
  guardianKey: string;
  orgId?: string;
  agentKeys: AgentKey[];
};

export type Prefs = { autoJump: boolean };

export type OrgView = {
  org: { id: string; name: string; status: string; settings?: Record<string, unknown> };
  actor?: { role: "owner" | "approver" | "viewer"; guardianId: string };
  agents: { id: string; name: string; status: string; spent24hUsdc: string }[];
  dailyMaxUsdc: string;
  balances: { id: string; kind: string; agentId?: string; usdc: string }[];
  vaultAddress: string;
};

export type Decision = {
  intentId: string;
  outcome: string;
  ruleIds: string[];
  reasons: string[];
  tool: string;
  amountUsdc: string;
  destination: string;
  at: string;
  agentId: string;
};

export type Approval = {
  id: string;
  intentId: string;
  agentId: string;
  tool: string;
  amountUsdc: string;
  destination: string;
  memo?: string;
  reasons: string[];
  status: string;
  createdAt: string;
  expiresAt: string;
  resolvedBy?: string;
};

export type Escrow = {
  id: string;
  payerAgentId: string;
  payeeAgentId: string;
  amountUsdc: string;
  state: string;
  jobId?: string;
  memo?: string;
  timeoutAt: string;
};

export type Webhook = { id: string; url: string; createdAt: string };
export type Delivery = {
  id: number;
  event: string;
  url: string;
  status: string;
  attempts: number;
  lastError?: string;
  createdAt: string;
};
export type Journal = {
  id: string;
  intentId?: string;
  memo: string;
  createdAt: string;
  lines: { accountId: string; deltaMicro: string }[];
};
export type Metrics = {
  agents: number;
  decisions: Record<string, number>;
  approvals: { pending: number; total: number };
  escrows: { locked: number; total: number };
  journals: number;
  webhookDeliveries: number;
  balancesUsdc: Record<string, string>;
};
export type Setup = {
  custody: string;
  network: string;
  settlement: string;
  telegram: boolean;
  rateLimitPerMin: number;
  approvalTtlMinutes: number;
  cdpApiKeyConfigured?: boolean;
  cdpWired?: boolean;
  note?: string;
};
export type Recon = { ok: boolean; accountsChecked: number; journalsReplayed: number; drift: unknown[] };

export type View =
  | "overview"
  | "treasury"
  | "agents"
  | "payments"
  | "playground"
  | "chat"
  | "work"
  | "approvals"
  | "insights"
  | "invoices"
  | "escrows"
  | "ledger"
  | "policy"
  | "webhooks"
  | "activity"
  | "settings";

/** Human label for goto / breadcrumb CTAs (never show raw keys). */
export function viewLabel(view: string): string {
  const map: Record<string, string> = {
    overview: "Overview",
    treasury: "Treasury",
    agents: "Agents",
    payments: "Payments",
    playground: "Playground",
    chat: "ABI Chat",
    work: "Work",
    approvals: "Payments · Approvals",
    insights: "Insights",
    invoices: "Payments · Invoices",
    escrows: "Payments · Escrows",
    ledger: "Ledger",
    policy: "Policy",
    webhooks: "Webhooks",
    activity: "Insights · Activity",
    settings: "Settings",
  };
  return map[view] ?? view;
}

export type Shared = {
  busy: boolean;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
  agentName: (id: string) => string;
  org: OrgView | null;
  setToast: (m: string, k?: "ok" | "err" | "info") => void;
  /** Optional `tab` deep-links into a sub-surface (e.g. treasury `move`, payments `rails`). */
  setView: (v: View, tab?: string) => void;
  readOnly: boolean;
};

export type Alert = {
  id: string;
  kind: "approval" | "escrow" | "webhook" | "drift" | "fund";
  title: string;
  body: string;
  tone: "warn" | "bad" | "info";
  goto: View;
};
