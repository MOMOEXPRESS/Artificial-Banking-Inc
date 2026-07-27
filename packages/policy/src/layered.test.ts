/**
 * Layered policy, org-wide caps, real cooldowns, timezone-aware quiet hours.
 *
 * Phase 6 closes the largest promise-versus-reality gap the audit found:
 * "assign programmable budgets" was a ledger stipend and a freeze flag, because
 * there was exactly one policy row per organization. Three controls also did
 * not behave as their own labels claimed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluatePolicy,
  resolvePolicy,
  templateSoloSwarm,
  type PolicyRules,
  type PolicyTemplate,
} from "./index.js";

const DEST = "api.openai.com";

/** Runtime fields the store injects, with permissive defaults. */
function rules(template: PolicyTemplate, over: Partial<PolicyRules> = {}): PolicyRules {
  return {
    ...template,
    knownCounterparties: [DEST],
    spentLast24hMicro: 0n,
    paysLastMinute: 0,
    agentFrozen: false,
    orgFrozen: false,
    counterpartyFirstSeenMs: Date.now() - 365 * 24 * 3600_000,
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
    idempotencyKey: "k",
  });

describe("resolvePolicy", () => {
  it("inherits every org value when there is no override", () => {
    const org = templateSoloSwarm();
    const { effective, provenance } = resolvePolicy(org, null);
    assert.equal(effective.perTxMaxMicro, org.perTxMaxMicro);
    assert.equal(provenance.perTxMaxMicro, "org");
  });

  it("lets an agent override one field and inherit the rest", () => {
    const org = templateSoloSwarm();
    const { effective, provenance } = resolvePolicy(org, { perTxMaxMicro: 1_000_000n });

    assert.equal(effective.perTxMaxMicro, 1_000_000n, "override wins");
    assert.equal(effective.dailyMaxMicro, org.dailyMaxMicro, "untouched field inherits");
    assert.equal(provenance.perTxMaxMicro, "agent");
    assert.equal(provenance.dailyMaxMicro, "org");
  });

  it("replaces allowlists rather than merging them", () => {
    // A narrower list is usually the point of an override; unioning would
    // widen it, which is the opposite of what the operator asked for.
    const org = { ...templateSoloSwarm(), vendorAllowlist: ["a.com", "b.com"] };
    const { effective } = resolvePolicy(org, { vendorAllowlist: ["a.com"] });
    assert.deepEqual(effective.vendorAllowlist, ["a.com"]);
  });

  it("ignores explicitly-undefined fields", () => {
    const org = templateSoloSwarm();
    const { effective, provenance } = resolvePolicy(org, { perTxMaxMicro: undefined });
    assert.equal(effective.perTxMaxMicro, org.perTxMaxMicro);
    assert.equal(provenance.perTxMaxMicro, "org");
  });

  it("does not mutate the org template", () => {
    const org = templateSoloSwarm();
    const before = org.perTxMaxMicro;
    resolvePolicy(org, { perTxMaxMicro: 1n });
    assert.equal(org.perTxMaxMicro, before, "one agent must not change everyone's policy");
  });
});

describe("per-agent enforcement", () => {
  it("applies a tighter agent ceiling than the org allows", () => {
    const org = templateSoloSwarm();
    const { effective } = resolvePolicy(org, { perTxMaxMicro: 2_000_000n });

    // $5 clears the org's $25 ceiling but not this agent's $2.
    assert.equal(evaluatePolicy(intent(5_000_000n), rules(org)).outcome, "allow");
    assert.equal(evaluatePolicy(intent(5_000_000n), rules(effective)).outcome, "deny");
    assert.deepEqual(evaluatePolicy(intent(5_000_000n), rules(effective)).ruleIds, ["per_tx_max"]);
  });

  it("applies a lower approval threshold for one agent only", () => {
    const org = templateSoloSwarm(); // HITL above $10
    const { effective } = resolvePolicy(org, { hitlAboveMicro: 1_000_000n });

    assert.equal(evaluatePolicy(intent(5_000_000n), rules(org)).outcome, "allow");
    assert.equal(evaluatePolicy(intent(5_000_000n), rules(effective)).outcome, "review");
  });

  it("lets an agent be restricted to a single vendor", () => {
    const org = { ...templateSoloSwarm(), vendorAllowlist: ["api.openai.com", "data.example"] };
    const { effective } = resolvePolicy(org, { vendorAllowlist: ["data.example"] });

    const d = evaluatePolicy(intent(1_000_000n, "api.openai.com"), rules(effective));
    assert.equal(d.outcome, "deny");
    assert.deepEqual(d.ruleIds, ["allowlist_miss"]);
  });
});

describe("organization-wide daily cap", () => {
  it("is not enforced when unset — existing behaviour is preserved", () => {
    const org = templateSoloSwarm();
    const d = evaluatePolicy(
      intent(5_000_000n),
      rules(org, { orgSpentLast24hMicro: 10_000_000_000n }),
    );
    assert.equal(d.outcome, "allow");
  });

  it("stops a fleet of individually-compliant agents", () => {
    // The defect in one test: every agent is under its own $50 daily cap, but
    // together they were unbounded.
    const org = { ...templateSoloSwarm(), orgDailyMaxMicro: 100_000_000n };
    const d = evaluatePolicy(
      intent(5_000_000n),
      rules(org, { spentLast24hMicro: 0n, orgSpentLast24hMicro: 98_000_000n }),
    );
    assert.equal(d.outcome, "deny");
    assert.deepEqual(d.ruleIds, ["org_daily_max"]);
  });

  it("allows a payment that fits under the org ceiling", () => {
    const org = { ...templateSoloSwarm(), orgDailyMaxMicro: 100_000_000n };
    const d = evaluatePolicy(intent(1_000_000n), rules(org, { orgSpentLast24hMicro: 50_000_000n }));
    assert.equal(d.outcome, "allow");
  });

  it("still applies the per-agent cap first", () => {
    const org = { ...templateSoloSwarm(), orgDailyMaxMicro: 10_000_000_000n };
    const d = evaluatePolicy(
      intent(5_000_000n),
      rules(org, { spentLast24hMicro: org.dailyMaxMicro }),
    );
    assert.deepEqual(d.ruleIds, ["daily_max"], "agent limit is the tighter one here");
  });
});

describe("new-counterparty cooldown", () => {
  const org = { ...templateSoloSwarm(), newCounterpartyCooldownHours: 24 };

  // Allowlisted (permitted) and known (seen before) are different things: the
  // allowlist is a harder gate and runs first, so a cooldown test must use a
  // destination that is permitted but never yet paid.
  const orgAllowingNew = {
    ...org,
    vendorAllowlist: [...org.vendorAllowlist, "brand-new.example"],
  };

  it("sends a never-seen destination to review", () => {
    const d = evaluatePolicy(
      intent(1_000_000n, "brand-new.example"),
      rules(orgAllowingNew, { knownCounterparties: [], counterpartyFirstSeenMs: undefined }),
    );
    assert.equal(d.outcome, "review");
    assert.deepEqual(d.ruleIds, ["new_counterparty"]);
  });

  it("keeps a recently-added destination in cooldown", () => {
    // The old code ignored the hours entirely; this is the behaviour the
    // setting always claimed to have.
    const d = evaluatePolicy(
      intent(1_000_000n),
      rules(org, { counterpartyFirstSeenMs: Date.now() - 2 * 3600_000 }),
    );
    assert.equal(d.outcome, "review");
    assert.match(d.reasons.join(" "), /24h cooldown/);
  });

  it("releases a destination once the cooldown has elapsed", () => {
    const d = evaluatePolicy(
      intent(1_000_000n),
      rules(org, { counterpartyFirstSeenMs: Date.now() - 25 * 3600_000 }),
    );
    assert.equal(d.outcome, "allow", "a 24h cooldown must actually expire after 24h");
  });

  it("is disabled by a zero cooldown", () => {
    const d = evaluatePolicy(
      intent(1_000_000n, "brand-new.example"),
      rules(
        { ...orgAllowingNew, newCounterpartyCooldownHours: 0 },
        { knownCounterparties: [], counterpartyFirstSeenMs: undefined },
      ),
    );
    assert.equal(d.outcome, "allow");
  });
});

describe("quiet hours are timezone-aware", () => {
  // 02:00 UTC. In Asia/Tokyo (UTC+9) that is 11:00 the same day.
  const at0200Utc = Date.parse("2026-03-10T02:00:00Z");
  const window = { startHour: 22, endHour: 6, action: "review" as const };

  it("blocks overnight in UTC by default", () => {
    const org = { ...templateSoloSwarm(), quietHours: window };
    const d = evaluatePolicy(intent(1_000_000n), rules(org, { nowMs: at0200Utc }));
    assert.equal(d.outcome, "review");
  });

  it("does not block during working hours in the org's own zone", () => {
    // The regression: an APAC team setting 22:00-06:00 got a block at 11am.
    const org = {
      ...templateSoloSwarm(),
      quietHours: window,
      quietHoursTimezone: "Asia/Tokyo",
    };
    const d = evaluatePolicy(intent(1_000_000n), rules(org, { nowMs: at0200Utc }));
    assert.equal(d.outcome, "allow");
  });

  it("blocks overnight in that same zone", () => {
    // 16:00 UTC is 01:00 next day in Tokyo — inside the window.
    const org = {
      ...templateSoloSwarm(),
      quietHours: window,
      quietHoursTimezone: "Asia/Tokyo",
    };
    const d = evaluatePolicy(
      intent(1_000_000n),
      rules(org, { nowMs: Date.parse("2026-03-10T16:00:00Z") }),
    );
    assert.equal(d.outcome, "review");
    assert.match(d.reasons.join(" "), /Asia\/Tokyo/);
  });

  it("falls back to UTC for an unrecognised zone instead of failing every payment", () => {
    const org = {
      ...templateSoloSwarm(),
      quietHours: window,
      quietHoursTimezone: "Not/AZone",
    };
    const d = evaluatePolicy(intent(1_000_000n), rules(org, { nowMs: at0200Utc }));
    assert.equal(d.outcome, "review", "treated as UTC, not thrown");
  });
});
