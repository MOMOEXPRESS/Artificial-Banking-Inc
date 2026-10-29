import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ledgerModeSwitchRequest, ledgerModeToggleLabel, nextLedgerMode } from "./ledger-mode";

describe("ledger mode toggle", () => {
  it("flips between sandbox and live, defaulting unknown to sandbox -> live", () => {
    assert.equal(nextLedgerMode("sandbox"), "live");
    assert.equal(nextLedgerMode("live"), "sandbox");
    assert.equal(nextLedgerMode(""), "live");
    assert.equal(ledgerModeToggleLabel("sandbox"), "Switch to live");
    assert.equal(ledgerModeToggleLabel("live"), "Switch to sandbox");
  });

  it("posts the owner-only auth route for the org", () => {
    const r = ledgerModeSwitchRequest("org_a/b", "live");
    assert.equal(r.path, "/v1/auth/orgs/org_a%2Fb/ledger-mode");
    assert.equal(r.init.method, "POST");
    assert.deepEqual(JSON.parse(String(r.init.body)), { mode: "live" });
  });
});
