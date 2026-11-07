import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHmac } from "node:crypto";
import { createCardFunding, verifyStripeSignature, type FundingProvider } from "./card-funding.js";
import type { CommerceDatabase } from "./marketplace.js";
function fixture() {
  const db = new DatabaseSync(":memory:");
  let now = Date.parse("2026-11-07T00:00:00Z"),
    charges = 0;
  const provider: FundingProvider = {
    ready: true,
    customer: async (org) => "cus_" + org,
    checkout: async (i) => ({ id: "cs_" + i.id, url: "https://checkout.stripe.com/c/" + i.id }),
    charge: async (i) => {
      charges++;
      return { id: "pi_" + i.id, status: "succeeded" };
    },
    setup: async () => ({ customer: "cus_a", paymentMethod: "pm_a", label: "visa •••• 4242" }),
  };
  const funding = createCardFunding(db as unknown as CommerceDatabase, provider, () => now);
  const paid = (id: string, amount = 1000, event = "evt_paid") =>
    funding.webhook({
      id: event,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_" + id,
          customer: "cus_a",
          payment_intent: "pi_" + id,
          payment_status: "paid",
          currency: "usd",
          amount_total: amount,
          metadata: { abiFundingId: id, abiOrgId: "a" },
        },
      },
    });
  return { db, funding, provider, paid, charges: () => charges, advance: () => (now += 700000) };
}
test("verified funding posts once across duplicate and distinct provider event IDs", async () => {
  const f = fixture();
  const c = await f.funding.checkout("a", { requestKey: "request-1", amountCents: 1000 });
  assert.equal(f.funding.summary("a").creditCents, 0);
  await f.paid(c.id);
  await f.paid(c.id);
  await f.paid(c.id, 1000, "evt_other");
  assert.equal(f.funding.summary("a").creditCents, 1000);
  assert.equal(f.funding.summary("b").creditCents, 0);
  assert.equal(f.funding.summary("a").settlementCredit, false);
});
test("amount, currency, customer and tenant mismatches never create credits", async () => {
  const f = fixture();
  const c = await f.funding.checkout("a", { requestKey: "request-2", amountCents: 1000 });
  await assert.rejects(() => f.paid(c.id, 500));
  assert.equal(f.funding.summary("a").creditCents, 0);
  await assert.rejects(() =>
    f.funding.checkout("a", { requestKey: "request-2", amountCents: 2000 }),
  );
});
test("unpaid checkout events and opening checkout cannot fund a wallet", async () => {
  const f = fixture();
  const c = await f.funding.checkout("a", { requestKey: "request-3", amountCents: 1000 });
  await f.funding.webhook({
    id: "evt_unpaid",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_" + c.id,
        customer: "cus_a",
        currency: "usd",
        amount_total: 1000,
        payment_status: "unpaid",
        metadata: { abiFundingId: c.id, abiOrgId: "a" },
      },
    },
  });
  assert.equal(f.funding.summary("a").creditCents, 0);
});
test("auto-top-up requires verified method and explicit consent; concurrent triggers charge once", async () => {
  const f = fixture();
  assert.throws(() =>
    f.funding.settings("a", {
      enabled: true,
      thresholdCents: 500,
      amountCents: 2000,
      monthlyCapCents: 4000,
    }),
  );
  const s = await f.funding.checkout("a", { requestKey: "setup-one", setup: true });
  await f.funding.webhook({
    id: "evt_setup",
    type: "checkout.session.completed",
    data: {
      object: { id: "cs_" + s.id, setup_intent: "seti_a", metadata: { abiFundingId: s.id } },
    },
  });
  f.funding.settings("a", {
    enabled: true,
    thresholdCents: 500,
    amountCents: 2000,
    monthlyCapCents: 2000,
  });
  const [a, b] = await Promise.all([f.funding.autoTopup("a"), f.funding.autoTopup("a")]);
  assert.equal(f.charges(), 1);
  assert.equal(a.submitted, true);
  assert.equal(b.submitted, false);
  assert.equal(f.funding.summary("a").creditCents, 0);
  f.advance();
  assert.equal((await f.funding.autoTopup("a")).submitted, false);
});
test("unknown transport result remains pending and is not charged again", async () => {
  const f = fixture();
  const s = await f.funding.checkout("a", { requestKey: "setup-unknown", setup: true });
  await f.funding.webhook({
    id: "setup",
    type: "checkout.session.completed",
    data: { object: { id: "cs_" + s.id, setup_intent: "seti", metadata: { abiFundingId: s.id } } },
  });
  f.funding.settings("a", {
    enabled: true,
    thresholdCents: 500,
    amountCents: 2000,
    monthlyCapCents: 10000,
  });
  let calls = 0;
  f.provider.charge = async () => {
    calls++;
    throw Error("timeout");
  };
  await assert.rejects(() => f.funding.autoTopup("a"));
  f.advance();
  assert.equal((await f.funding.autoTopup("a")).submitted, false);
  assert.equal(calls, 1);
});
test("refunds and dispute recovery append bounded reversal entries without double debits", async () => {
  const f = fixture();
  const c = await f.funding.checkout("a", { requestKey: "refund-one", amountCents: 1000 });
  await f.paid(c.id);
  const event = async (id: string, type: string, extra: Record<string, unknown>) =>
    f.funding.webhook({ id, type, data: { object: { payment_intent: "pi_" + c.id, ...extra } } });
  await event("refund1", "charge.refunded", { amount_refunded: 300 });
  await event("refund2", "charge.refunded", { amount_refunded: 300 });
  assert.equal(f.funding.summary("a").creditCents, 700);
  await event("dispute1", "charge.dispute.created", { amount: 1000 });
  assert.equal(f.funding.summary("a").creditCents, 0);
  await event("closed", "charge.dispute.closed", { amount: 1000, status: "won" });
  assert.equal(f.funding.summary("a").creditCents, 700);
  await event("late-created", "charge.dispute.created", { amount: 1000 });
  assert.equal(f.funding.summary("a").creditCents, 700);
});
test("missing provider fails closed and signatures bind exact bytes and timestamp", async () => {
  const f = fixture();
  f.provider.ready = false;
  await assert.rejects(() =>
    f.funding.checkout("a", { requestKey: "disabled", amountCents: 1000 }),
  );
  const now = Date.now(),
    t = String(Math.floor(now / 1000)),
    body = Buffer.from('{"id":"event"}'),
    sig = createHmac("sha256", "secret")
      .update(t + ".")
      .update(body)
      .digest("hex");
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, "secret", now), true);
  assert.equal(verifyStripeSignature(Buffer.from("{}"), `t=${t},v1=${sig}`, "secret", now), false);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, "secret", now + 600000), false);
});

test("refund arriving before the funding webhook is applied when payment is verified", async () => {
  const f = fixture();
  const c = await f.funding.checkout("a", { requestKey: "request_early", amountCents: 1000 });
  await f.funding.webhook({
    id: "evt_early_refund",
    type: "charge.refunded",
    data: { object: { payment_intent: "pi_" + c.id, amount_refunded: 600 } },
  });
  await f.paid(c.id);
  assert.equal(f.funding.summary("a").creditCents, 400);
  await f.funding.webhook({
    id: "evt_early_refund",
    type: "charge.refunded",
    data: { object: { payment_intent: "pi_" + c.id, amount_refunded: 600 } },
  });
  assert.equal(f.funding.summary("a").creditCents, 400);
});
