/**
 * Agent-side production actions. One function per real agent endpoint; the
 * playground, the workflow runner and any future console surface call these
 * instead of hand-building requests.
 */
import type { AgentClient, FlowResult } from "./client";

export type PayArgs = {
  amountUsdc: string;
  destination: string;
  idempotencyKey: string;
  jobId?: string;
  memo?: string;
};

export const getBudget = (a: AgentClient): Promise<FlowResult> => a.call("GET", "/v1/agent/budget");

export const simulatePay = (
  a: AgentClient,
  args: { tool: "pay_api" | "pay_address"; amountUsdc: string; destination: string },
) => a.call("POST", "/v1/agent/simulate", args);

/** Pay an API / vendor / x402 seller (the `pay_api` tool). */
export const payApi = (a: AgentClient, args: PayArgs) => a.call("POST", "/v1/agent/pay_api", args);

/** Pay an on-chain address (vault USDC transfer). */
export const payAddress = (a: AgentClient, args: PayArgs) => a.call("POST", "/v1/agent/pay", args);

export const lockEscrow = (
  a: AgentClient,
  args: {
    amountUsdc: string;
    payeeAgentId: string;
    idempotencyKey: string;
    jobId?: string;
    memo?: string;
  },
) => a.call("POST", "/v1/agent/escrow/lock", args);

export const releaseEscrow = (a: AgentClient, escrowId: string) =>
  a.call("POST", `/v1/agent/escrow/${encodeURIComponent(escrowId)}/release`);

export const refundEscrow = (a: AgentClient, escrowId: string) =>
  a.call("POST", `/v1/agent/escrow/${encodeURIComponent(escrowId)}/refund`);

export const getApproval = (a: AgentClient, approvalId: string) =>
  a.call("GET", `/v1/agent/approvals/${encodeURIComponent(approvalId)}`);

export const listActivity = (a: AgentClient, limit = 10) =>
  a.call("GET", `/v1/agent/activity?limit=${limit}`);
