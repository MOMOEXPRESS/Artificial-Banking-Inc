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

const { store, sellerStore } = await import("./store.js");
const { app } = await import("./index.js");

const PAY_TO = `0x${"22".repeat(20)}` as `0x${string}`;
const TX_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;
let sellerChallenges = 0;
let sellerPaidRequests = 0;
let buyerBase = "";
let sellerBase = "";

let redirectTargetHits = 0;
let failAfterSignPaidRequests = 0;
const seller = createServer((req, res) => {
  // Redirect fixtures: the Location must never be requested.
  if (req.url === "/redirect-target") {
    redirectTargetHits++;
    res.writeHead(200, { "content-type": "application/json" }).end("{}");
    return;
  }
  if (req.url === "/redirect-challenge") {
    res.writeHead(302, { location: `${sellerBase}/redirect-target` }).end();
    return;
  }
  const paidRedirect = req.url === "/redirect-paid";
  if (paidRedirect && req.headers["payment-signature"]) {
    res.writeHead(307, { location: `${sellerBase}/redirect-target` }).end();
    return;
  }
  const failAfterSign = req.url === "/fail-after-sign";
  if (failAfterSign && req.headers["payment-signature"]) {
    // The seller holds a valid signed authorization it may still settle.
    failAfterSignPaidRequests++;
    res.writeHead(500).end("internal error after signing");
    return;
  }
  if (req.url !== "/report" && req.url !== "/wrong-token" && !paidRedirect && !failAfterSign) {
    res.writeHead(404).end();
    return;
  }
  const required: PaymentRequired = {
    x402Version: 2,
    resource: { url: `${sellerBase}${req.url}`, mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        asset:
          req.url === "/wrong-token"
            ? "0x0000000000000000000000000000000000000001"
            : "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
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
  const sellerOrg = store.createOrg("Report Seller", 0n, { kind: "seller" });
  const offer = store.createOffer({
    orgId: sellerOrg.id,
    slug: "flow-report",
    title: "Report",
    endpointUrl: `${sellerBase}/report`,
    priceUsdcMicro: "10000",
    network: "base-sepolia",
  });
  // As the verify route leaves it: challenge checked and the origin proven.
  store.setOfferIntegration(offer.id, {
    lastVerifiedAt: new Date().toISOString(),
    ownershipVerifiedAt: new Date().toISOString(),
    ownershipOrigin: sellerBase,
  });
  store.updateOffer(sellerOrg.id, offer.id, { status: "published" });
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
  const sellerUsage = sellerStore.listUsage(sellerOrg.id, new Date(0).toISOString());
  assert.equal(sellerUsage.length, 1, "replays do not double-count seller usage");
  assert.equal(sellerUsage[0].mode, "paid");
  assert.equal(sellerUsage[0].buyerOrgId, org.id);
  assert.equal(sellerUsage[0].agentId, agent.agentId);
  assert.equal(sellerUsage[0].amountMicro, "10000");
  assert.equal(sellerStore.payoutSummary(sellerOrg.id).lastTxHash, TX_HASH);
  const balances = store.getAccountMap(org.id);
  const budgetId = store.getAgentAnyOrg(agent.agentId)?.budgetId;
  assert.equal(balances.get(`dept:${budgetId}:available`)?.balanceMicro, 90_000n);
  assert.equal(balances.get(`dept:${budgetId}:held`)?.balanceMicro, 0n);
  const finalRecon = store.reconcileOrgUncached(org.id);
  assert.equal(finalRecon.ok, true, JSON.stringify(finalRecon.drift));
  assert.equal(finalRecon.journalsReplayed, firstRecon.journalsReplayed);
});

it("verifies the seller challenge and scopes merchant activity to its organization and endpoint", async () => {
  const org = store.createOrg("Merchant Gateway Co", 0n);
  const otherOrg = store.createOrg("Other Seller Co", 0n);
  const endpoint = `${sellerBase}/report`;
  const headers = {
    authorization: `Bearer ${org.guardianKey}`,
    "content-type": "application/json",
  };
  const onboard = await fetch(`${buyerBase}/v1/guardian/merchant-gateway/onboard`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      label: "Test Seller",
      endpoint,
      payoutAddress: PAY_TO,
      priceUsdc: "0.01",
    }),
  });
  assert.equal(onboard.status, 201);
  const { merchant } = (await onboard.json()) as { merchant: { id: string } };
  const verify = await fetch(`${buyerBase}/v1/guardian/merchant-gateway/${merchant.id}/verify`, {
    method: "POST",
    headers,
  });
  assert.equal(verify.status, 200);
  const wrongOrg = await fetch(
    `${buyerBase}/v1/guardian/merchant-gateway/${merchant.id}/activity`,
    {
      headers: { authorization: `Bearer ${otherOrg.guardianKey}` },
    },
  );
  assert.equal(wrongOrg.status, 404);

  const agent = store.createAgent(org.id, "Merchant buyer");
  store.beginSettlement({
    intentId: "merchant-receipt",
    orgId: org.id,
    agentId: agent.agentId,
    tool: "pay_api",
    destination: endpoint,
    amountMicro: 10_000n,
  });
  store.finishSettlement("merchant-receipt", {
    state: "settled",
    rail: "x402-v2",
    chargedMicro: 10_000n,
    txHash: TX_HASH,
  });
  store.beginSettlement({
    intentId: "different-endpoint",
    orgId: org.id,
    agentId: agent.agentId,
    tool: "pay_api",
    destination: `${sellerBase}/other`,
    amountMicro: 10_000n,
  });
  const activity = await fetch(
    `${buyerBase}/v1/guardian/merchant-gateway/${merchant.id}/activity`,
    { headers },
  );
  assert.equal(activity.status, 200);
  const body = (await activity.json()) as {
    settlements: { intentId: string; txHash: string; explorerUrl: string }[];
  };
  assert.equal(body.settlements.length, 1);
  assert.equal(body.settlements[0].intentId, "merchant-receipt");
  assert.equal(body.settlements[0].txHash, TX_HASH);
  assert.equal(body.settlements[0].explorerUrl, `https://sepolia.basescan.org/tx/${TX_HASH}`);

  const fakeToken = await fetch(`${buyerBase}/v1/guardian/merchant-gateway/onboard`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      label: "Wrong token",
      endpoint: `${sellerBase}/wrong-token`,
      payoutAddress: PAY_TO,
      priceUsdc: "0.01",
    }),
  });
  assert.equal(fakeToken.status, 201);
  const badMerchant = (await fakeToken.json()) as { merchant: { id: string } };
  const rejected = await fetch(
    `${buyerBase}/v1/guardian/merchant-gateway/${badMerchant.merchant.id}/verify`,
    { method: "POST", headers },
  );
  assert.equal(rejected.status, 422, "matching price and wallet must not verify a non-USDC asset");
});

function fundedOrgFor(destinations: string[], name: string) {
  const org = store.createOrg(name, 1_000_000n);
  const agent = store.createAgent(org.id, "Redirect buyer");
  const policy = store.getPolicyTemplate(org.id);
  store.setPolicyTemplate(org.id, {
    ...policy,
    vendorAllowlist: destinations,
    perTxMaxMicro: 100_000n,
    dailyMaxMicro: 1_000_000n,
    hitlAboveMicro: 100_000n,
    newCounterpartyCooldownHours: 0,
  });
  for (const d of destinations) store.addKnownCounterparty(org.id, d);
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
  return { org, agent };
}

it("refuses a seller that answers the challenge request with a 3xx (never follows it)", async () => {
  const destination = `${sellerBase}/redirect-challenge`;
  const { agent } = fundedOrgFor([destination], "Redirect Challenge Co");
  redirectTargetHits = 0;
  const res = await fetch(`${buyerBase}/v1/agent/pay_api`, {
    method: "POST",
    headers: { authorization: `Bearer ${agent.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ amountUsdc: "0.01", destination, idempotencyKey: "redirect-challenge" }),
  });
  assert.notEqual(res.status, 200);
  const text = await res.text();
  assert.match(text, /redirect/i);
  assert.equal(redirectTargetHits, 0, "the Location must never be requested");
});

it("refuses a 3xx on the paid request: never followed, not settled, held for review", async () => {
  const destination = `${sellerBase}/redirect-paid`;
  const { org, agent } = fundedOrgFor([destination], "Redirect Paid Co");
  redirectTargetHits = 0;
  const res = await fetch(`${buyerBase}/v1/agent/pay_api`, {
    method: "POST",
    headers: { authorization: `Bearer ${agent.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ amountUsdc: "0.01", destination, idempotencyKey: "redirect-paid" }),
  });
  assert.notEqual(res.status, 200);
  assert.match(await res.text(), /redirect/i);
  assert.equal(redirectTargetHits, 0, "the Location must never be requested");
  // The authorization was already signed, so (as for any post-signature seller
  // failure) the amount stays on hold for review instead of being released.
  const budgetId = store.getAgentAnyOrg(agent.agentId)?.budgetId;
  const balances = store.getAccountMap(org.id);
  assert.equal(balances.get(`dept:${budgetId}:held`)?.balanceMicro, 10_000n);
  assert.equal(store.reconcileOrgUncached(org.id).ok, true);
});

it("merchant verification refuses a redirecting endpoint", async () => {
  const org = store.createOrg("Redirect Merchant Co", 0n);
  const headers = {
    authorization: `Bearer ${org.guardianKey}`,
    "content-type": "application/json",
  };
  const onboard = await fetch(`${buyerBase}/v1/guardian/merchant-gateway/onboard`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      label: "Redirecting seller",
      endpoint: `${sellerBase}/redirect-challenge`,
      payoutAddress: PAY_TO,
      priceUsdc: "0.01",
    }),
  });
  assert.equal(onboard.status, 201);
  const { merchant } = (await onboard.json()) as { merchant: { id: string } };
  redirectTargetHits = 0;
  const verify = await fetch(`${buyerBase}/v1/guardian/merchant-gateway/${merchant.id}/verify`, {
    method: "POST",
    headers,
  });
  assert.notEqual(verify.status, 200);
  assert.equal(redirectTargetHits, 0);
});

it("keeps the idempotency key once an authorization is signed, even if the seller returns 500", async () => {
  const destination = `${sellerBase}/fail-after-sign`;
  const { org, agent } = fundedOrgFor([destination], "Fail After Sign Co");
  failAfterSignPaidRequests = 0;
  const request = () =>
    fetch(`${buyerBase}/v1/agent/pay_api`, {
      method: "POST",
      headers: { authorization: `Bearer ${agent.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ amountUsdc: "0.01", destination, idempotencyKey: "fail-after-sign" }),
    });

  const first = await request();
  assert.notEqual(first.status, 200);
  const firstBody = (await first.json()) as {
    intentId: string;
    error: { code: string; cause?: string };
  };
  // Funds may still move (the seller holds a signed authorization), so the
  // API reports uncertainty instead of a clean failure the caller would retry.
  assert.equal(firstBody.error.code, "SETTLEMENT_UNCERTAIN");
  assert.equal(firstBody.error.cause, "SELLER_REJECTED");
  assert.equal(store.getSettlement(firstBody.intentId)?.state, "needs_review");

  const retry = await request();
  assert.equal(retry.status, first.status, "the retry replays the original failure");
  const retryBody = (await retry.json()) as { replayed?: boolean; intentId: string };
  assert.equal(retryBody.replayed, true);
  assert.equal(retryBody.intentId, firstBody.intentId);
  assert.equal(failAfterSignPaidRequests, 1, "one key must never sign a second payment");

  const budgetId = store.getAgentAnyOrg(agent.agentId)?.budgetId;
  const balances = store.getAccountMap(org.id);
  assert.equal(balances.get(`dept:${budgetId}:held`)?.balanceMicro, 10_000n);
  assert.equal(store.reconcileOrgUncached(org.id).ok, true);
});

it("frees the idempotency key when the payment fails before anything is signed", async () => {
  const destination = `${sellerBase}/wrong-token`;
  const { agent } = fundedOrgFor([destination], "Refused Before Sign Co");
  const request = () =>
    fetch(`${buyerBase}/v1/agent/pay_api`, {
      method: "POST",
      headers: { authorization: `Bearer ${agent.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ amountUsdc: "0.01", destination, idempotencyKey: "refused-pre-sign" }),
    });

  const first = await request();
  assert.notEqual(first.status, 200);
  const firstBody = (await first.json()) as { intentId: string };
  assert.equal(store.getSettlement(firstBody.intentId)?.state, "failed");

  const retry = await request();
  const retryBody = (await retry.json()) as { replayed?: boolean; intentId: string };
  assert.notEqual(retryBody.replayed, true, "a clean failure may be genuinely retried");
  assert.notEqual(retryBody.intentId, firstBody.intentId);
});
