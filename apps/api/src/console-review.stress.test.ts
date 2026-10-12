import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "abi-console-review-"));
process.env.POLICYVAULT_DB = join(dir, "isolated.db");
process.env.ABI_KEY_PEPPER = "isolated-review-fixture";
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_RUN_JOBS = "0";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_AGENT = "0";
process.env.ABI_CHAT_LLM = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";
const { store } = await import("./store.js");
const { app } = await import("./index.js");
let base = "";
let server: ReturnType<typeof app.listen>;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("isolated console review and HTTP stress", () => {
  it("reports shared authority consistently without duplicating money per agent", async () => {
    const demo = store.seedDemoOrg();
    const response = await fetch(base + "/v1/guardian/org", {
      headers: { authorization: "Bearer " + demo.guardianKey },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      ledgerMode: string;
      agents: { availableUsdc: string; budget: unknown }[];
      balances: { kind: string }[];
    };
    assert.equal(body.ledgerMode, "sandbox");
    assert.equal(body.agents.length, 2);
    assert.ok(
      body.agents.every(
        (agent: { availableUsdc: string; budget: unknown }) =>
          Number(agent.availableUsdc) === 40 && !!agent.budget,
      ),
    );
    assert.equal(
      body.balances.filter((balance: { kind: string }) => balance.kind === "dept_available").length,
      1,
    );
    assert.equal(store.listAgentGroups(demo.orgId).length, 1);
    assert.equal(demo.orgAvailableUsdc, "60");
  });

  it("handles 600 concurrent-batch reads and dry runs without changing ledger funds", async () => {
    const demo = store.seedDemoOrg();
    const before = [...store.getAccountMap(demo.orgId).values()].map((account) => [
      account.id,
      account.balanceMicro.toString(),
    ]);
    const paths = [
      "/v1/guardian/org",
      "/v1/guardian/budgets",
      "/v1/guardian/agent-groups",
      "/v1/agent/budget",
      "/v1/agent/simulate",
    ];
    const start = performance.now();
    for (let round = 0; round < 30; round++) {
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) => {
          const path = paths[i % paths.length]!;
          const guardian = path.includes("/guardian/");
          return fetch(base + path, {
            method: path.endsWith("/simulate") ? "POST" : "GET",
            headers: {
              authorization: "Bearer " + (guardian ? demo.guardianKey : demo.agentApiKey),
              "content-type": "application/json",
            },
            ...(path.endsWith("/simulate")
              ? {
                  body: JSON.stringify({
                    tool: "pay_api",
                    amountUsdc: "0.01",
                    destination: "data.example",
                  }),
                }
              : {}),
          });
        }),
      );
      for (const response of responses) {
        assert.equal(response.status, 200);
        const result = (await response.json()) as { outcome?: string };
        if (result.outcome) assert.ok(["allow", "review", "deny"].includes(result.outcome));
      }
    }
    assert.deepEqual(
      [...store.getAccountMap(demo.orgId).values()].map((account) => [
        account.id,
        account.balanceMicro.toString(),
      ]),
      before,
    );
    assert.equal(store.listDecisions(demo.orgId).length, 0);
    console.log(
      "Isolated HTTP probe: 600 requests, 20 in flight, " +
        Math.round(performance.now() - start) +
        "ms; no ledger changes.",
    );
  });

  it("bounds a concurrent purchase burst by shared funds and reconciles afterward", async () => {
    const demo = store.seedDemoOrg();
    const destination = "0x2222222222222222222222222222222222222222";
    const policy = store.getPolicyTemplate(demo.orgId);
    store.setPolicyTemplate(demo.orgId, {
      ...policy,
      addressAllowlist: [destination],
      perTxMaxMicro: 10_000_000n,
      dailyMaxMicro: 100_000_000n,
      hitlAboveMicro: 10_000_000n,
      maxPaysPerMinute: 100,
      newCounterpartyCooldownHours: 0,
    });
    store.addKnownCounterparty(demo.orgId, destination);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        fetch(base + "/v1/agent/pay", {
          method: "POST",
          headers: {
            authorization: "Bearer " + demo.agentApiKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            amountUsdc: "5",
            destination,
            idempotencyKey: "review-burst-" + i,
          }),
        }).then(async (response) => (await response.json()) as { outcome?: string }),
      ),
    );
    assert.equal(results.filter((result) => result.outcome === "allow").length, 8);
    const budgetId = store.getAgentAnyOrg(demo.researcherAgentId)!.budgetId!;
    assert.equal(
      store.getAccountMap(demo.orgId).get("dept:" + budgetId + ":available")!.balanceMicro,
      0n,
    );
    assert.equal(
      store.getAccountMap(demo.orgId).get("dept:" + budgetId + ":held")!.balanceMicro,
      0n,
    );
    assert.equal(store.reconcileOrg(demo.orgId).ok, true);
  });
});
