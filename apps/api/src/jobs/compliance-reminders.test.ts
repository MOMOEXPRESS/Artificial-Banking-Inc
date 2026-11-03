/**
 * KYC / KYA reminder job: emits at most once per kind per 24h.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-compliance-remind-"));
process.env.POLICYVAULT_DB = join(dir, "remind.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";

const { store } = await import("../store.js");
const { ensureComplianceReminders, runComplianceReminders } = await import(
  "./compliance-reminders.js"
);

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("compliance reminders", () => {
  before(() => {
    // fresh org each file load is enough; create inside tests
  });

  it("reminds when KYC is missing and agents are unattested", () => {
    const org = store.createOrg("Remind Co", 10_000_000n);
    store.createAgent(org.id, "Scout", undefined);
    const first = ensureComplianceReminders(org.id);
    assert.equal(first, 2);
    const kinds = store.listNotifications(org.id, { limit: 20 }).map((n) => n.kind);
    assert.ok(kinds.includes("compliance.kyc_incomplete"));
    assert.ok(kinds.includes("compliance.kya_incomplete"));
    // Cooldown: second call in the same window records nothing.
    assert.equal(ensureComplianceReminders(org.id), 0);
  });

  it("runComplianceReminders sweeps every org", () => {
    const before = store.listOrgIds().length;
    const { orgs, reminded } = runComplianceReminders();
    assert.equal(orgs, before);
    // Already reminded above — zero new under cooldown.
    assert.equal(reminded, 0);
  });
});
