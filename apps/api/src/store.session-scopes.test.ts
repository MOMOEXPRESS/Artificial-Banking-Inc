/**
 * Session-key scope resolution must fail CLOSED.
 *
 * `getSessionByToken` previously defaulted an empty or unparseable scope list
 * back to ["read","pay","escrow"], so a key stored with no scopes silently
 * carried full money authority. A key that grants nothing is a configuration
 * mistake; a key that grants everything by accident is a breach.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-scopes-"));
process.env.POLICYVAULT_DB = join(dir, "scopes.db");
process.env.ABI_KEY_PEPPER = "test-pepper";

const { store } = await import("./store.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("session key scopes", () => {
  it("returns exactly the scopes the key was minted with", () => {
    const demo = store.seedDemoOrg();
    const key = store.createSessionKey({
      orgId: demo.orgId,
      agentId: demo.researcherAgentId,
      scopes: ["read"],
    });
    const resolved = store.getSessionByToken(key.token!);
    assert.deepEqual(resolved?.scopes, ["read"] as string[]);
  });

  it("resolves an empty stored scope list to no authority, not full authority", () => {
    const demo = store.seedDemoOrg();
    const key = store.createSessionKey({
      orgId: demo.orgId,
      agentId: demo.researcherAgentId,
      scopes: ["read"],
    });
    // Simulate a row written with an empty list (bad migration, manual edit,
    // future bug). The old behaviour escalated this to read+pay+escrow.
    store.setSessionScopesForTests(key.id, "[]");

    const resolved = store.getSessionByToken(key.token!);
    assert.ok(resolved, "key should still authenticate");
    assert.equal(resolved?.scopes.length, 0, "must grant nothing");
    assert.equal(resolved?.scopes.includes("pay"), false);
  });

  it("resolves malformed scope JSON to no authority", () => {
    const demo = store.seedDemoOrg();
    const key = store.createSessionKey({
      orgId: demo.orgId,
      agentId: demo.researcherAgentId,
      scopes: ["read", "pay"],
    });
    store.setSessionScopesForTests(key.id, "not-json");

    const resolved = store.getSessionByToken(key.token!);
    assert.equal(resolved?.scopes.length, 0);
  });

  it("discards non-string entries rather than trusting them", () => {
    const demo = store.seedDemoOrg();
    const key = store.createSessionKey({
      orgId: demo.orgId,
      agentId: demo.researcherAgentId,
      scopes: ["read"],
    });
    store.setSessionScopesForTests(key.id, '["read", 42, null, "pay"]');

    const resolved = store.getSessionByToken(key.token!);
    assert.deepEqual(resolved?.scopes, ["read", "pay"] as string[]);
  });
});
