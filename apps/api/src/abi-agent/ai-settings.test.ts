/**
 * P8-T2 (finding M4): an organization decides whether its financial data
 * leaves the platform, to whom, and can turn it off entirely.
 *
 * The load-bearing test here is the first one: a fresh org, with a platform
 * OpenAI key sitting right there in the environment, must resolve to no egress
 * at all. That is the behaviour the audit found missing, and it is the one
 * most likely to be quietly undone by a future "sensible default".
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-ai-"));
process.env.POLICYVAULT_DB = join(dir, "ai.db");
process.env.ABI_KEK = "unit-test-key-encryption-key";

const { store } = await import("../store.js");
const { aiSettingsView, resolveAiEgress, updateAiSettings, AiSettingsError, AI_EGRESS_DISCLOSURE } =
  await import("./ai-settings.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-platform-test";
  delete process.env.ABI_CHAT_LLM;
});

describe("default posture", () => {
  it("sends nothing for a new org, even with a platform key configured", () => {
    const org = store.createOrg("Default Co", 0n);
    assert.equal(resolveAiEgress(org.id), null);
    const view = aiSettingsView(org.id);
    assert.equal(view.mode, "off");
    assert.equal(view.egressHost, null, "nothing leaves, so there is no host to name");
  });

  it("keeps existing orgs off — consent cannot be retroactive", () => {
    // An org created before this feature has no `ai` settings at all. It must
    // read as off rather than inheriting the old enabled-by-default behaviour.
    const org = store.createOrg("Legacy Co", 0n);
    store.setOrgSettings(org.id, { somethingElse: true });
    assert.equal(resolveAiEgress(org.id), null);
    assert.equal(aiSettingsView(org.id).mode, "off");
  });

  it("states what would be sent, so consent means something", () => {
    assert.ok(AI_EGRESS_DISCLOSURE.length >= 3);
    const text = AI_EGRESS_DISCLOSURE.join(" ").toLowerCase();
    assert.match(text, /balance/);
    assert.match(text, /agent/);
  });
});

describe("platform mode", () => {
  it("uses the operator's credential once an owner opts in", () => {
    const org = store.createOrg("Opted In Co", 0n);
    updateAiSettings(org.id, { mode: "platform" });
    const egress = resolveAiEgress(org.id);
    assert.ok(egress);
    assert.equal(egress.apiKey, "sk-platform-test");
    assert.equal(egress.mode, "platform");
    assert.match(egress.baseUrl, /api\.openai\.com/);
  });

  it("degrades to the keyword assistant when no platform key exists", () => {
    const org = store.createOrg("No Key Co", 0n);
    updateAiSettings(org.id, { mode: "platform" });
    delete process.env.OPENAI_API_KEY;
    assert.equal(resolveAiEgress(org.id), null);
    assert.match(aiSettingsView(org.id).note ?? "", /keyword assistant/i);
  });
});

describe("bring your own", () => {
  it("stores the key encrypted and never returns it", () => {
    const org = store.createOrg("BYO Co", 0n);
    const view = updateAiSettings(org.id, { mode: "byo", apiKey: "sk-customer-secret" });
    assert.equal(view.hasOwnKey, true);
    assert.equal((view as Record<string, unknown>).apiKey, undefined);

    const raw = JSON.stringify(store.getOrg(org.id)?.settings ?? {});
    assert.ok(!raw.includes("sk-customer-secret"), "the key must not sit in the settings blob");

    const egress = resolveAiEgress(org.id);
    assert.equal(egress?.apiKey, "sk-customer-secret", "and must still decrypt for use");
  });

  it("honours a custom endpoint, which is the data-residency lever", () => {
    const org = store.createOrg("Residency Co", 0n);
    updateAiSettings(org.id, {
      mode: "byo",
      apiKey: "sk-eu",
      baseUrl: "https://eu.example-llm.com/v1",
      model: "custom-model",
    });
    const egress = resolveAiEgress(org.id);
    assert.equal(egress?.baseUrl, "https://eu.example-llm.com/v1");
    assert.equal(egress?.model, "custom-model");
    assert.equal(aiSettingsView(org.id).egressHost, "eu.example-llm.com");
  });

  it("refuses a plaintext endpoint", () => {
    const org = store.createOrg("Insecure Co", 0n);
    assert.throws(
      () => updateAiSettings(org.id, { mode: "byo", apiKey: "sk-x", baseUrl: "http://llm.local" }),
      AiSettingsError,
    );
  });

  it("refuses byo mode with no key rather than silently using the platform account", () => {
    const org = store.createOrg("Half Configured Co", 0n);
    assert.throws(() => updateAiSettings(org.id, { mode: "byo" }), AiSettingsError);
    assert.equal(resolveAiEgress(org.id), null);
  });

  it("never falls back to the platform key when its own key cannot be decrypted", () => {
    const org = store.createOrg("Corrupt Key Co", 0n);
    updateAiSettings(org.id, { mode: "byo", apiKey: "sk-customer" });
    const settings = store.getOrg(org.id)?.settings as Record<string, Record<string, string>>;
    store.setOrgSettings(org.id, {
      ...settings,
      ai: { ...settings.ai, apiKeyEnc: "v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA:AAAA" },
    });
    // Falling back here would send their data to a vendor they did not choose.
    assert.equal(resolveAiEgress(org.id), null);
  });

  it("refuses a stored value that is not ciphertext at all", () => {
    // decryptSecret passes plaintext through for the legacy vault migration.
    // Here that would mean posting a hand-edited settings value to a model
    // provider as a bearer token.
    const org = store.createOrg("Plaintext Key Co", 0n);
    updateAiSettings(org.id, { mode: "byo", apiKey: "sk-customer" });
    const settings = store.getOrg(org.id)?.settings as Record<string, Record<string, string>>;
    store.setOrgSettings(org.id, {
      ...settings,
      ai: { ...settings.ai, apiKeyEnc: "sk-hand-edited-plaintext" },
    });
    assert.equal(resolveAiEgress(org.id), null);
  });
});

describe("turning it back off", () => {
  it("stops egress immediately", () => {
    const org = store.createOrg("Reversible Co", 0n);
    updateAiSettings(org.id, { mode: "platform" });
    assert.ok(resolveAiEgress(org.id));
    updateAiSettings(org.id, { mode: "off" });
    assert.equal(resolveAiEgress(org.id), null);
  });

  it("clears a stored key when asked", () => {
    const org = store.createOrg("Wiped Co", 0n);
    updateAiSettings(org.id, { mode: "byo", apiKey: "sk-gone" });
    updateAiSettings(org.id, { mode: "off", apiKey: null });
    assert.equal(aiSettingsView(org.id).hasOwnKey, false);
  });

  it("lets the deployment kill switch override every org's choice", () => {
    const org = store.createOrg("Killed Co", 0n);
    updateAiSettings(org.id, { mode: "platform" });
    process.env.ABI_CHAT_LLM = "0";
    assert.equal(resolveAiEgress(org.id), null);
    assert.match(aiSettingsView(org.id).note ?? "", /whole deployment/i);
  });
});
