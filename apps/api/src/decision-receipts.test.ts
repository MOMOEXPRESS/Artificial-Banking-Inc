import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  canonicalJson,
  limitsView,
  signReceiptBody,
  verifyDecisionReceipt,
  type ReceiptBody,
} from "./decision-receipts.js";

const prevPepper = process.env.ABI_KEY_PEPPER;
const prevKey = process.env.ABI_DECISION_SIGNING_KEY;
afterEach(() => {
  if (prevPepper === undefined) delete process.env.ABI_KEY_PEPPER;
  else process.env.ABI_KEY_PEPPER = prevPepper;
  if (prevKey === undefined) delete process.env.ABI_DECISION_SIGNING_KEY;
  else process.env.ABI_DECISION_SIGNING_KEY = prevKey;
});

const body: ReceiptBody = {
  v: 1,
  decisionId: "dec_1",
  intentId: "int_1",
  orgId: "org_1",
  agentId: "agt_1",
  outcome: "deny",
  tool: "pay",
  amountUsdc: "60",
  destination: "0x1111111111111111111111111111111111111111",
  ruleIds: ["daily_max"],
  reasons: ["Exceeds daily max"],
  limits: { ruleId: "daily_max", unit: "usdc", attempted: "60", cap: "100", used: "50", remaining: "50" },
  supersedes: null,
  policyVersion: "v1",
  policyHash: "ab",
  requestHash: null,
  nonce: "00",
  at: "2026-10-23T00:00:00.000Z",
};

describe("decision receipts", () => {
  it("canonical JSON sorts keys at every level and drops undefined", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } }), '{"a":{"d":[2,{"y":2,"z":1}]},"b":1}');
    assert.equal(canonicalJson({ x: 5n }), '{"x":"5"}');
  });

  it("signs with a key derived from ABI_KEY_PEPPER and verifies", () => {
    delete process.env.ABI_DECISION_SIGNING_KEY;
    process.env.ABI_KEY_PEPPER = "pepper-a";
    const r = signReceiptBody(body);
    assert.equal(r.alg, "HMAC-SHA256");
    assert.match(r.signature, /^[0-9a-f]{64}$/);
    assert.deepEqual(verifyDecisionReceipt(r), { valid: true });
  });

  it("detects any tampering with amount, payee, outcome or numbers", () => {
    process.env.ABI_KEY_PEPPER = "pepper-a";
    const r = signReceiptBody(body);
    for (const mutate of [
      (b: ReceiptBody) => (b.amountUsdc = "6"),
      (b: ReceiptBody) => (b.destination = "0x2222222222222222222222222222222222222222"),
      (b: ReceiptBody) => (b.outcome = "allow"),
      (b: ReceiptBody) => (b.limits!.remaining = "500"),
    ]) {
      const copy = structuredClone(r);
      mutate(copy.body);
      assert.deepEqual(verifyDecisionReceipt(copy), { valid: false, reason: "bad_signature" });
    }
  });

  it("prefers ABI_DECISION_SIGNING_KEY and rejects receipts from another key", () => {
    process.env.ABI_KEY_PEPPER = "pepper-a";
    const fromPepper = signReceiptBody(body);
    process.env.ABI_DECISION_SIGNING_KEY = "dedicated";
    const fromDedicated = signReceiptBody(body);
    assert.notEqual(fromPepper.keyId, fromDedicated.keyId);
    assert.deepEqual(verifyDecisionReceipt(fromDedicated), { valid: true });
    assert.deepEqual(verifyDecisionReceipt(fromPepper), { valid: false, reason: "unknown_key" });
  });

  it("degrades to an unsigned receipt when no key is configured", () => {
    delete process.env.ABI_KEY_PEPPER;
    delete process.env.ABI_DECISION_SIGNING_KEY;
    const r = signReceiptBody(body);
    assert.equal(r.alg, "none");
    assert.equal(r.signature, "");
    assert.deepEqual(verifyDecisionReceipt(r), { valid: false, reason: "unsigned" });
    assert.deepEqual(verifyDecisionReceipt(null), { valid: false, reason: "malformed" });
  });

  it("formats denial numbers as decimal strings", () => {
    assert.deepEqual(
      limitsView({ ruleId: "velocity", unit: "count", attempted: 1n, cap: 10n, used: 10n, remaining: 0n, window: "60s" }),
      { ruleId: "velocity", unit: "count", attempted: "1", cap: "10", used: "10", remaining: "0", window: "60s" },
    );
    assert.equal(
      limitsView({ ruleId: "daily_max", unit: "usdc", attempted: 60_000_000n, cap: 100_000_000n, remaining: 40_000_000n })?.remaining,
      "40",
    );
  });
});
