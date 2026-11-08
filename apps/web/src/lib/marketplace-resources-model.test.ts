import test from "node:test";
import assert from "node:assert/strict";
import {
  purchasedResources,
  resourceReady,
  type ResourceItem,
} from "./marketplace-resources-model";

const item = (
  id: string,
  kind: string,
  paymentState: string,
  fulfillmentState = "delivered",
): ResourceItem => ({
  id,
  product: { name: id, kind },
  quantity: 1,
  paymentState,
  fulfillmentState,
});

test("Resources excludes unpaid, refunded, denied and physical purchases", () => {
  const resources = purchasedResources([
    {
      id: "order",
      items: [
        item("paid-software", "digital", "paid"),
        item("api-result", "service", "paid"),
        item("pending-payment", "digital", "awaiting_approval"),
        item("refunded", "digital", "refunded"),
        item("denied", "service", "denied"),
        item("physical", "physical", "paid"),
        item("unpaid", "digital", "unpaid"),
      ],
    },
  ]);
  assert.deepEqual(
    resources.map((r) => r.id),
    ["paid-software", "api-result"],
  );
  assert.ok(resources.every((r) => r.orderId === "order"));
});

test("Held payments and unfinished delivery never enable resource access", () => {
  assert.equal(resourceReady(item("held", "digital", "escrowed")), false);
  assert.equal(resourceReady(item("waiting", "service", "paid", "pending")), false);
  assert.equal(resourceReady(item("denied", "digital", "denied")), false);
  assert.equal(resourceReady(item("delivered", "digital", "paid")), true);
  assert.equal(resourceReady(item("api-result", "service", "paid")), true);
  assert.equal(resourceReady(item("physical", "physical", "paid")), false);
});
