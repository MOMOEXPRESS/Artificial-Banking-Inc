/**
 * Guardian-side production actions, over the console's authenticated client
 * (cookie + CSRF + org header + step-up). The Approvals view, the playground
 * and the workflow runner share these.
 */
import type { FlowResult, GuardianClient } from "./client";

export const getPolicy = (g: GuardianClient): Promise<FlowResult> =>
  g.call("GET", "/v1/guardian/policy");

/** Change policy. Only the Policies page and testnet practice runs may call this. */
export const updatePolicy = (g: GuardianClient, patch: Record<string, unknown>) =>
  g.call("POST", "/v1/guardian/policy", patch);

export const resolveApproval = (
  g: GuardianClient,
  approvalId: string,
  approve: boolean,
  resolvedBy = "console",
) =>
  g.call("POST", `/v1/guardian/approvals/${encodeURIComponent(approvalId)}/resolve`, {
    approve,
    resolvedBy,
  });

/**
 * Server check that a pasted agent / session key belongs to THIS org and is
 * not revoked or expired. The playground must call this before it stores a
 * pasted key: a successful budget read only proves the key is valid somewhere.
 */
export const verifyAgentKey = (g: GuardianClient, key: string) =>
  g.call("POST", "/v1/guardian/agent-keys/verify", { key });

/** Refusal message for a verify result, or null when the key may be used. */
export function agentKeyRefusal(verify: FlowResult, budgetAgentId: unknown): string | null {
  if (verify.status >= 400) {
    const err = (verify.data as { error?: { message?: string } }).error;
    return err?.message ?? "That key does not belong to this organization";
  }
  const verifiedId = (verify.data as { agentId?: unknown }).agentId;
  if (!verifiedId || String(verifiedId) !== String(budgetAgentId)) {
    return "That key resolved to a different agent than this organization verified — not added";
  }
  return null;
}

export type RunRecord = {
  missionId: string;
  title: string;
  agentId?: string;
  agentName?: string;
  status: "running" | "complete" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  costUsdc: string;
  steps: {
    id: string;
    title: string;
    detail: string;
    status: string;
    summary?: string;
    output?: string;
  }[];
  deliverableMd?: string;
};

export const saveRun = (g: GuardianClient, runId: string, record: RunRecord) =>
  g.call("PUT", `/v1/guardian/runs/${encodeURIComponent(runId)}`, record);

export const listRuns = (g: GuardianClient) => g.call("GET", "/v1/guardian/runs");

export const listWebhooks = (g: GuardianClient) => g.call("GET", "/v1/guardian/webhooks");

export const registerWebhook = (g: GuardianClient, url: string) =>
  g.call("POST", "/v1/guardian/webhooks", { url });

export const testWebhook = (g: GuardianClient, webhookId: string) =>
  g.call("POST", `/v1/guardian/webhooks/${encodeURIComponent(webhookId)}/test`);

export const listWebhookDeliveries = (g: GuardianClient) =>
  g.call("GET", "/v1/guardian/webhooks/deliveries");
