import type { AgentErrorCode } from "@policyvault/common";

export interface PolicyVaultClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

export class PolicyVaultApiError extends Error {
  constructor(
    public code: AgentErrorCode | string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "PolicyVaultApiError";
  }
}

/** Shared HTTP transport for agent + guardian SDKs. */
class AbiHttpClient {
  protected readonly baseUrl: string;
  protected readonly apiKey: string;
  protected readonly fetchImpl: typeof fetch;

  constructor(opts: PolicyVaultClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  protected async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    if (!res.ok) {
      throw new PolicyVaultApiError(
        body.error?.code ?? "RAIL_FAILED",
        body.error?.message ?? res.statusText,
        res.status,
      );
    }
    return body as T;
  }
}

/** Agent money verbs — authenticate with `pv_agent_…`. */
export class PolicyVaultClient extends AbiHttpClient {
  getBudget() {
    return this.request<{
      availableUsdc: string;
      heldUsdc: string;
      dailyRemainingUsdc: string;
    }>("/v1/agent/budget");
  }

  simulatePayment(input: {
    tool: string;
    amountUsdc: string;
    destination: string;
    jobId?: string;
  }) {
    return this.request<{ outcome: string; ruleIds: string[]; reasons: string[] }>(
      "/v1/agent/simulate",
      { method: "POST", body: JSON.stringify(input) },
    );
  }

  payApi(input: {
    amountUsdc: string;
    destination: string;
    idempotencyKey: string;
    jobId?: string;
    memo?: string;
  }) {
    return this.request<{
      intentId: string;
      outcome: string;
      receiptId?: string;
    }>("/v1/agent/pay_api", { method: "POST", body: JSON.stringify(input) });
  }

  pay(input: {
    amountUsdc: string;
    destination: string;
    idempotencyKey: string;
    jobId?: string;
  }) {
    return this.request<{ intentId: string; outcome: string }>("/v1/agent/pay", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** Lock USDC in escrow for another agent in the same org. */
  escrowLock(input: {
    amountUsdc: string;
    payeeAgentId: string;
    idempotencyKey: string;
    jobId?: string;
    memo?: string;
    timeoutMinutes?: number;
  }) {
    return this.request<{
      intentId: string;
      outcome: string;
      escrowId?: string;
      approvalId?: string;
      state?: string;
      timeoutAt?: string;
    }>("/v1/agent/escrow/lock", { method: "POST", body: JSON.stringify(input) });
  }

  getEscrow(escrowId: string) {
    return this.request<{ escrow: EscrowView }>(`/v1/agent/escrow/${escrowId}`);
  }

  /** Payer accepts delivery — funds move to the payee agent. */
  escrowRelease(escrowId: string) {
    return this.request<{ ok: boolean; escrow: EscrowView }>(
      `/v1/agent/escrow/${escrowId}/release`,
      { method: "POST", body: "{}" },
    );
  }

  /** Either party returns funds to the payer. */
  escrowRefund(escrowId: string) {
    return this.request<{ ok: boolean; escrow: EscrowView }>(
      `/v1/agent/escrow/${escrowId}/refund`,
      { method: "POST", body: "{}" },
    );
  }

  getApproval(approvalId: string) {
    return this.request<{ approval: ApprovalView }>(`/v1/agent/approvals/${approvalId}`);
  }

  /**
   * Poll an approval until it leaves pending state or maxWaitMs elapses.
   * Returns the final approval row; callers should treat non-approved as a
   * recoverable task error, not retry the payment.
   */
  async waitForApproval(
    approvalId: string,
    opts: { pollMs?: number; maxWaitMs?: number } = {},
  ): Promise<ApprovalView> {
    const pollMs = opts.pollMs ?? 3_000;
    const deadline = Date.now() + (opts.maxWaitMs ?? 5 * 60_000);
    for (;;) {
      const { approval } = await this.getApproval(approvalId);
      if (approval.status !== "pending" || Date.now() >= deadline) return approval;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}

/** Guardian operator surface — authenticate with `pv_guardian_…`. */
export class AbiGuardianClient extends AbiHttpClient {
  getOrg() {
    return this.request<{
      org: { id: string; name: string; status: string; settings?: Record<string, unknown> };
      agents: unknown[];
      balances: unknown[];
    }>("/v1/guardian/org");
  }

  listAgents() {
    return this.request<{ agents: unknown[] }>("/v1/guardian/agents");
  }

  getAgent(agentId: string) {
    return this.request<Record<string, unknown>>(`/v1/guardian/agents/${agentId}`);
  }

  createAgent(name: string, profile?: Record<string, unknown>) {
    return this.request<{ agentId: string; apiKey: string; identity: unknown }>(
      "/v1/guardian/agents",
      { method: "POST", body: JSON.stringify({ name, profile }) },
    );
  }

  updateAgent(agentId: string, patch: { name?: string; profile?: Record<string, unknown> }) {
    return this.request<{ identity: unknown }>(`/v1/guardian/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  freezeAgent(agentId: string, reason = "manual") {
    return this.request<{ ok: boolean }>(`/v1/guardian/agents/${agentId}/freeze`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  unfreezeAgent(agentId: string) {
    return this.request<{ ok: boolean }>(`/v1/guardian/agents/${agentId}/unfreeze`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  rotateAgentKey(agentId: string) {
    return this.request<{ agentId: string; apiKey: string }>(
      `/v1/guardian/agents/${agentId}/rotate-key`,
      { method: "POST", body: JSON.stringify({}) },
    );
  }

  revokeAgentKey(agentId: string) {
    return this.request<{ ok: boolean }>(`/v1/guardian/agents/${agentId}/revoke-key`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  listAgentGroups() {
    return this.request<{ groups: unknown[] }>("/v1/guardian/agent-groups");
  }

  listFreezes() {
    return this.request<{ freezes: unknown[] }>("/v1/guardian/freezes");
  }

  getPolicy() {
    return this.request<{ policy: Record<string, unknown>; version?: string }>("/v1/guardian/policy");
  }

  updatePolicy(patch: Record<string, unknown>) {
    return this.request<{ ok: boolean; policy: Record<string, unknown> }>("/v1/guardian/policy", {
      method: "POST",
      body: JSON.stringify(patch),
    });
  }

  simulatePolicy(change: Record<string, unknown>) {
    return this.request<{ simulation: unknown }>("/v1/guardian/policy/simulate", {
      method: "POST",
      body: JSON.stringify(change),
    });
  }

  listPolicyVersions() {
    return this.request<{ current: string; versions: unknown[] }>("/v1/guardian/policy/versions");
  }

  restorePolicyVersion(id: string) {
    return this.request<{ ok: boolean }>(`/v1/guardian/policy/versions/${id}/restore`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  listPolicyTemplates() {
    return this.request<{ templates: unknown[] }>("/v1/guardian/policy/templates");
  }

  applyPolicyTemplate(templateId: string, keepAllowlists = true) {
    return this.request<{ ok: boolean }>("/v1/guardian/policy/apply-template", {
      method: "POST",
      body: JSON.stringify({ templateId, keepAllowlists }),
    });
  }

  getQuorum() {
    return this.request<{ approvalQuorum: number; seats: number }>("/v1/guardian/quorum");
  }

  setQuorum(approvalQuorum: number) {
    return this.request<{ ok: boolean }>("/v1/guardian/quorum", {
      method: "POST",
      body: JSON.stringify({ approvalQuorum }),
    });
  }

  listInvoices() {
    return this.request<{ invoices: unknown[] }>("/v1/guardian/invoices");
  }

  listSubscriptions() {
    return this.request<{ subscriptions: unknown[] }>("/v1/guardian/subscriptions");
  }

  listEscrows() {
    return this.request<{ escrows: unknown[] }>("/v1/guardian/escrows");
  }

  schedulePayment(input: {
    agentId: string;
    vendor: string;
    amountUsdc: string;
    runAt?: string;
    memo?: string;
  }) {
    return this.request<{ scheduled: unknown }>("/v1/guardian/payments/schedule", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  batchSchedule(items: {
    agentId: string;
    vendor: string;
    amountUsdc: string;
    runAt?: string;
    memo?: string;
  }[]) {
    return this.request<{ created: unknown[]; errors: unknown[] }>(
      "/v1/guardian/payments/batch",
      { method: "POST", body: JSON.stringify({ items }) },
    );
  }

  listPaymentRails() {
    return this.request<{ rails: unknown[] }>("/v1/guardian/payments/rails");
  }

  listMerchants() {
    return this.request<{ merchants: unknown[] }>("/v1/guardian/merchants");
  }

  listApprovals(status?: string) {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request<{ approvals: ApprovalView[] }>(`/v1/guardian/approvals${q}`);
  }
}

/** @deprecated Prefer PolicyVaultClient. */
export { PolicyVaultClient as AbiAgentClient };

export interface EscrowView {
  id: string;
  orgId: string;
  payerAgentId: string;
  payeeAgentId: string;
  amountUsdc: string;
  state: "locked" | "released" | "refunded" | "timeout_refunded";
  jobId?: string;
  memo?: string;
  createdAt: string;
  timeoutAt: string;
  resolvedAt?: string;
}

export interface ApprovalView {
  id: string;
  intentId: string;
  tool: string;
  amountUsdc: string;
  destination: string;
  status: "pending" | "approved" | "denied" | "expired";
  reasons: string[];
  createdAt: string;
  expiresAt: string;
  result?: unknown;
}
