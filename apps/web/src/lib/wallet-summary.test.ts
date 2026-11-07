import { test } from "node:test";
import assert from "node:assert/strict";
import { walletSummary } from "./wallet-summary";
test("wallet summary counts underlying pools once and preserves micro-USDC precision", () => {
  const data = {
    org: { availableUsdc: "10", heldUsdc: "0.000001" },
    departments: [{ availableUsdc: "2.000001", heldUsdc: "1" }],
    shared: [{ availableUsdc: "0.000001", heldUsdc: "2" }],
    agents: [{ availableUsdc: "2.000001", heldUsdc: "1" }],
  };
  assert.deepEqual(walletSummary(data), {
    available: "10.00",
    allocated: "2.000002",
    pending: "3.000001",
  });
});
test("unknown or malformed balances never silently become zero", () => {
  assert.throws(() =>
    walletSummary({
      org: { availableUsdc: "unknown", heldUsdc: "0" },
      departments: [],
      shared: [],
    }),
  );
});
