import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMemoryCommand as p } from "./memory-commands.js";

describe("parseMemoryCommand", () => {
  it("saves natural 'remember' phrasings (these silently did nothing before)", () => {
    const cases: [string, string][] = [
      ["Remember that our fiscal year starts in April", "our fiscal year starts in April"],
      ["Please remember our fiscal year starts in April", "our fiscal year starts in April"],
      ["I want you to remember our payroll is every Friday", "our payroll is every Friday"],
      ["Remember this: Acme is our main vendor", "Acme is our main vendor"],
      ["Keep in mind that Researcher is for pricing only", "Researcher is for pricing only"],
      ["Note: we never pay crypto exchanges", "we never pay crypto exchanges"],
      ["Our org fact: we are based in Paris. Remember it.", "we are based in Paris"],
      ["can you remember that our CFO is Tina", "our CFO is Tina"],
      ["Save this fact: the vault is for payroll", "the vault is for payroll"],
      ["Don't forget that Tina approves refunds", "Tina approves refunds"],
      ["We pay contractors on the 1st, please remember that.", "We pay contractors on the 1st"],
      ["Hey ABI, could you please keep in mind we're a French company", "we're a French company"],
      ["fyi our auditor is KPMG", "our auditor is KPMG"],
    ];
    for (const [msg, fact] of cases) {
      assert.deepEqual(p(msg), { kind: "remember", fact }, msg);
    }
  });

  it("treats questions as recall, not saves", () => {
    assert.deepEqual(p("What do you remember?"), { kind: "recall", query: "" });
    assert.deepEqual(p("what do you know about us?"), { kind: "recall", query: "" });
    assert.deepEqual(p("What did I tell you?"), { kind: "recall", query: "" });
    assert.deepEqual(p("list your notes"), { kind: "recall", query: "" });
    assert.deepEqual(p("what do you remember about Acme?"), { kind: "recall", query: "Acme" });
    assert.deepEqual(p("Do you remember our CFO?"), { kind: "recall", query: "our CFO" });
  });

  it("parses forget and clear", () => {
    assert.deepEqual(p("Forget that Acme is our main vendor"), {
      kind: "forget",
      target: "Acme is our main vendor",
      all: false,
    });
    assert.deepEqual(p("forget about payroll"), { kind: "forget", target: "payroll", all: false });
    assert.deepEqual(p("forget 2"), { kind: "forget", target: "2", all: false });
    assert.deepEqual(p("forget everything"), { kind: "forget", target: "", all: true });
    assert.deepEqual(p("clear your memory"), { kind: "forget", target: "", all: true });
  });

  it("leaves ordinary questions alone", () => {
    for (const m of [
      "How are the agents?",
      "save the policy",
      "Show policy bands",
      "What should I do next?",
      "note the vault is low",
      "why was the payment denied?",
    ]) {
      assert.equal(p(m), null, m);
    }
  });
});
