/**
 * Transport for the production flows.
 *
 * There are exactly two ways the console talks to ABI, and the playground uses
 * the same two as the rest of the product:
 *
 * - **Guardian** calls go through the console's own `gFetch`: the httpOnly
 *   session cookie, the double-submit CSRF header, the `x-abi-org` header and
 *   the step-up interceptor. The playground used to send
 *   `Authorization: Bearer ${session.guardianKey}` instead, which is an empty
 *   string for a signed-in user, so every guardian mutation it made (saving the
 *   run record, webhooks, policy) was refused with CSRF_FAILED.
 * - **Agent** calls carry the agent's own bearer key, exactly like an agent
 *   running outside the console.
 */

export type FlowResult = { status: number; data: Record<string, unknown> };

export type GuardianFetch = (path: string, init?: RequestInit) => Promise<Response>;

export interface GuardianClient {
  call(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<FlowResult>;
}

export interface AgentClient {
  call(method: "GET" | "POST", path: string, body?: unknown): Promise<FlowResult>;
}

async function toResult(res: Response): Promise<FlowResult> {
  return {
    status: res.status,
    data: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>,
  };
}

/** Guardian client over the console's authenticated fetch. */
export function guardianClient(gFetch: GuardianFetch): GuardianClient {
  return {
    async call(method, path, body) {
      const res = await gFetch(path, {
        method,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return toResult(res);
    },
  };
}

/** Agent client: the agent's bearer key, same as any external agent. */
export function agentClient(
  api: string,
  agentKey: string,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): AgentClient {
  return {
    async call(method, path, body) {
      const res = await fetchImpl(`${api}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${agentKey}` },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return toResult(res);
    },
  };
}

export const errCode = (d: Record<string, unknown>) =>
  (d.error as Record<string, string> | undefined)?.code ?? "ERROR";
export const errMsg = (d: Record<string, unknown>) =>
  (d.error as Record<string, string> | undefined)?.message ?? "";
