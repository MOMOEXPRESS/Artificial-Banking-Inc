import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_KEYS_TAB_KEY,
  loadTabAgentKeys,
  mergeAgentKeys,
  saveTabAgentKeys,
} from "./agent-keys-tab";
import { SESSION_TAB_KEYS } from "./sign-out";

function mem() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}
const key = (id: string) => ({ agentId: id, name: `Agent ${id}`, key: `pv_agent_${id}` });

describe("agent keys for this tab", () => {
  it("round-trips keys for the same org", () => {
    const tab = mem();
    saveTabAgentKeys(tab, "org_1", [key("a"), key("b")]);
    assert.deepEqual(
      loadTabAgentKeys(tab, "org_1").map((k) => k.agentId),
      ["a", "b"],
    );
  });
  it("never returns another org's keys", () => {
    const tab = mem();
    saveTabAgentKeys(tab, "org_1", [key("a")]);
    assert.deepEqual(loadTabAgentKeys(tab, "org_2"), []);
  });
  it("clears storage when there is nothing to keep", () => {
    const tab = mem();
    saveTabAgentKeys(tab, "org_1", [key("a")]);
    saveTabAgentKeys(tab, "org_1", []);
    assert.equal(tab.m.has(AGENT_KEYS_TAB_KEY), false);
  });
  it("ignores malformed rows", () => {
    const tab = mem();
    tab.setItem(
      AGENT_KEYS_TAB_KEY,
      JSON.stringify({ orgId: "o", keys: [{ agentId: "x" }, key("y")] }),
    );
    assert.deepEqual(
      loadTabAgentKeys(tab, "o").map((k) => k.agentId),
      ["y"],
    );
    tab.setItem(AGENT_KEYS_TAB_KEY, "{not json");
    assert.deepEqual(loadTabAgentKeys(tab, "o"), []);
  });
  it("prefers keys already in memory", () => {
    const merged = mergeAgentKeys([{ ...key("a"), name: "fresh" }], [key("a"), key("b")]);
    assert.deepEqual(
      merged.map((k) => k.name),
      ["fresh", "Agent b"],
    );
  });
  it("is wiped on sign-out", () => {
    assert.ok((SESSION_TAB_KEYS as readonly string[]).includes(AGENT_KEYS_TAB_KEY));
  });
});
