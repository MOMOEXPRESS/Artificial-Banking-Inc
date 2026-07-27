/**
 * P6-T3 / P6-T4 — the two Phase 6 deferrals.
 *
 * Policy could express amount, destination and time, but nothing about what
 * the money was *for* and nothing about when a budget ends. These pin both,
 * plus the counterparty risk score that replaces a binary allowlist with a
 * graduated one.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  counterpartyRiskScore,
  evaluatePolicy,
  templateSoloSwarm,
  type PolicyRules,
  type PolicyTemplate,
} from "./index.js";

const DEST = "api.openai.com";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function rules(template: PolicyTemplate, over: Partial<PolicyRules> = {}): PolicyRules {
  return {
    ...template,
    knownCounterparties: [DEST],
    spentLast24hMicro: 0n,
    paysLastMinute: 0,
    agentFrozen: false,
    orgFrozen: false,
    counterpartyFirstSeenMs: Date.now() - 365 * DAY,
    ...over,
  };
}

const intent = (amountMicro: bigint, destination = DEST) =>
  ({
    agentId: "agt_1",
    orgId: "org_1",
    tool: "pay_api" as const,
    amountMicro,
    destination,
  }) as Parameters<typeof evaluatePolicy>[0];

describe("category caps (P6-T3)", () => {
  const template = (): PolicyTemplate => ({
    ...templateSoloSwarm(),
    domainAllowlist: [DEST],
    categoryCaps: {
      inference: { dailyMaxMicro: 200_000_000n },
      security: { blocked: false },
    },
  });

  it("caps a category without touching the agent's overall limit", () => {
    const r = rules(template(), {
      destinationCategory: "inference",
      categorySpentLast24hMicro: 195_000_000n,
    });
    const d = evaluatePolicy(intent(10_000_000n), r);
    assert.equal(d.outcome, "deny");
    assert.ok(d.ruleIds.includes("category_daily_max"));
    // The agent's own daily spend is untouched — this denial is about purpose.
    assert.equal(r.spentLast24hMicro, 0n);
  });

  it("leaves an uncategorised destination to the agent and org caps", () => {
    const d = evaluatePolicy(
      intent(10_000_000n),
      rules(template(), { categorySpentLast24hMicro: 195_000_000n }),
    );
    assert.equal(d.outcome, "allow", "no category means no category cap applies");
  });

  it("ignores a category that has no cap configured", () => {
    const d = evaluatePolicy(
      intent(10_000_000n),
      rules(template(), {
        destinationCategory: "logistics",
        categorySpentLast24hMicro: 999_000_000n,
      }),
    );
    assert.equal(d.outcome, "allow");
  });

  it("matches categories case-insensitively, because operators type freely", () => {
    const d = evaluatePolicy(
      intent(10_000_000n),
      rules(template(), {
        destinationCategory: "Inference",
        categorySpentLast24hMicro: 195_000_000n,
      }),
    );
    assert.equal(d.outcome, "deny");
  });

  it("can refuse a category outright", () => {
    const r = rules(
      { ...template(), categoryCaps: { gambling: { blocked: true } } },
      { destinationCategory: "gambling" },
    );
    const d = evaluatePolicy(intent(1_000_000n), r);
    assert.equal(d.outcome, "deny");
    assert.ok(d.ruleIds.includes("category_blocked"));
  });

  it("parks a category-specific amount for approval below the global threshold", () => {
    const r = rules(
      {
        ...template(),
        hitlAboveMicro: 500_000_000n,
        categoryCaps: { inference: { hitlAboveMicro: 5_000_000n } },
      },
      { destinationCategory: "inference" },
    );
    const d = evaluatePolicy(intent(10_000_000n), r);
    assert.equal(d.outcome, "review");
    assert.ok(d.ruleIds.includes("category_hitl_above"));
  });
});

describe("time-boxed budgets (P6-T4)", () => {
  const now = Date.UTC(2026, 2, 15);
  const template = (): PolicyTemplate => ({
    ...templateSoloSwarm(),
    domainAllowlist: [DEST],
  });

  it("refuses spending before the window opens", () => {
    const d = evaluatePolicy(
      intent(1_000_000n),
      rules(template(), {
        nowMs: now,
        budgetWindow: { startsAtMs: now + DAY, label: "Q2 pilot" },
      }),
    );
    assert.equal(d.outcome, "deny");
    assert.ok(d.ruleIds.includes("budget_window_not_started"));
    assert.match(d.reasons[0], /Q2 pilot/);
  });

  it("refuses spending after it closes — the safety expiry for a forgotten agent", () => {
    const d = evaluatePolicy(
      intent(1_000_000n),
      rules(template(), { nowMs: now, budgetWindow: { endsAtMs: now - 1 } }),
    );
    assert.equal(d.outcome, "deny");
    assert.ok(d.ruleIds.includes("budget_window_expired"));
  });

  it("enforces the window total across the whole period, not per day", () => {
    const r = rules(template(), {
      nowMs: now,
      budgetWindow: { endsAtMs: now + 30 * DAY, totalMaxMicro: 5_000_000_000n },
      windowSpentMicro: 4_999_000_000n,
    });
    assert.equal(evaluatePolicy(intent(2_000_000n), r).outcome, "deny");
    assert.equal(evaluatePolicy(intent(1_000_000n), r).outcome, "allow");
  });

  it("is inert when no window is set, so existing policies are unchanged", () => {
    const d = evaluatePolicy(intent(1_000_000n), rules(template(), { nowMs: now }));
    assert.equal(d.outcome, "allow");
  });

  it("allows an open-ended window with only a start", () => {
    const d = evaluatePolicy(
      intent(1_000_000n),
      rules(template(), { nowMs: now, budgetWindow: { startsAtMs: now - DAY } }),
    );
    assert.equal(d.outcome, "allow");
  });
});

describe("counterparty risk score (P6-T3)", () => {
  const now = Date.UTC(2026, 2, 15);

  it("scores a never-seen destination at maximum risk", () => {
    assert.equal(counterpartyRiskScore(undefined, now).score, 100);
    assert.equal(counterpartyRiskScore({ payCount: 0 }, now).score, 100);
  });

  it("scores a flagged destination at maximum regardless of history", () => {
    const { score, factors } = counterpartyRiskScore(
      { firstSeenMs: now - 365 * DAY, payCount: 500, screened: "flagged" },
      now,
    );
    assert.equal(score, 100);
    assert.match(factors.join(" "), /compliance/i);
  });

  it("scores an established, screened vendor at zero", () => {
    const { score } = counterpartyRiskScore(
      { firstSeenMs: now - 60 * DAY, payCount: 25, screened: "clear" },
      now,
    );
    assert.equal(score, 0);
  });

  it("falls between the extremes for a young vendor with some history", () => {
    const { score } = counterpartyRiskScore(
      { firstSeenMs: now - 3 * DAY, payCount: 2, screened: "clear" },
      now,
    );
    assert.ok(score > 0 && score < 100, `expected a middling score, got ${score}`);
  });

  it("treats 'not screened' as a mild penalty, not a block", () => {
    // Most orgs run no screener. Treating that as high risk would park every
    // payment they make, which trains people to click through approvals.
    const { score } = counterpartyRiskScore(
      { firstSeenMs: now - 60 * DAY, payCount: 25, screened: "unknown" },
      now,
    );
    assert.equal(score, 20);
  });

  it("explains itself — every score carries the factors behind it", () => {
    const { factors } = counterpartyRiskScore({ firstSeenMs: now - 1 * DAY, payCount: 1 }, now);
    assert.ok(factors.length > 0);
    assert.match(factors.join(" "), /prior payment/);
  });
});

describe("risk threshold in the engine", () => {
  const now = Date.UTC(2026, 2, 15);
  const template = (): PolicyTemplate => ({
    ...templateSoloSwarm(),
    domainAllowlist: [DEST],
    // Turn the cooldown off so these cases isolate the risk rule.
    newCounterpartyCooldownHours: 0,
    counterpartyRiskReviewAbove: 50,
  });

  it("parks a risky counterparty even when it is allowlisted", () => {
    const d = evaluatePolicy(
      intent(1_000_000n),
      rules(template(), {
        nowMs: now,
        counterpartyStats: { firstSeenMs: now - HOUR, payCount: 0 },
      }),
    );
    assert.equal(d.outcome, "review");
    assert.ok(d.ruleIds.includes("counterparty_risk"));
    assert.match(d.reasons.join(" "), /risk \d+\/100/);
  });

  it("lets an established counterparty through", () => {
    const d = evaluatePolicy(
      intent(1_000_000n),
      rules(template(), {
        nowMs: now,
        counterpartyStats: { firstSeenMs: now - 90 * DAY, payCount: 40, screened: "clear" },
      }),
    );
    assert.equal(d.outcome, "allow");
  });

  it("is inert when no threshold is configured", () => {
    const d = evaluatePolicy(
      intent(1_000_000n),
      rules(
        { ...template(), counterpartyRiskReviewAbove: undefined },
        { nowMs: now, counterpartyStats: { payCount: 0 } },
      ),
    );
    assert.equal(d.outcome, "allow", "unset must not start parking payments");
  });
});
