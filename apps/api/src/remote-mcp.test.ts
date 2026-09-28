import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const dir = mkdtempSync(join(tmpdir(), "abi-remote-mcp-"));
process.env.POLICYVAULT_DB = join(dir, "mcp.db");
process.env.ABI_KEY_PEPPER = "remote-mcp-test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";

const { store } = await import("./store.js");
const { app } = await import("./index.js");

let base = "";
let server: ReturnType<typeof app.listen>;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

function fixture(scopes: string[]) {
  const org = store.createOrg("External Agent Proof", 10_000_000n);
  const agent = store.createAgent(org.id, "Research Agent");
  store.applyEntries(org.id, [
    {
      id: `mcp_seed_${agent.agentId}`,
      orgId: org.id,
      memo: "fund external agent proof",
      createdAt: new Date().toISOString(),
      lines: [
        { accountId: `org:${org.id}:available`, deltaMicro: -5_000_000n },
        { accountId: `agent:${agent.agentId}:available`, deltaMicro: 5_000_000n },
      ],
    },
  ]);
  const session = store.createSessionKey({
    orgId: org.id,
    agentId: agent.agentId,
    label: "ChatGPT proof",
    scopes,
    ttlHours: 1,
  });
  return { org, agent, session };
}

async function connect(token: string) {
  const client = new Client({ name: "abi-test-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp/${token}`));
  await client.connect(transport);
  return { client, transport };
}

describe("remote MCP sandbox connector", () => {
  it("rejects a request without a live scoped session", async () => {
    const response = await fetch(`${base}/mcp/pv_sess_not-real`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "invalid", version: "1" },
        },
      }),
    });
    assert.equal(response.status, 401);
  });

  it("does not expose the write tool to a read-only connection", async () => {
    const { session } = fixture(["read"]);
    const { client } = await connect(session.token!);
    try {
      const tools = await client.listTools();
      assert.ok(tools.tools.some((tool) => tool.name === "abi_get_spending_capacity"));
      assert.ok(!tools.tools.some((tool) => tool.name === "abi_propose_payment"));
    } finally {
      await client.close();
    }
  });

  it("runs a real policy-gated sandbox payment and records the decision", async () => {
    const { agent, session } = fixture(["read", "pay"]);
    const { client } = await connect(session.token!);
    try {
      const tools = await client.listTools();
      assert.ok(tools.tools.some((tool) => tool.name === "abi_propose_payment"));

      const result = await client.callTool({
        name: "abi_propose_payment",
        arguments: {
          amountUsdc: "0.01",
          destination: "data.example",
          paymentKind: "api",
          purpose: "Purchase a sandbox research report",
          idempotencyKey: "chatgpt-proof-0001",
        },
      });
      assert.equal(result.isError, undefined);
      assert.equal((result.structuredContent as { outcome?: string })?.outcome, "allow");

      const activity = await client.callTool({
        name: "abi_list_activity",
        arguments: { limit: 5 },
      });
      const decisions = (activity.structuredContent as { decisions?: { agentId: string }[] })
        ?.decisions;
      assert.equal(decisions?.[0]?.agentId, agent.agentId);
      assert.equal(store.spentLast24h(agent.agentId), 10_000n);
    } finally {
      await client.close();
    }
  });
});
