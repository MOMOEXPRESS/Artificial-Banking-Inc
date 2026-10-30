import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  correctToken,
  detectActionRequest,
  normalizeMessage,
  outOfScopeTopic,
  parseReference,
} from "./language.js";

describe("normalizeMessage", () => {
  it("fixes near-miss spellings of domain words and agent names", () => {
    const n = normalizeMessage("hows the reseacher doing with aprovals and the polcy", [
      "Researcher",
    ]);
    assert.match(n.text, /how is the researcher doing/);
    assert.match(n.text, /approvals/);
    assert.match(n.text, /policy/);
    assert.ok(n.corrections.some((c) => c.from === "reseacher" && c.to === "researcher"));
  });

  it("maps casual and voice phrasing onto canonical terms", () => {
    assert.match(normalizeMessage("um show me recent txns").text, /recent payments/);
    assert.match(normalizeMessage("whats stuck waiting on me").text, /pending approvals/);
    assert.match(normalizeMessage("hey abi whats going on").text, /status overview/);
    assert.match(normalizeMessage("how much money is left").text, /treasury vault balance/);
    assert.match(normalizeMessage("any new alerts?").text, /notifications/);
    assert.match(normalizeMessage("what did we talk about last time").text, /conversation recap/);
    assert.match(normalizeMessage("list my bots").text, /agents/);
  });

  it("leaves ordinary words and numbers alone", () => {
    const n = normalizeMessage("what is the writing budget for today $25", []);
    assert.equal(n.corrections.length, 0);
    assert.match(n.text, /writing budget for today \$25/);
  });

  it("refuses ambiguous or cross-letter corrections", () => {
    assert.equal(correctToken("fault", ["vault"]), null);
    assert.equal(correctToken("pay", ["day"]), null);
  });

  it("only knows the agent names it is given (no cross-org binding)", () => {
    const n = normalizeMessage("how is zephyrr", ["Researcher"]);
    assert.ok(!/zephyr\b/.test(n.text.replace("zephyrr", "")));
    const m = normalizeMessage("how is zephyrr", ["Zephyr"]);
    assert.match(m.text, /\bzephyr\b/);
  });
});

describe("detectActionRequest", () => {
  it("recognises requests to act", () => {
    assert.equal(detectActionRequest("approve it")?.kind, "approve");
    assert.equal(detectActionRequest("please go ahead and approve all of them")?.kind, "approve");
    assert.equal(detectActionRequest("can you deny the writer payment")?.kind, "deny");
    assert.equal(detectActionRequest("send $50 to api.example")?.kind, "pay");
    assert.equal(detectActionRequest("raise the daily policy limit to 500")?.kind, "policy");
    assert.equal(detectActionRequest("turn off quiet hours")?.kind, "policy");
    assert.equal(detectActionRequest("freeze researcher")?.kind, "freeze");
    assert.equal(detectActionRequest("delete the writer agent")?.kind, "agent_admin");
    assert.equal(detectActionRequest("mark all notifications read")?.kind, "notifications");
  });

  it("does not treat questions as commands", () => {
    assert.equal(detectActionRequest("who can approve payments"), null);
    assert.equal(detectActionRequest("why was it denied"), null);
    assert.equal(detectActionRequest("how do i raise the limit"), null);
    assert.equal(detectActionRequest("ok"), null);
    assert.equal(detectActionRequest("show policy bands"), null);
    assert.equal(detectActionRequest("what should i do next"), null);
  });
});

describe("outOfScopeTopic + parseReference", () => {
  it("flags topics ABI has no data for", () => {
    assert.equal(outOfScopeTopic("what is my credit score"), "credit scores");
    assert.equal(outOfScopeTopic("can i get a loan"), "loans or credit");
    assert.equal(outOfScopeTopic("how are the agents"), null);
  });

  it("parses list references", () => {
    assert.equal(parseReference("explain the second one"), 2);
    assert.equal(parseReference("what about #3"), 3);
    assert.equal(parseReference("why was the last one blocked"), "last");
    assert.equal(parseReference("tell me about that payment"), "last");
    assert.equal(parseReference("how are the agents"), null);
  });
});
