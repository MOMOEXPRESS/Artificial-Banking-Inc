/**
 * Regression: an x402 authorization handed to the seller must never be
 * recorded as a clean `failed` that releases the hold — the seller can still
 * settle on-chain. Persist broadcast first; escalate to needs_review.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";

const dir = mkdtempSync(join(tmpdir(), "pv-x402-safe-"));
process.env.POLICYVAULT_DB = join(dir, "x402.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_KEK = "test-kek";
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.CHAIN = "base-sepolia";
process.env.ABI_ALLOW_LOCAL_TARGETS = "1";
delete process.env.POLICYVAULT_MOCK_TRANSFER;

const PRIVATE_KEY = `0x${"11".repeat(32)}` as `0x${string}`;
const account = privateKeyToAccount(PRIVATE_KEY);
const payTo = `0x${"22".repeat(20)}` as `0x${string}`;

const { store } = await import("./store.js");
const { executeIntent, id } = await import("./engine.js");
const { setCustodyProvider, DevLocalProvider } = await import("@policyvault/custody");

setCustodyProvider(
  new DevLocalProvider(
    () => ({ address: account.address, privateKey: PRIVATE_KEY, network: "base-sepolia" }),
    async (_key, typedData) =>
      account.signTypedData(typedData as Parameters<typeof account.signTypedData>[0]),
  ),
);

let sellerBase = "";
const seller = createServer((req, res) => {
  const required: PaymentRequired = {
    x402Version: 2,
    resource: { url: `${sellerBase}/report`, mimeType: "application/json" },
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
  if (!req.headers["payment-signature"]) {
    res.writeHead(402, {
      "content-type": "application/json",
      "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required),
    });
    res.end(JSON.stringify(required));
    return;
  }
  // Accept the signed authorization, then fail the HTTP response — the classic
  // signed-but-unrecorded path.
  res.writeHead(502).end("facilitator unhappy");
});

before(async () => {
  await new Promise<void>((resolve) => seller.listen(0, "127.0.0.1", resolve));
  sellerBase = `http://127.0.0.1:${(seller.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => seller.close(() => resolve()));
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("x402 signed-but-unrecorded spend guard", () => {
  it("marks needs_review and keeps the hold when the seller rejects after signature", async () => {
    const org = store.createOrg("X402 Safe", 1_000_000_000n);
    const agent = store.createAgent(org.id, "Buyer");
    const budget = store.createDepartment(org.id, "API budget");
    assert.equal(store.assignAgentBudget(org.id, agent.agentId, budget.id), "ok");
    const t = store.getPolicyTemplate(org.id);
    store.setPolicyTemplate(org.id, {
      ...t,
      vendorAllowlist: [`${sellerBase}/report`],
      perTxMaxMicro: 100_000_000n,
      dailyMaxMicro: 500_000_000n,
      hitlAboveMicro: 1_000_000_000n,
      newCounterpartyCooldownHours: 0,
    });
    store.addKnownCounterparty(org.id, `${sellerBase}/report`);
    store.applyEntries(org.id, [
      {
        id: id("j"),
        orgId: org.id,
        memo: "seed",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `org:${org.id}:available`, deltaMicro: -50_000_000n },
          { accountId: `dept:${budget.id}:available`, deltaMicro: 50_000_000n },
        ],
      },
    ]);

    const intentId = id("int");
    const result = await executeIntent({
      orgId: org.id,
      agentId: agent.agentId,
      tool: "pay_api",
      amountMicro: 10_000n,
      amountUsdc: "0.01",
      destination: `${sellerBase}/report`,
      intentId,
    });
    assert.equal(result.ok, false);
    const settlement = store.getSettlement(intentId)!;
    assert.equal(settlement.state, "needs_review");
    assert.match(String(settlement.txHash), /^x402-auth:/);
    const held = store.getAccountMap(org.id).get(`dept:${budget.id}:held`)?.balanceMicro ?? 0n;
    assert.equal(held, 10_000n, "authorized amount must stay on hold for review");
  });
});
