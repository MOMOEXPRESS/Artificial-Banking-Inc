import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAndPinOutboundUrl } from "./outbound-url.js";

describe("resolveAndPinOutboundUrl (literal + local)", () => {
  it("pins literal public IPv4 without DNS", async () => {
    const prev = process.env.ABI_ALLOW_LOCAL_TARGETS;
    process.env.ABI_ALLOW_LOCAL_TARGETS = "0";
    process.env.NODE_ENV = "production";
    try {
      const result = await resolveAndPinOutboundUrl("https://8.8.8.8/health", "Webhook URL");
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.pinned.pinnedIp, "8.8.8.8");
      }
    } finally {
      if (prev === undefined) delete process.env.ABI_ALLOW_LOCAL_TARGETS;
      else process.env.ABI_ALLOW_LOCAL_TARGETS = prev;
    }
  });

  it("blocks private literal IPs in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.ABI_ALLOW_LOCAL_TARGETS;
    const result = await resolveAndPinOutboundUrl("https://127.0.0.1/x", "Webhook URL");
    assert.equal(result.ok, false);
  });

  it("allows demo sink without DNS", async () => {
    const result = await resolveAndPinOutboundUrl("abi://demo-inbox", "Webhook URL");
    assert.equal(result.ok, true);
  });
});
