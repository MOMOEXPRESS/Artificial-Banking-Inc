import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-abi-"));
process.env.POLICYVAULT_DB = join(dir, "abi.db");
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "1";
process.env.ABI_KEY_PEPPER = "test-pepper";

const { store } = await import("../store.js");
const { runAbiAgent } = await import("./index.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("runAbiAgent", () => {
  it("surveys agents and approvals with tools", () => {
    const demo = store.bootstrapDemo();
    const res = runAbiAgent(demo.orgId, "how are the agents and any pending approvals?");
    assert.ok(res.toolsUsed.includes("list_agents"));
    assert.ok(res.toolsUsed.includes("pending_approvals"));
    assert.match(res.answer, /Agents/);
    assert.match(res.answer, /Researcher/);
  });

  it("reuses prior tools on a short follow-up", () => {
    const demo = store.bootstrapDemo();
    const first = runAbiAgent(demo.orgId, "list our agents");
    assert.ok(first.toolsUsed.includes("list_agents"));
    const second = runAbiAgent(demo.orgId, "what about them?", [
      { role: "user", body: "list our agents" },
      { role: "assistant", body: first.answer, meta: { toolsUsed: first.toolsUsed } },
    ]);
    assert.ok(second.toolsUsed.includes("list_agents"));
  });

  it("drafts a marketing blurb without moving money", () => {
    const demo = store.bootstrapDemo();
    const res = runAbiAgent(demo.orgId, "draft a marketing blurb");
    assert.ok(res.toolsUsed.includes("draft_marketing_blurb"));
    assert.match(res.answer, /Draft \(not published/);
    assert.doesNotMatch(res.answer, /transfer|approve payment|move \$/i);
  });

  it("reports denials and books health", () => {
    const demo = store.bootstrapDemo();
    const res = runAbiAgent(demo.orgId, "any denials? are the books clean?");
    assert.ok(res.toolsUsed.includes("list_denials"));
    assert.ok(res.toolsUsed.includes("books_health"));
  });
});
