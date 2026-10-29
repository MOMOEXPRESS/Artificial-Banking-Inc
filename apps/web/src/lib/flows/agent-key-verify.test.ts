import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GuardianClient } from "./client";
import { agentKeyRefusal, verifyAgentKey } from "./guardian";

describe("playground pasted-key ownership check", () => {
  it("posts the key to /v1/guardian/agent-keys/verify", async () => {
    const calls: unknown[][] = [];
    const g = {
      call: async (...args: unknown[]) => {
        calls.push(args);
        return { status: 200, data: { agentId: "agt_1" } };
      },
    } as unknown as GuardianClient;
    await verifyAgentKey(g, "pv_agent_x");
    assert.deepEqual(calls, [["POST", "/v1/guardian/agent-keys/verify", { key: "pv_agent_x" }]]);
  });

  it("refuses on >=400 with the server message", () => {
    const r = agentKeyRefusal(
      { status: 403, data: { error: { code: "KEY_ORG_MISMATCH", message: "Not this org" } } },
      "agt_1",
    );
    assert.equal(r, "Not this org");
    assert.ok(agentKeyRefusal({ status: 401, data: {} }, "agt_1"));
  });

  it("refuses when the verified agent differs from the budget agent", () => {
    assert.ok(agentKeyRefusal({ status: 200, data: { agentId: "agt_2" } }, "agt_1"));
    assert.ok(agentKeyRefusal({ status: 200, data: {} }, "agt_1"));
  });

  it("accepts a matching key", () => {
    assert.equal(agentKeyRefusal({ status: 200, data: { agentId: "agt_1" } }, "agt_1"), null);
  });
});
