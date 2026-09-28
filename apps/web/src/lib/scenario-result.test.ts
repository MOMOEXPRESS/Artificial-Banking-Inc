import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { explainApiResponse, relatedConsoleViews } from "./scenario-result";
import type { RunStep } from "./mission";

describe("human-readable scenario results", () => {
  it("explains a policy decision without requiring JSON knowledge", () => {
    const result = explainApiResponse(
      JSON.stringify({
        outcome: "review",
        amountUsdc: "75.00",
        approvalId: "apr_123",
        reasons: ["Payments above $50 need a person to approve."],
        ruleIds: ["hitl_above"],
      }),
    );

    assert.match(result.headline, /person to approve/i);
    assert.ok(result.facts.some((fact) => /\$75\.00 USDC/.test(fact)));
    assert.ok(result.facts.some((fact) => /Approvals/.test(fact)));
    assert.ok(result.facts.every((fact) => !fact.includes("apr_123")));
  });

  it("turns budget fields into operator language", () => {
    const result = explainApiResponse(
      JSON.stringify({ availableUsdc: "120.00", dailyRemainingUsdc: "35.00", frozen: false }),
      "Budget checked.",
    );

    assert.equal(result.headline, "Budget checked.");
    assert.ok(result.facts.includes("Budget capacity available: $120.00 USDC."));
    assert.ok(result.facts.includes("Remaining under today’s limit: $35.00 USDC."));
  });

  it("keeps a plain-text fallback understandable", () => {
    assert.deepEqual(explainApiResponse("No webhook was configured."), {
      headline: "ABI returned an update.",
      facts: ["No webhook was configured."],
    });
  });
});

describe("scenario cross-page orientation", () => {
  it("points a reviewed payment to approvals and transactions", () => {
    const step: RunStep = {
      id: "pay_vendor",
      title: "Pay vendor",
      detail: "",
      status: "blocked",
      approvalId: "apr_123",
      summary: "Parked for human approval.",
    };

    assert.deepEqual(
      relatedConsoleViews(step).map((item) => item.view),
      ["approvals", "payments"],
    );
  });

  it("points an escrow action to its dedicated page", () => {
    const step: RunStep = {
      id: "escrow_lock",
      title: "Lock escrow",
      detail: "",
      status: "done",
    };
    assert.equal(relatedConsoleViews(step)[0]?.view, "escrows");
  });
});
