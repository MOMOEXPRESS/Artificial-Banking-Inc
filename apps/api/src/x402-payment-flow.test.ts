/**
 * Exercise the complete agent HTTP path through policy, the x402 V2 buyer,
 * idempotency, and the ledger. The seller below is a local protocol fixture:
 * its payment response is synthetic, so this test is not on-chain proof.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, it } from "node:test";
import type { PaymentRequired } from "@x402/core/types";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";

const dir = mkdtempSync(join(tmpdir(), "abi-x402-flow-"));
process.env.POLICYVAULT_DB = join(dir, "flow.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";
process.env.ABI_ALLOW_LOCAL_TARGETS = "1";

const { store } = await import("./store.js");
const { app } = await import("./index.js");

const PAY_TO = `0x${"22".repeat(20)}` as `0x${string}`;
const TX_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;
let sellerChallenges = 0;
let sellerPaidRequests = 0;
let buyerBase = "";
let sellerBase = "";

const seller = createServer((req, res) => {
  if (req.url !== "/report") {
    res.writeHead(404).end();
    return;
  }
  const required: PaymentRequired = {
    x402Version: 2,
    resource: { url: `${sellerBase}/report`, mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        amount: "10000",
        payTo: PAY_TO,
        maxTimeoutSeconds: 120,
        extra: { name: "USDC", version: "2" },
      },
    ],
  };
  if (!req.headers["payment-signature"]) {
    sellerChallenges++;
    res.writeHead(402, {
      "content-type": "application/json",
      "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required),
    });
    res.end(JSON.stringify(required));
    return;
  }
  const signature = String(req.headers["payment-signature"]);
  assert.equal(decodePaymentSignatureHeader(signature).x402Version, 2);
  sellerPaidRequests++;
  res.writeHead(200, {
    "content-type": "application/json",
    "PAYMENT-RESPONSE": encodePaymentResponseHeader({
      success: true,
      payer: "0x1111111111111111111111111111111111111111",
      transaction: TX_HASH,
      network: "eip155:84532",
    }),
  });
  res.end(JSON.stringify({ report: "paid" }));
});

let buyer: ReturnType<typeof app.listen>;

before(async () => {
  await new Promise<void>((resolve) => seller.listen(0, "127.0.0.1", resolve));
  sellerBase = `http://127.0.0.1:${(seller.address() as AddressInfo).port}`;
  buyer = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => buyer.once("listening", resolve));
  buyerBase = `http://127.0.0.1:${(buyer.address() as AddressInfo).port}`;
});

after(async () => {
  await Promise.all([
    new Promise<void>((resolve) => seller.close(() => resolve())),
    new Promise<void>((resolve) => buyer.close(() => resolve())),
  ]);
  rmSync(dir, { recursive: true, force: true });
});

it("replays one x402 settlement without a second seller request or ledger posting", async () => {
  const org = store.createOrg("x402 Flow Co", 1_000_000n);
  const agent = store.createAgent(org.id, "Buyer");
  const policy = store.getPolicyTemplate(org.id);
  store.setPolicyTemplate(org.id, {
    ...policy,
    vendorAllowlist: [`${sellerBase}/report`],
    perTxMaxMicro: 100_000n,
    dailyMaxMicro: 1_000_000n,
    hitlAboveMicro: 100_000n,
    newCounterpartyCooldownHours: 0,
  });
  store.addKnownCounterparty(org.id, `${sellerBase}/report`);
  store.applyEntries(org.id, [
    {
      id: `fund_${org.id}`,
      orgId: org.id,
      memo: "agent stipend",
      createdAt: new Date().toISOString(),
      lines: [
        { accountId: `org:${org.id}:available`, deltaMicro: -100_000n },
        { accountId: `agent:${agent.agentId}:available`, deltaMicro: 100_000n },
      ],
    },
  ]);
  const request = () =>
    fetch(`${buyerBase}/v1/agent/pay_api`, {
      method: "POST",
      headers: { authorization: `Bearer ${agent.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        amountUsdc: "0.01",
        destination: `${sellerBase}/report`,
        idempotencyKey: "same-x402-payment",
      }),
    });

  const first = await request();
  assert.equal(first.status, 200);
  const firstBody = (await first.json()) as { rail: string; txHash: string; intentId: string };
  assert.equal(firstBody.rail, "x402-v2");
  assert.equal(firstBody.txHash, TX_HASH);
  const firstRecon = store.reconcileOrgUncached(org.id);
  assert.equal(firstRecon.ok, true, JSON.stringify(firstRecon.drift));

  const replay = await request();
  assert.equal(replay.status, 200);
  const replayBody = (await replay.json()) as {
    replayed: boolean;
    txHash: string;
    intentId: string;
  };
  assert.equal(replayBody.replayed, true);
  assert.equal(replayBody.txHash, firstBody.txHash);
  assert.equal(replayBody.intentId, firstBody.intentId);
  assert.equal(sellerChallenges, 1);
  assert.equal(sellerPaidRequests, 1, "one facilitator-style paid request for both API calls");
  const balances = store.getAccountMap(org.id);
  assert.equal(balances.get(`agent:${agent.agentId}:available`)?.balanceMicro, 90_000n);
  assert.equal(balances.get(`agent:${agent.agentId}:held`)?.balanceMicro, 0n);
  const finalRecon = store.reconcileOrgUncached(org.id);
  assert.equal(finalRecon.ok, true, JSON.stringify(finalRecon.drift));
  assert.equal(finalRecon.journalsReplayed, firstRecon.journalsReplayed);
});
