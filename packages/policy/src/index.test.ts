import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy, templateSoloSwarm } from "./index.js";
import type { MoneyIntent } from "@policyvault/common";

function baseRules() {
  return {
    ...templateSoloSwarm(),
    knownCounterparties: ["api.openai.com", "data.example"],
    spentLast24hMicro: 0n,
    paysLastMinute: 0,
    agentFrozen: false,
    orgFrozen: false,
  };
}

function intent(partial: Partial<MoneyIntent> & Pick<MoneyIntent, "destination" | "amountMicro" | "tool">): MoneyIntent {
  return {
    agentId: "agt_1",
    orgId: "org_1",
    idempotencyKey: "idem_1",
    ...partial,
  };
}

describe("evaluatePolicy", () => {
  it("allows allowlisted pay_api under caps", () => {
    const d = evaluatePolicy(
      intent({ tool: "pay_api", destination: "api.openai.com", amountMicro: 1_200_000n }),
      baseRules(),
    );
    assert.equal(d.outcome, "allow");
  });

  it("denies drain to unknown address", () => {
    const d = evaluatePolicy(
      intent({
        tool: "pay",
        destination: "0x1111111111111111111111111111111111111111",
        amountMicro: 1_000_000n,
      }),
      {
        ...baseRules(),
        addressAllowlist: ["0x2222222222222222222222222222222222222222"],
      },
    );
    assert.equal(d.outcome, "deny");
    assert.ok(d.ruleIds.includes("allowlist_miss"));
  });

  it("denies when frozen", () => {
    const d = evaluatePolicy(
      intent({ tool: "pay_api", destination: "api.openai.com", amountMicro: 1_000_000n }),
      { ...baseRules(), agentFrozen: true },
    );
    assert.equal(d.outcome, "deny");
  });

  it("requests review above HITL threshold", () => {
    const d = evaluatePolicy(
      intent({ tool: "pay_api", destination: "api.openai.com", amountMicro: 15_000_000n }),
      baseRules(),
    );
    assert.equal(d.outcome, "review");
  });

  it("denies above hard per-tx ceiling", () => {
    const d = evaluatePolicy(
      intent({ tool: "pay_api", destination: "api.openai.com", amountMicro: 30_000_000n }),
      baseRules(),
    );
    assert.equal(d.outcome, "deny");
    assert.ok(d.ruleIds.includes("per_tx_max"));
  });

  it("allows escrow_lock to known same-org agent under caps", () => {
    const d = evaluatePolicy(
      intent({ tool: "escrow_lock", destination: "agt_payee", amountMicro: 5_000_000n }),
      { ...baseRules(), knownCounterparties: [...baseRules().knownCounterparties, "agt_payee"] },
    );
    assert.equal(d.outcome, "allow");
  });

  it("does not let an empty vendor allowlist wave through a domain miss", () => {
    // Configuring ONLY a domain allowlist is a natural setup. An empty list
    // must not vote "allowed" — otherwise every destination on earth passes.
    const d = evaluatePolicy(
      intent({ tool: "pay_api", destination: "evil-exfil.example", amountMicro: 1_000_000n }),
      {
        ...baseRules(),
        vendorAllowlist: [],
        domainAllowlist: ["localhost"],
        knownCounterparties: ["evil-exfil.example"],
      },
    );
    assert.equal(d.outcome, "deny");
    assert.ok(d.ruleIds.includes("allowlist_miss"));
  });

  it("still allows a destination that matches the one configured list", () => {
    const d = evaluatePolicy(
      intent({ tool: "pay_api", destination: "http://localhost:9402/report", amountMicro: 1_000_000n }),
      {
        ...baseRules(),
        vendorAllowlist: [],
        domainAllowlist: ["localhost"],
        knownCounterparties: ["localhost"],
      },
    );
    assert.equal(d.outcome, "allow");
  });

  it("blocks subdomain-suffix spoofing of an allowlisted domain", () => {
    const d = evaluatePolicy(
      intent({
        tool: "pay_api",
        destination: "https://api.openai.com.attacker.net/drain",
        amountMicro: 1_000_000n,
      }),
      {
        ...baseRules(),
        vendorAllowlist: [],
        domainAllowlist: ["api.openai.com"],
        knownCounterparties: ["api.openai.com.attacker.net"],
      },
    );
    assert.equal(d.outcome, "deny");
  });

  it("restricts spending during quiet hours", () => {
    const rules = {
      ...baseRules(),
      quietHours: { startHour: 22, endHour: 6, action: "review" as const },
      // 03:00 UTC — inside the overnight window
      nowMs: Date.UTC(2026, 0, 15, 3, 0, 0),
    };
    const d = evaluatePolicy(
      intent({ tool: "pay_api", destination: "api.openai.com", amountMicro: 1_000_000n }),
      rules,
    );
    assert.equal(d.outcome, "review");
    assert.ok(d.ruleIds.includes("quiet_hours"));
  });

  it("allows normally outside quiet hours", () => {
    const d = evaluatePolicy(
      intent({ tool: "pay_api", destination: "api.openai.com", amountMicro: 1_000_000n }),
      {
        ...baseRules(),
        quietHours: { startHour: 22, endHour: 6, action: "review" as const },
        nowMs: Date.UTC(2026, 0, 15, 14, 0, 0), // 14:00 UTC
      },
    );
    assert.equal(d.outcome, "allow");
  });

  it("routes escrow_lock to review for unknown counterparty", () => {
    const d = evaluatePolicy(
      intent({ tool: "escrow_lock", destination: "agt_stranger", amountMicro: 5_000_000n }),
      baseRules(),
    );
    assert.equal(d.outcome, "review");
    assert.ok(d.ruleIds.includes("new_counterparty"));
  });

  it("fires balance_below automation when wallet snapshot is injected", () => {
    const d = evaluatePolicy(
      intent({ tool: "pay_api", destination: "api.openai.com", amountMicro: 1_000_000n }),
      {
        ...baseRules(),
        knownCounterparties: ["api.openai.com"],
        walletBalanceMicro: 500_000n,
        automation: [
          {
            id: "low_bal",
            name: "Low balance deny",
            when: { kind: "balance_below", micro: 1_000_000n },
            then: { kind: "deny" },
          },
        ],
      },
    );
    assert.equal(d.outcome, "deny");
    assert.ok(d.ruleIds.some((r) => r.startsWith("automation:")));
  });

  it("ignores balance_below when no wallet snapshot is present", () => {
    const d = evaluatePolicy(
      intent({ tool: "pay_api", destination: "api.openai.com", amountMicro: 1_000_000n }),
      {
        ...baseRules(),
        knownCounterparties: ["api.openai.com"],
        automation: [
          {
            id: "low_bal",
            name: "Low balance deny",
            when: { kind: "balance_below", micro: 1_000_000n },
            then: { kind: "deny" },
          },
        ],
      },
    );
    assert.equal(d.outcome, "allow");
  });
});
