/**
 * The policy engine is separate from the agent: an agent credential can
 * neither read nor change its own policy. Every policy-writing route is a
 * guardian route; an agent key gets 401 and the stored policy is unchanged.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-iso-"));
process.env.POLICYVAULT_DB = join(dir, "iso.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";

const { store } = await import("./store.js");
const { app } = await import("./index.js");
const { rulesFor } = await import("./engine.js");

let base = "";
let server: ReturnType<typeof app.listen>;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
function routes(): { method: string; path: string }[] {
  const stack = (app as unknown as { _router: { stack: Layer[] } })._router.stack;
  return stack
    .filter((l) => l.route && typeof l.route.path === "string")
    .flatMap((l) =>
      Object.keys(l.route!.methods).map((m) => ({ method: m.toUpperCase(), path: l.route!.path })),
    );
}

describe("policy isolation from agents", () => {
  it("no /v1/agent route reads or writes policy", () => {
    const agentRoutes = routes().filter((r) => r.path.startsWith("/v1/agent"));
    assert.ok(agentRoutes.length > 5);
    for (const r of agentRoutes) {
      assert.doesNotMatch(r.path, /polic|template|quorum|override/i, `${r.method} ${r.path}`);
    }
  });

  it("every policy route rejects an agent key and leaves the policy unchanged", async () => {
    const org = store.createOrg("Iso Co", 100_000_000n);
    const agent = store.createAgent(org.id, "Sneaky");
    const before = JSON.stringify(store.getPolicyTemplate(org.id), (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    const versionBefore = store.getPolicyVersion(org.id);
    const policyRoutes = routes().filter((r) => /polic|quorum/i.test(r.path));
    assert.ok(policyRoutes.some((r) => r.method === "POST" && r.path === "/v1/guardian/policy"));
    assert.ok(
      policyRoutes.some((r) => r.method === "PUT" && r.path === "/v1/guardian/agents/:id/policy"),
    );
    for (const r of policyRoutes) {
      const path = r.path.replace(/:id\b/g, r.path.includes("agents") ? agent.agentId : "v1");
      const res = await fetch(`${base}${path}`, {
        method: r.method,
        headers: { authorization: `Bearer ${agent.apiKey}`, "content-type": "application/json" },
        ...(r.method === "GET"
          ? {}
          : {
              body: JSON.stringify({
                perTxMaxUsdc: "100000",
                dailyMaxUsdc: "100000",
                templateId: "api_seller",
              }),
            }),
      });
      assert.equal(res.status, 401, `${r.method} ${r.path} must reject an agent key`);
    }
    const afterJson = JSON.stringify(store.getPolicyTemplate(org.id), (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    assert.equal(afterJson, before);
    assert.equal(store.getPolicyVersion(org.id), versionBefore);
  });

  it("guardians can set and clear the monthly and hourly caps", async () => {
    const org = store.createOrg("Caps Co", 100_000_000n);
    const post = (body: unknown) =>
      fetch(`${base}/v1/guardian/policy`, {
        method: "POST",
        headers: { authorization: `Bearer ${org.guardianKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const ok = await post({ monthlyMaxUsdc: "900", maxPaysPerHour: 120 });
    assert.equal(ok.status, 200);
    assert.equal(store.getPolicyTemplate(org.id).monthlyMaxMicro, 900_000_000n);
    assert.equal(store.getPolicyTemplate(org.id).maxPaysPerHour, 120);
    const view = (await (
      await fetch(`${base}/v1/guardian/policy`, {
        headers: { authorization: `Bearer ${org.guardianKey}` },
      })
    ).json()) as Record<string, unknown>;
    const policy = (view.policy ?? view) as Record<string, unknown>;
    assert.equal(policy.monthlyMaxUsdc, "900");
    assert.equal(policy.maxPaysPerHour, 120);
    assert.equal((await post({ monthlyMaxUsdc: "1" })).status, 400, "monthly below daily");
    assert.equal((await post({ maxPaysPerHour: 1 })).status, 400, "hourly below per-minute");
    assert.equal((await post({ monthlyMaxUsdc: null, maxPaysPerHour: null })).status, 200);
    assert.equal(store.getPolicyTemplate(org.id).monthlyMaxMicro, undefined);
    assert.equal(store.getPolicyTemplate(org.id).maxPaysPerHour, undefined);
  });

  it("the runtime injects 30-day spend and last-hour count only when the caps are configured", () => {
    const org = store.createOrg("Runtime Co", 100_000_000n);
    const agent = store.createAgent(org.id, "Counter");
    const t = store.getPolicyTemplate(org.id);
    store.setPolicyTemplate(org.id, {
      ...t,
      monthlyMaxMicro: undefined,
      maxPaysPerHour: undefined,
    });
    let r = rulesFor(agent.agentId, org.id);
    assert.equal(r.spentLast30dMicro, undefined);
    assert.equal(r.paysLastHour, undefined);
    store.setPolicyTemplate(org.id, { ...t, monthlyMaxMicro: 500_000_000n, maxPaysPerHour: 60 });
    store.recordPay(agent.agentId, 3_000_000n, org.id, { destination: "api.openai.com" });
    store.recordPay(agent.agentId, 4_000_000n, org.id, { destination: "api.openai.com" });
    r = rulesFor(agent.agentId, org.id);
    assert.equal(r.spentLast30dMicro, 7_000_000n);
    assert.equal(r.paysLastHour, 2);
  });
});
