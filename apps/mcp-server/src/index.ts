#!/usr/bin/env node
/**
 * MCP server exposing PolicyVault agent money tools.
 * Env: POLICYVAULT_API_URL, POLICYVAULT_API_KEY
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { PolicyVaultClient } from "@policyvault/sdk";

const baseUrl = process.env.POLICYVAULT_API_URL ?? "http://localhost:8787";
const apiKey = process.env.POLICYVAULT_API_KEY ?? "";

const client = new PolicyVaultClient({ baseUrl, apiKey });

const server = new Server(
  { name: "policyvault", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_budget",
      description: "Get agent available/held USDC and remaining daily cap",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "simulate_payment",
      description: "Dry-run policy for a payment without moving funds",
      inputSchema: {
        type: "object",
        properties: {
          tool: { type: "string", enum: ["pay", "pay_api"] },
          amountUsdc: { type: "string" },
          destination: { type: "string" },
          jobId: { type: "string" },
        },
        required: ["tool", "amountUsdc", "destination"],
      },
    },
    {
      name: "pay_api",
      description: "Pay an allowlisted API vendor (x402/mock) under policy",
      inputSchema: {
        type: "object",
        properties: {
          amountUsdc: { type: "string" },
          destination: { type: "string" },
          idempotencyKey: { type: "string" },
          jobId: { type: "string" },
          memo: { type: "string" },
        },
        required: ["amountUsdc", "destination", "idempotencyKey"],
      },
    },
    {
      name: "pay",
      description: "Transfer USDC to an allowlisted address under policy",
      inputSchema: {
        type: "object",
        properties: {
          amountUsdc: { type: "string" },
          destination: { type: "string" },
          idempotencyKey: { type: "string" },
          jobId: { type: "string" },
        },
        required: ["amountUsdc", "destination", "idempotencyKey"],
      },
    },
    {
      name: "escrow_lock",
      description:
        "Lock USDC in escrow to hire another agent in the same org. Funds release to the payee when you call escrow_release, or refund to you on escrow_refund/timeout.",
      inputSchema: {
        type: "object",
        properties: {
          amountUsdc: { type: "string" },
          payeeAgentId: { type: "string" },
          idempotencyKey: { type: "string" },
          jobId: { type: "string" },
          memo: { type: "string" },
          timeoutMinutes: { type: "number" },
        },
        required: ["amountUsdc", "payeeAgentId", "idempotencyKey"],
      },
    },
    {
      name: "escrow_status",
      description: "Get the state of an escrow (locked/settling/released/refunded/timeout_refunded)",
      inputSchema: {
        type: "object",
        properties: { escrowId: { type: "string" } },
        required: ["escrowId"],
      },
    },
    {
      name: "escrow_release",
      description: "Accept delivery: release escrowed funds to the payee agent (payer only)",
      inputSchema: {
        type: "object",
        properties: { escrowId: { type: "string" } },
        required: ["escrowId"],
      },
    },
    {
      name: "escrow_refund",
      description: "Return escrowed funds to the payer (either party may call)",
      inputSchema: {
        type: "object",
        properties: { escrowId: { type: "string" } },
        required: ["escrowId"],
      },
    },
    {
      name: "get_approval",
      description:
        "Check a pending guardian approval by approvalId (returned when a payment needs human approval)",
      inputSchema: {
        type: "object",
        properties: { approvalId: { type: "string" } },
        required: ["approvalId"],
      },
    },
    {
      name: "wait_for_approval",
      description:
        "Poll a pending approval until it is approved, denied, expired, or maxWaitMs elapses",
      inputSchema: {
        type: "object",
        properties: {
          approvalId: { type: "string" },
          pollMs: { type: "number" },
          maxWaitMs: { type: "number" },
        },
        required: ["approvalId"],
      },
    },
    {
      name: "list_activity",
      description: "List recent policy decisions for this agent",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number" } },
        additionalProperties: false,
      },
    },
    {
      name: "get_decision",
      description: "Look up a single policy decision by intentId",
      inputSchema: {
        type: "object",
        properties: { intentId: { type: "string" } },
        required: ["intentId"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!apiKey) {
    return {
      content: [
        {
          type: "text",
          text: "POLICYVAULT_API_KEY is not set",
        },
      ],
      isError: true,
    };
  }

  const { name, arguments: args } = request.params;
  try {
    if (name === "get_budget") {
      const data = await client.getBudget();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
    if (name === "simulate_payment") {
      const a = args as {
        tool: "pay" | "pay_api";
        amountUsdc: string;
        destination: string;
        jobId?: string;
      };
      const data = await client.simulatePayment(a);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
    if (name === "pay_api") {
      const a = args as {
        amountUsdc: string;
        destination: string;
        idempotencyKey: string;
        jobId?: string;
        memo?: string;
      };
      const data = await client.payApi(a);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
    if (name === "pay") {
      const a = args as {
        amountUsdc: string;
        destination: string;
        idempotencyKey: string;
        jobId?: string;
      };
      const data = await client.pay(a);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
    if (name === "escrow_lock") {
      const a = args as {
        amountUsdc: string;
        payeeAgentId: string;
        idempotencyKey: string;
        jobId?: string;
        memo?: string;
        timeoutMinutes?: number;
      };
      const data = await client.escrowLock(a);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
    if (name === "escrow_status") {
      const data = await client.getEscrow((args as { escrowId: string }).escrowId);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
    if (name === "escrow_release") {
      const data = await client.escrowRelease((args as { escrowId: string }).escrowId);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
    if (name === "escrow_refund") {
      const data = await client.escrowRefund((args as { escrowId: string }).escrowId);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
    if (name === "get_approval") {
      const data = await client.getApproval((args as { approvalId: string }).approvalId);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
    if (name === "wait_for_approval") {
      const a = args as { approvalId: string; pollMs?: number; maxWaitMs?: number };
      const approval = await client.waitForApproval(a.approvalId, {
        pollMs: a.pollMs,
        maxWaitMs: a.maxWaitMs,
      });
      return { content: [{ type: "text", text: JSON.stringify({ approval }, null, 2) }] };
    }
    if (name === "list_activity") {
      const limit = (args as { limit?: number }).limit;
      const data = await client.listActivity(limit);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
    if (name === "get_decision") {
      const data = await client.getDecision((args as { intentId: string }).intentId);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: String(e) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
