import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ap2MandateToPolicyHints,
  CircleNanopaymentsRailStub,
  L402RailStub,
  StripeSptRailStub,
  verifyAp2Mandate,
  verifyTrustedAgentSignature,
} from "./rails-future.js";

describe("future rail stubs (free seams)", () => {
  it("reads AP2 mandate fields only as unverified hints", () => {
    const hints = ap2MandateToPolicyHints({
      kind: "intent",
      credential: { amountUsdc: "1.50", destination: "https://seller.example", agentId: "ag_1" },
    });
    assert.deepEqual(hints, {
      verified: false,
      amountUsdc: "1.50",
      destination: "https://seller.example",
      agentId: "ag_1",
    });
  });

  it("keeps unpaid rails honest about being stubs", async () => {
    await assert.rejects(() => new StripeSptRailStub().settle({} as never), /Stripe/);
    await assert.rejects(() => new CircleNanopaymentsRailStub().settle({} as never), /Circle/);
    await assert.rejects(() => new L402RailStub().settle({} as never), /L402/);
    assert.equal(verifyTrustedAgentSignature({ signature: "", body: "", headers: {} }).ok, false);
    // Parsing is not verification: AP2 mandates are refused until a real verifier exists.
    assert.equal(verifyAp2Mandate({ kind: "payment", credential: { amountUsdc: "1" } }).ok, false);
  });
});
