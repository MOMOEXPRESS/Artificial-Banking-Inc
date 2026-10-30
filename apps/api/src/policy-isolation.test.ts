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

  it("monthly is derived as 30 × daily; hourly can be set and cleared", async () => {
    const org = store.createOrg("Caps Co", 100_000_000n);
    const post = (body: unknown) =>
      fetch(`${base}/v1/guardian/policy`, {
        method: "POST",
        headers: { authorization: `Bearer ${org.guardianKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const getPolicy = async () => {
      const view = (await (
        await fetch(`${base}/v1/guardian/policy`, {
          headers: { authorization: `Bearer ${org.guardianKey}` },
        })
      ).json()) as Record<string, unknown>;
      return (view.policy ?? view) as Record<string, unknown>;
    };
    const ok = await post({ maxPaysPerHour: 120 });
    assert.equal(ok.status, 200);
    // Solo daily $50 → monthly $1,500, not the old fixed $500.
    assert.equal(store.getPolicyTemplate(org.id).monthlyMaxMicro, 1_500_000_000n);
    assert.equal(store.getPolicyTemplate(org.id).maxPaysPerHour, 120);
    const policy = await getPolicy();
    assert.equal(policy.monthlyMaxUsdc, "1500");
    assert.equal(policy.maxPaysPerHour, 120);
    // Safety net kept for legacy clients that still send a monthly below daily.
    assert.equal((await post({ monthlyMaxUsdc: "1" })).status, 400, "monthly below daily");
    assert.equal((await post({ maxPaysPerHour: 1 })).status, 400, "hourly below per-minute");
    assert.equal((await post({ monthlyMaxUsdc: null, maxPaysPerHour: null })).status, 200);
    assert.equal(store.getPolicyTemplate(org.id).monthlyMaxMicro, 1_500_000_000n);
    assert.equal(store.getPolicyTemplate(org.id).maxPaysPerHour, undefined);
  });

  it("saving a daily max (headroom) of 2000 or 3000 USDC succeeds and monthly = 30 × daily", async () => {
    const org = store.createOrg("Headroom Co", 100_000_000n);
    const post = (body: unknown) =>
      fetch(`${base}/v1/guardian/policy`, {
        method: "POST",
        headers: { authorization: `Bearer ${org.guardianKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    // Exactly what the policies screen sends: the three judgment bands.
    for (const [daily, monthly] of [
      ["2000", 60_000_000_000n],
      ["3000", 90_000_000_000n],
    ] as const) {
      const res = await post({ hitlAboveUsdc: "10", perTxMaxUsdc: "25", dailyMaxUsdc: daily });
      assert.equal(res.status, 200, `daily ${daily}: ${await res.clone().text()}`);
      const t = store.getPolicyTemplate(org.id);
      assert.equal(t.dailyMaxMicro, BigInt(daily) * 1_000_000n);
      assert.equal(t.monthlyMaxMicro, monthly);
      const body = (await res.json()) as { policy?: Record<string, unknown> };
      if (body.policy) assert.equal(body.policy.monthlyMaxUsdc, String(Number(daily) * 30));
    }
  });

  it("a legacy stored monthly below daily is ignored on read and never blocks a save", async () => {
    const org = store.createOrg("Legacy Co", 100_000_000n);
    store.setPolicyTemplate(org.id, store.getPolicyTemplate(org.id));
    // Simulate a row written before monthly was derived: fixed $500 monthly.
    const Database = (await import("better-sqlite3")).default;
    const raw = new Database(process.env.POLICYVAULT_DB!);
    const row = raw.prepare("SELECT rules_json FROM policies WHERE org_id = ?").get(org.id) as {
      rules_json: string;
    };
    const legacy = { ...JSON.parse(row.rules_json), monthlyMaxMicro: "bigint:500000000" };
    raw
      .prepare("UPDATE policies SET rules_json = ? WHERE org_id = ?")
      .run(JSON.stringify(legacy), org.id);
    raw.close();
    assert.equal(store.getPolicyTemplate(org.id).monthlyMaxMicro, 1_500_000_000n);
    const res = await fetch(`${base}/v1/guardian/policy`, {
      method: "POST",
      headers: { authorization: `Bearer ${org.guardianKey}`, "content-type": "application/json" },
      body: JSON.stringify({ hitlAboveUsdc: "10", perTxMaxUsdc: "25", dailyMaxUsdc: "3000" }),
    });
    assert.equal(res.status, 200);
    assert.equal(store.getPolicyTemplate(org.id).monthlyMaxMicro, 90_000_000_000n);
  });

  it("the runtime always injects 30-day spend; last-hour count only when that cap is set", () => {
    const org = store.createOrg("Runtime Co", 100_000_000n);
    const agent = store.createAgent(org.id, "Counter");
    const t = store.getPolicyTemplate(org.id);
    store.setPolicyTemplate(org.id, { ...t, maxPaysPerHour: undefined });
    let r = rulesFor(agent.agentId, org.id);
    assert.equal(r.spentLast30dMicro, 0n);
    assert.equal(r.paysLastHour, undefined);
    assert.equal(r.monthlyMaxMicro, t.dailyMaxMicro * 30n);
    store.setPolicyTemplate(org.id, { ...t, maxPaysPerHour: 60 });
    store.recordPay(agent.agentId, 3_000_000n, org.id, { destination: "api.openai.com" });
    store.recordPay(agent.agentId, 4_000_000n, org.id, { destination: "api.openai.com" });
    r = rulesFor(agent.agentId, org.id);
    assert.equal(r.spentLast30dMicro, 7_000_000n);
    assert.equal(r.paysLastHour, 2);
  });
});
