/**
 * Client-side x402 guard: before ABI signs anything, the seller's challenge
 * must ask for what the intent approved — amount at most the approved amount,
 * the approved payee, USDC on the configured network — and the signed
 * authorization must say exactly that. V12's critical x402 finding (2026-10-22)
 * was a default client that signed whatever a hostile server asked for.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DevLocalProvider, setCustodyProvider } from "@policyvault/custody";
import type { PaymentRequired } from "@x402/core/types";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { privateKeyToAccount } from "viem/accounts";
import {
  MAX_X402_HEADER_BYTES,
  X402_GUARD_RULE_IDS,
  X402Error,
  assertSignedPayloadMatches,
  payViaX402,
} from "./x402.js";

const PRIVATE_KEY = `0x${"33".repeat(32)}` as `0x${string}`;
const account = privateKeyToAccount(PRIVATE_KEY);
const approvedPayee = `0x${"44".repeat(20)}` as `0x${string}`;
const attacker = `0x${"66".repeat(20)}` as `0x${string}`;
const SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const txHash = `0x${"cd".repeat(32)}` as `0x${string}`;

setCustodyProvider(
  new DevLocalProvider(
    () => ({ address: account.address, privateKey: PRIVATE_KEY, network: "base-sepolia" }),
    async (_key, typedData) =>
      account.signTypedData(typedData as Parameters<typeof account.signTypedData>[0]),
  ),
);

function challenge(over: Partial<PaymentRequired["accepts"][number]> = {}): PaymentRequired {
  return {
    x402Version: 2,
    resource: { url: "https://seller.example/report", mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        asset: SEPOLIA_USDC,
        amount: "10000",
        payTo: approvedPayee,
        maxTimeoutSeconds: 120,
        extra: { name: "USDC", version: "2" },
        ...over,
      },
    ],
  };
}

/** Seller stub: 402 with the given challenge, then a settled 200. Counts paid calls. */
function seller(required: PaymentRequired, extraHeader?: string) {
  const state = { paidCalls: 0 };
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (!new Headers(init?.headers).get("PAYMENT-SIGNATURE")) {
      return new Response(JSON.stringify(required), {
        status: 402,
        headers: {
          "content-type": "application/json",
          "PAYMENT-REQUIRED": extraHeader ?? encodePaymentRequiredHeader(required),
        },
      });
    }
    state.paidCalls += 1;
    return new Response(JSON.stringify({ ok: true }), {
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
  return { fetchImpl, state };
}

const isCode = (code: string) => (e: unknown) => e instanceof X402Error && e.code === code;

describe("x402 client guard", () => {
  it("pays when the challenge matches the approved payee, network and price", async () => {
    const { fetchImpl, state } = seller(challenge());
    const out = await payViaX402({
      url: "https://seller.example/report",
      authorizedMicro: 10_000n,
      orgId: "org_guard",
      fetchImpl,
      expect: { payTo: approvedPayee, network: "eip155:84532", maxAmountMicro: 10_000n },
    });
    assert.equal(out.receipt.payTo.toLowerCase(), approvedPayee.toLowerCase());
    assert.equal(state.paidCalls, 1);
  });

  it("refuses — before signing — a payTo that is not the approved payee", async () => {
    const { fetchImpl, state } = seller(challenge({ payTo: attacker }));
    let signed = false;
    await assert.rejects(
      payViaX402({
        url: "https://seller.example/report",
        authorizedMicro: 10_000n,
        orgId: "org_guard",
        fetchImpl,
        expect: { payTo: approvedPayee },
        onAuthorizationSigned: () => (signed = true),
      }),
      isCode("PAYEE_MISMATCH"),
    );
    assert.equal(signed, false, "nothing may be signed for the wrong payee");
    assert.equal(state.paidCalls, 0);
    assert.equal(X402_GUARD_RULE_IDS.PAYEE_MISMATCH, "x402_payee_mismatch");
  });

  it("refuses a network other than the one the payee was approved on", async () => {
    const { fetchImpl } = seller(challenge());
    await assert.rejects(
      payViaX402({
        url: "https://seller.example/report",
        authorizedMicro: 10_000n,
        orgId: "org_guard",
        fetchImpl,
        expect: { network: "eip155:8453" },
      }),
      isCode("NETWORK_MISMATCH"),
    );
  });

  it("refuses a non-USDC asset", async () => {
    const { fetchImpl } = seller(challenge({ asset: `0x${"77".repeat(20)}` }));
    await assert.rejects(
      payViaX402({
        url: "https://seller.example/report",
        authorizedMicro: 10_000n,
        orgId: "org_guard",
        fetchImpl,
      }),
      isCode("UNSUPPORTED_SCHEME"),
    );
  });

  it("refuses an amount above the approved amount or the registered price", async () => {
    const over = seller(challenge({ amount: "10001" }));
    await assert.rejects(
      payViaX402({
        url: "https://seller.example/report",
        authorizedMicro: 10_000n,
        orgId: "org_guard",
        fetchImpl: over.fetchImpl,
      }),
      isCode("PRICE_EXCEEDS_AUTHORIZED"),
    );
    const aboveRegistered = seller(challenge({ amount: "9000" }));
    await assert.rejects(
      payViaX402({
        url: "https://seller.example/report",
        authorizedMicro: 10_000n,
        orgId: "org_guard",
        fetchImpl: aboveRegistered.fetchImpl,
        expect: { maxAmountMicro: 5_000n },
      }),
      isCode("PRICE_EXCEEDS_AUTHORIZED"),
    );
  });

  it("refuses an oversized PAYMENT-REQUIRED header", async () => {
    const { fetchImpl } = seller(challenge(), "x".repeat(MAX_X402_HEADER_BYTES + 1));
    await assert.rejects(
      payViaX402({
        url: "https://seller.example/report",
        authorizedMicro: 10_000n,
        orgId: "org_guard",
        fetchImpl,
      }),
      isCode("CHALLENGE_TOO_LARGE"),
    );
  });

  it("refuses a signed authorization that does not match the approval", () => {
    const good = {
      x402Version: 2,
      accepted: { network: "eip155:84532", asset: SEPOLIA_USDC },
      payload: {
        signature: "0x",
        authorization: { from: account.address, to: approvedPayee, value: "10000" },
      },
    };
    const expected = {
      payTo: approvedPayee,
      amountMicro: 10_000n,
      network: "eip155:84532",
      asset: SEPOLIA_USDC,
      from: account.address,
    };
    assert.doesNotThrow(() => assertSignedPayloadMatches(good, expected));
    const wrongTo = structuredClone(good);
    wrongTo.payload.authorization.to = attacker;
    assert.throws(
      () => assertSignedPayloadMatches(wrongTo, expected),
      isCode("SIGNED_PAYLOAD_MISMATCH"),
    );
    const wrongValue = structuredClone(good);
    wrongValue.payload.authorization.value = "10001";
    assert.throws(
      () => assertSignedPayloadMatches(wrongValue, expected),
      isCode("SIGNED_PAYLOAD_MISMATCH"),
    );
    const wrongNet = structuredClone(good);
    wrongNet.accepted.network = "eip155:8453";
    assert.throws(
      () => assertSignedPayloadMatches(wrongNet, expected),
      isCode("SIGNED_PAYLOAD_MISMATCH"),
    );
  });
});
