/**
 * Auto-fund sweep tops up members below threshold from the linked budget.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { accountId, parseUsdcToMicro } from "@policyvault/common";
import { transferAvailable } from "@policyvault/ledger";

const dir = mkdtempSync(join(tmpdir(), "pv-autofund-"));
process.env.POLICYVAULT_DB = join(dir, "af.db");
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "1";
process.env.ABI_KEY_PEPPER = "test-pepper";

const { store } = await import("./store.js");
const { runAutoFundSweep } = await import("./auto-fund.js");
const { id } = await import("./engine.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("runAutoFundSweep", () => {
  it("tops up a low agent from the linked budget when enabled", () => {
    const demo = store.bootstrapDemo();
    const budget = store.createDepartment(demo.orgId, "Finance");
    // Fund budget from org vault.
    store.applyEntries(demo.orgId, [
      transferAvailable({
        orgId: demo.orgId,
        journalId: id("j"),
        fromAvailableId: accountId("org", demo.orgId),
        toAvailableId: accountId("department", budget.id),
        amountMicro: parseUsdcToMicro("50"),
        memo: "seed_budget",
      }),
    ]);
    const group = store.createAgentGroup(demo.orgId, "Finance", budget.id);
    store.addAgentToGroup(demo.orgId, demo.researcherAgentId, group.id);
    // Drain researcher to $1 (bootstrap seed was $40 stipend).
    store.applyEntries(demo.orgId, [
      transferAvailable({
        orgId: demo.orgId,
        journalId: id("j"),
        fromAvailableId: accountId("agent", demo.researcherAgentId),
        toAvailableId: accountId("org", demo.orgId),
        amountMicro: parseUsdcToMicro("39"),
        memo: "drain",
      }),
    ]);
    store.setAgentGroupAutoFund(group.id, {
      enabled: true,
      thresholdUsdc: "5",
      topUpUsdc: "25",
      minIntervalMinutes: 1,
    });

    const before =
      store.getAccountMap(demo.orgId).get(accountId("agent", demo.researcherAgentId))
        ?.balanceMicro ?? 0n;
    assert.equal(before, parseUsdcToMicro("1"));

    const { toppedUp } = runAutoFundSweep({ force: true });
    assert.equal(toppedUp, 1);

    const after =
      store.getAccountMap(demo.orgId).get(accountId("agent", demo.researcherAgentId))
        ?.balanceMicro ?? 0n;
    assert.equal(after, parseUsdcToMicro("26"));

    // Agent cooldown: second forced sweep should no-op (minIntervalMinutes).
    assert.equal(runAutoFundSweep({ force: true }).toppedUp, 0);
  });
});
