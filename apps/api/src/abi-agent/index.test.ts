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
    assert.match(res.answer, /ABI surveyed/);
    assert.match(res.answer, /Researcher/);
  });
});
