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

export class PolicyVaultClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: PolicyVaultClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
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
