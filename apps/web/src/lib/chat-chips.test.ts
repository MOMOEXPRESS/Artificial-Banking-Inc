import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CHIPS, quickReplies } from "./chat-chips";

describe("quickReplies", () => {
  it("uses the latest assistant reply's suggestions", () => {
    const chips = quickReplies([
      { role: "assistant", meta: { suggestions: ["Old"] } },
      { role: "user" },
      { role: "assistant", meta: { suggestions: ["Explain the last one", "Show policy bands"] } },
    ]);
    assert.deepEqual(chips, ["Explain the last one", "Show policy bands", "What do you remember?"]);
  });

  it("falls back to defaults for older replies and empty chats", () => {
    assert.deepEqual(quickReplies([]), DEFAULT_CHIPS);
    assert.deepEqual(
      quickReplies([{ role: "assistant", meta: { suggestions: ["Old"] } }, { role: "assistant" }]),
      DEFAULT_CHIPS,
    );
  });

  it("ignores junk in meta", () => {
    assert.deepEqual(
      quickReplies([{ role: "assistant", meta: { suggestions: [42, "x".repeat(200)] } }]),
      DEFAULT_CHIPS,
    );
  });
});
