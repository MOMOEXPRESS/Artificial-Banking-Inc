import type express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { rulesFor } from "./engine.js";
import { store } from "./store.js";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toolResult(text: string, data: JsonRecord) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: data,
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `ABI could not complete this request: ${message}` }],
    isError: true,
  };
}

function describeDecision(data: JsonRecord, fallback: string): string {
  const outcome = typeof data.outcome === "string" ? data.outcome : undefined;
  const intentId = typeof data.intentId === "string" ? data.intentId : undefined;
  const reasons = stringList(data.reasons);
  const apiError = record(data.error);
  const errorMessage = typeof apiError.message === "string" ? apiError.message : undefined;
  const reasonText = reasons.length ? reasons.join(" ") : errorMessage;

  if (outcome === "allow") {
    const amount =
      typeof data.amountUsdc === "string" ? ` ABI recorded $${data.amountUsdc} USDC.` : "";
    const rail = typeof data.rail === "string" ? ` Rail: ${data.rail}.` : "";
    const txHash = typeof data.txHash === "string" ? ` Transaction hash: ${data.txHash}.` : "";
    return `ABI allowed and completed the request.${amount}${rail}${txHash}${intentId ? ` Intent: ${intentId}.` : ""}`;
  }
  if (outcome === "review") {
    const approvalId = typeof data.approvalId === "string" ? data.approvalId : "pending approval";
    return `ABI paused the request for a human decision. Approval: ${approvalId}.${reasonText ? ` Reason: ${reasonText}.` : ""}${intentId ? ` Intent: ${intentId}.` : ""}`;
  }
  if (outcome === "deny") {
    return `ABI denied the request.${reasonText ? ` Reason: ${reasonText}.` : ""}${intentId ? ` Intent: ${intentId}.` : ""}`;
  }
  if (errorMessage)
    return `ABI did not complete the request. ${errorMessage}${intentId ? ` Intent: ${intentId}.` : ""}`;
  return fallback;
}

async function agentRequest(
  baseUrl: string,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<JsonRecord> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = record(await response.json().catch(() => ({})));
  // A policy deny or a rail failure is a valid financial result, not an MCP
  // transport error. Return it so the model can explain what ABI decided.
  if (!response.ok && !body.intentId && !body.outcome) {
    const apiError = record(body.error);
    throw new Error(
      typeof apiError.message === "string"
        ? apiError.message
        : typeof apiError.code === "string"
          ? apiError.code
          : `ABI API returned HTTP ${response.status}`,
    );
  }
  return body;
}

function createServer(input: {
  token: string;
  baseUrl: string;
  agentId: string;
  agentName: string;
  orgId: string;
  scopes: string[];
}) {
  const server = new McpServer({ name: "abi-sandbox", version: "0.1.0" });
  const policy = rulesFor(input.agentId, input.orgId);
  const allowedApiDestinations = [...policy.vendorAllowlist, ...policy.domainAllowlist];

  server.registerTool(
    "abi_get_spending_capacity",
    {
      title: "Get ABI spending capacity",
      description:
        "Use before proposing a purchase. Returns the authenticated ABI agent, its available sandbox budget, remaining daily authority, freeze state, and approved API merchants.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      try {
        const data = await agentRequest(input.baseUrl, input.token, "/v1/agent/budget");
        const available = typeof data.availableUsdc === "string" ? data.availableUsdc : "unknown";
        const daily =
          typeof data.dailyRemainingUsdc === "string" ? data.dailyRemainingUsdc : "unknown";
        const frozen = data.frozen === true;
        const enriched = {
          ...data,
          environment: "sandbox",
          connectionAgent: input.agentName,
          allowedApiDestinations,
        };
        return toolResult(
          `${input.agentName} is authenticated to ABI Sandbox. Available budget: $${available} USDC. Daily authority remaining: $${daily} USDC. ${frozen ? "Spending is frozen." : "Spending is active."}${allowedApiDestinations.length ? ` Approved API merchants include ${allowedApiDestinations.join(", ")}.` : " No API merchants are currently approved."}`,
          enriched,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "abi_simulate_payment",
    {
      title: "Check a payment with ABI",
      description:
        "Dry-run a proposed payment against the real ABI policy engine without moving sandbox funds. Use paymentKind=api for a digital service or x402-style merchant; use wallet for an on-chain address.",
      inputSchema: {
        amountUsdc: z.string().min(1).describe("Decimal USDC amount, for example 0.01"),
        destination: z
          .string()
          .min(1)
          .describe(
            "API merchant/domain or 0x wallet address. The bundled demo merchant is data.example.",
          ),
        paymentKind: z.enum(["api", "wallet"]).default("api"),
        purpose: z.string().max(240).optional().describe("Plain-language reason for the purchase"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ amountUsdc, destination, paymentKind, purpose }) => {
      try {
        const data = await agentRequest(input.baseUrl, input.token, "/v1/agent/simulate", {
          method: "POST",
          body: JSON.stringify({
            tool: paymentKind === "wallet" ? "pay" : "pay_api",
            amountUsdc,
            destination,
            jobId: purpose,
          }),
        });
        const outcome = typeof data.outcome === "string" ? data.outcome.toUpperCase() : "UNKNOWN";
        const reasons = stringList(data.reasons);
        return toolResult(
          `ABI simulation result: ${outcome}. ${reasons.length ? reasons.join(" ") : "The policy engine returned no additional explanation."} No funds moved.`,
          { ...data, amountUsdc, destination, purpose: purpose ?? null, simulated: true },
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  if (input.scopes.includes("pay")) {
    server.registerTool(
      "abi_propose_payment",
      {
        title: "Propose an ABI payment",
        description:
          "Submit a genuine payment request to ABI Sandbox. ABI will allow, deny, or route it to human approval under the authenticated agent's policies. This changes the sandbox ledger when allowed. Use data.example for the bundled approved demo research merchant.",
        inputSchema: {
          amountUsdc: z.string().min(1).describe("Decimal USDC amount, for example 0.01"),
          destination: z.string().min(1).describe("Approved merchant/domain or 0x wallet address"),
          paymentKind: z.enum(["api", "wallet"]).default("api"),
          purpose: z.string().min(1).max(240).describe("What the agent is purchasing and why"),
          idempotencyKey: z
            .string()
            .min(8)
            .max(120)
            .describe(
              "Stable unique request ID. Reuse the same value when retrying the same purchase.",
            ),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ amountUsdc, destination, paymentKind, purpose, idempotencyKey }) => {
        try {
          const endpoint = paymentKind === "wallet" ? "/v1/agent/pay" : "/v1/agent/pay_api";
          const data = await agentRequest(input.baseUrl, input.token, endpoint, {
            method: "POST",
            body: JSON.stringify({ amountUsdc, destination, idempotencyKey, memo: purpose }),
          });
          return toolResult(describeDecision(data, "ABI processed the payment request."), {
            ...data,
            amountRequestedUsdc: amountUsdc,
            destination,
            purpose,
            environment: "sandbox",
            authenticatedAgent: input.agentName,
          });
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }

  server.registerTool(
    "abi_list_activity",
    {
      title: "List ABI agent activity",
      description:
        "List recent real policy decisions recorded for this authenticated ABI agent. Use it to confirm that an external request reached ABI.",
      inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ limit }) => {
      try {
        const data = await agentRequest(
          input.baseUrl,
          input.token,
          `/v1/agent/activity?limit=${encodeURIComponent(String(limit))}`,
        );
        const decisions = Array.isArray(data.decisions) ? data.decisions : [];
        const text = decisions.length
          ? `ABI returned ${decisions.length} recent decision${decisions.length === 1 ? "" : "s"} for ${input.agentName}. The newest decision is included first in the structured result.`
          : `ABI has no recorded decisions yet for ${input.agentName}.`;
        return toolResult(text, data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "abi_get_decision",
    {
      title: "Explain an ABI decision",
      description:
        "Look up one ABI policy decision by intent ID and explain why it was allowed, denied, or reviewed.",
      inputSchema: { intentId: z.string().min(1) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ intentId }) => {
      try {
        const data = await agentRequest(
          input.baseUrl,
          input.token,
          `/v1/agent/decisions/${encodeURIComponent(intentId)}`,
        );
        const decision = record(data.decision);
        return toolResult(describeDecision(decision, "ABI returned the requested decision."), data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}

function methodNotAllowed(res: express.Response) {
  res
    .status(405)
    .set("Allow", "POST")
    .json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use MCP Streamable HTTP over POST." },
      id: null,
    });
}

/**
 * Remote MCP proof endpoint for ChatGPT developer mode.
 *
 * The session token is deliberately short-lived and revocable. It appears in
 * the connector URL only because the first proof uses ChatGPT's no-auth custom
 * app mode; production replaces this bootstrap shape with OAuth. Live-money
 * organizations are rejected even if a valid token is supplied.
 */
export function registerRemoteMcp(app: express.Express) {
  app.post("/mcp/:token", async (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    const token = req.params.token;
    const session = token?.startsWith("pv_sess_") ? store.getSessionByToken(token) : undefined;
    if (!session || !session.scopes.includes("read")) {
      return res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Invalid, expired, revoked, or unreadable ABI session." },
        id: null,
      });
    }
    if (store.getOrgLedgerMode(session.agent.orgId) !== "sandbox") {
      return res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32003, message: "This developer-mode MCP endpoint is sandbox-only." },
        id: null,
      });
    }

    // Loop back to the same listener so MCP uses the exact public agent routes,
    // auth checks, policy engine, idempotency, rail, ledger, and audit trail.
    // Deriving the port from the socket avoids trusting the caller's Host header.
    const localPort = req.socket.localPort;
    if (!localPort) {
      return res.status(503).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "ABI could not resolve its internal API listener." },
        id: null,
      });
    }

    const server = createServer({
      token,
      baseUrl: `http://127.0.0.1:${localPort}`,
      agentId: session.agent.id,
      agentName: session.agent.name,
      orgId: session.agent.orgId,
      scopes: session.scopes,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      console.error("remote MCP request failed:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "ABI MCP request failed." },
          id: null,
        });
      }
    }
  });
  app.get("/mcp/:token", (_req, res) => methodNotAllowed(res));
  app.delete("/mcp/:token", (_req, res) => methodNotAllowed(res));
}
