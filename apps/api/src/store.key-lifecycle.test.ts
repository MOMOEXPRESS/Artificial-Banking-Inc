import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "abi-key-lifecycle-"));
process.env.POLICYVAULT_DB = join(dir, "test.db");
process.env.ABI_KEY_PEPPER = "test-key-lifecycle-pepper";
const { store } = await import("./store.js");
after(() => rmSync(dir, { recursive: true, force: true }));

describe("agent credential lifecycle", () => {
  it("enforces API key expiration independently from session expiration", () => {
    const org = store.createOrg("Expiry test", 0n);
    const a = store.createAgent(org.id, "Buyer", undefined, 1);
    const session = store.createSessionKey({
      orgId: org.id,
      agentId: a.agentId,
      scopes: ["read"],
      ttlHours: 24,
    });
    assert.ok(store.getAgentByKey(a.apiKey));
    assert.equal(store.getAgentAnyOrg(a.agentId)?.apiKeyHint, `pv_agent_…${a.apiKey.slice(-4)}`);
    const now = Date.now;
    try {
      Date.now = () => now() + 2 * 3600_000;
      assert.equal(store.getAgentByKey(a.apiKey), undefined);
      assert.ok(store.getSessionByToken(session.token!));
    } finally {
      Date.now = now;
    }
  });

  it("rotates without unfreezing or reviving revoked sessions", () => {
    const org = store.createOrg("Freeze test", 0n);
    const a = store.createAgent(org.id, "Buyer");
    const session = store.createSessionKey({ orgId: org.id, agentId: a.agentId });
    store.setAgentStatus(a.agentId, "frozen");
    const replacement = store.rotateAgentKey(a.agentId, 24 * 7);
    assert.equal(store.getAgentByKey(a.apiKey), undefined);
    assert.equal(store.getAgentByKey(replacement)?.status, "frozen");
    assert.equal(store.getSessionByToken(session.token!), undefined);
    assert.ok(store.getAgentAnyOrg(a.agentId)?.apiKeyExpiresAt);
  });

  it("supports explicit until-revoked keys and revokes them", () => {
    const org = store.createOrg("Service test", 0n);
    const a = store.createAgent(org.id, "Service", undefined, null);
    assert.equal(store.getAgentAnyOrg(a.agentId)?.apiKeyExpiresAt, undefined);
    assert.ok(store.getAgentByKey(a.apiKey));
    store.revokeAgentKey(a.agentId);
    assert.equal(store.getAgentByKey(a.apiKey), undefined);
  });
});
