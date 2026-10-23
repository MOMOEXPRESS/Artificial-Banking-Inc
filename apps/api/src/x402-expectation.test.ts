/** Registered merchant gateways pin the x402 payee, network and price. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-x402exp-"));
process.env.POLICYVAULT_DB = join(dir, "exp.db");
process.env.ABI_KEY_PEPPER = "test-pepper";

const { store } = await import("./store.js");
const { x402ExpectationFor } = await import("./engine.js");

after(() => rmSync(dir, { recursive: true, force: true }));

describe("x402ExpectationFor", () => {
  it("returns the declared payout, network and price for an onboarded endpoint", () => {
    const org = store.createOrg("Exp Co", 1_000_000n);
    store.upsertMerchant({
      orgId: org.id,
      key: "https://Seller.example/report",
      meta: {
        gateway: {
          payoutAddress: "0x4444444444444444444444444444444444444444",
          network: "eip155:84532",
          amountMicro: "10000",
        },
      },
    });
    assert.deepEqual(x402ExpectationFor(org.id, " https://seller.example/report "), {
      payTo: "0x4444444444444444444444444444444444444444",
      network: "eip155:84532",
      maxAmountMicro: 10_000n,
    });
  });

  it("returns nothing for an ad-hoc URL or another org's merchant", () => {
    const a = store.createOrg("A", 1_000_000n);
    const b = store.createOrg("B", 1_000_000n);
    store.upsertMerchant({
      orgId: a.id,
      key: "https://only-a.example/x",
      meta: { gateway: { payoutAddress: "0x4444444444444444444444444444444444444444" } },
    });
    assert.equal(x402ExpectationFor(b.id, "https://only-a.example/x"), undefined);
    assert.equal(x402ExpectationFor(a.id, "https://unknown.example/x"), undefined);
  });
});
