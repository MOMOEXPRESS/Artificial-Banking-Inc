import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DevLocalProvider, setCustodyProvider } from "@policyvault/custody";
import type { PaymentRequired } from "@x402/core/types";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import { privateKeyToAccount } from "viem/accounts";
import { payViaX402 } from "./x402.js";

const PRIVATE_KEY = `0x${"11".repeat(32)}` as `0x${string}`;
const account = privateKeyToAccount(PRIVATE_KEY);
const payTo = `0x${"22".repeat(20)}` as `0x${string}`;
const txHash = `0x${"ab".repeat(32)}` as `0x${string}`;

describe("x402 V2 rail", () => {
  it("uses V2 headers and returns the facilitator transaction", async () => {
    setCustodyProvider(
      new DevLocalProvider(
        () => ({ address: account.address, privateKey: PRIVATE_KEY, network: "base-sepolia" }),
        async (_key, typedData) =>
          account.signTypedData(typedData as Parameters<typeof account.signTypedData>[0]),
      ),
    );
    const required: PaymentRequired = {
      x402Version: 2,
      resource: { url: "https://seller.example/report", mimeType: "application/json" },
      accepts: [
        {
          scheme: "exact",
          network: "eip155:84532",
          asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          amount: "10000",
          payTo,
          maxTimeoutSeconds: 120,
          extra: { name: "USDC", version: "2" },
        },
      ],
    };
    let calls = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify(required), {
          status: 402,
          headers: {
            "content-type": "application/json",
            "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required),
          },
        });
      }
      const headers = new Headers(init?.headers);
      const signature = headers.get("PAYMENT-SIGNATURE");
      assert.ok(signature, "V2 PAYMENT-SIGNATURE must be sent");
      assert.equal(decodePaymentSignatureHeader(signature).x402Version, 2);
      return new Response(JSON.stringify({ report: "paid" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "PAYMENT-RESPONSE": encodePaymentResponseHeader({
            success: true,
            payer: account.address,
            transaction: txHash,
            network: "eip155:84532",
          }),
        },
      });
    };

    const result = await payViaX402({
      url: "https://seller.example/report",
      authorizedMicro: 10_000n,
      orgId: "org_test",
      fetchImpl,
    });
    assert.equal(result.receipt.txHash, txHash);
    assert.equal(result.receipt.amountMicro, 10_000n);
    assert.deepEqual(result.resource, { report: "paid" });
  });

  it("refuses a seller price above the ABI-authorized ceiling", async () => {
    const required: PaymentRequired = {
      x402Version: 2,
      resource: { url: "https://seller.example/report" },
      accepts: [
        {
          scheme: "exact",
          network: "eip155:84532",
          asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          amount: "20000",
          payTo,
          maxTimeoutSeconds: 120,
          extra: { name: "USDC", version: "2" },
        },
      ],
    };
    await assert.rejects(
      payViaX402({
        url: "https://seller.example/report",
        authorizedMicro: 10_000n,
        orgId: "org_test",
        fetchImpl: async () =>
          new Response(JSON.stringify(required), {
            status: 402,
            headers: {
              "content-type": "application/json",
              "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required),
            },
          }),
      }),
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "PRICE_EXCEEDS_AUTHORIZED",
    );
  });
});
