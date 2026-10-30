/**
 * Oct 30 agreed list (Tina + Broddy), items 2-5:
 *   2. Reliability — recheck uncertain x402 payments (named resolver, second
 *      deadline, stop-and-restart, end states "not assessed" and "expired
 *      unclaimed", unknown-on-mismatch, recheck_after + a status read), make
 *      withdrawals safe to retry (idempotency key with key expiry), guard
 *      human and treasury withdrawals, and make locks work across processes.
 *   3. Reserve the signed maximum.
 *   4. Outflow reconciliation (transfer id, policy revision, staleness fields,
 *      where released / cancelled money went) + approval record with a rules
 *      hash and an approver the agent can read.
 *   5. x402 SDK at 2.28.
 *
 * No chain, no spend: a local x402 seller, fake vault chain clients, and
 * stand-in outcome readers. Nothing here touches Base or Base Sepolia.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, afterEach, before, describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";

const dir = mkdtempSync(join(tmpdir(), "pv-oct30-"));
process.env.POLICYVAULT_DB = join(dir, "oct30.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_KEK = "test-kek";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";
process.env.CHAIN = "base-sepolia";
process.env.ABI_ALLOW_LOCAL_TARGETS = "1";
// Unreachable on purpose: any accidental real RPC read fails fast.
process.env.CHAIN_RPC_URL = "http://127.0.0.1:9";
process.env.ABI_TX_RECEIPT_TIMEOUT_MS = "50";

const here = dirname(fileURLToPath(import.meta.url));
const PRIVATE_KEY = `0x${"11".repeat(32)}` as `0x${string}`;
const account = privateKeyToAccount(PRIVATE_KEY);
const payTo = `0x${"22".repeat(20)}` as `0x${string}`;
const DEST = "0x3333333333333333333333333333333333333333";
const PAYEE = "0x5555555555555555555555555555555555555555";

const storeMod = await import("./store.js");
const { store, __setStoreClockOffsetForTests } = storeMod;
const { app } = await import("./index.js");
const { executeIntent, id } = await import("./engine.js");
const recovery = await import("./jobs/settlement-recovery.js");
const { guardTreasuryWithdraw } = await import("./treasury-guard.js");
const { withVaultLock, VaultLockTimeoutError } = await import("./chain/vault-queue.js");
const { setCustodyProvider, DevLocalProvider } = await import("@policyvault/custody");
const transfer = await import("./chain/transfer.js");

setCustodyProvider(
  new DevLocalProvider(
    () => ({ address: account.address, privateKey: PRIVATE_KEY, network: "base-sepolia" }),
    async (_key, typedData) =>
      account.signTypedData(typedData as Parameters<typeof account.signTypedData>[0]),
  ),
);

// ---- fake vault chain (withdrawals): counts broadcasts, receipt configurable
let broadcasts = 0;
let receipt: "success" | "timeout" = "success";
let onchainUsdc = 10_000_000_000_000n;
transfer.setVaultChainClientsForTests((_cfg, privateKey) => ({
  account: { address: privateKeyToAccount(privateKey).address },
  publicClient: {
    readContract: async () => onchainUsdc,
    getBalance: async () => 10n ** 16n,
    estimateContractGas: async () => 65_000n,
    estimateFeesPerGas: async () => ({ maxFeePerGas: 1_000_000_000n }),
    waitForTransactionReceipt: async () => {
      if (receipt === "timeout") throw new Error("Timed out waiting for receipt");
      return { status: "success" };
    },
  },
  walletClient: {
    writeContract: async () => {
      broadcasts += 1;
      return `0x${broadcasts.toString(16).padStart(64, "a")}` as `0x${string}`;
    },
  },
}));

// ---- local x402 seller: asks PRICE, then fails the response after signature
let sellerBase = "";
let price = "10000";
let paidHits = 0;
const seller = createServer((req, res) => {
  const required: PaymentRequired = {
    x402Version: 2,
    resource: { url: `${sellerBase}/report`, mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        amount: price,
        payTo,
        maxTimeoutSeconds: 600,
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
  paidHits += 1;
  res.writeHead(502).end("facilitator unhappy");
});

let base = "";
let server: ReturnType<typeof app.listen>;

before(async () => {
  await new Promise<void>((resolve) => seller.listen(0, "127.0.0.1", resolve));
  sellerBase = `http://127.0.0.1:${(seller.address() as AddressInfo).port}`;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  transfer.setVaultChainClientsForTests(null);
  recovery.__setOutcomeReadersForTests();
  __setStoreClockOffsetForTests(0);
  server?.close();
  await new Promise<void>((resolve) => seller.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  __setStoreClockOffsetForTests(0);
  recovery.__setOutcomeReadersForTests();
  receipt = "success";
  onchainUsdc = 10_000_000_000_000n;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(
  path: string,
  key: string,
  body?: Record<string, unknown>,
  method = body ? "POST" : "GET",
): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}

let n = 0;
const key = () => `oct30-key-${++n}-${Date.now()}`;
const MIN = 60_000;

/** Org + agent + funded budget, with the local seller and PAYEE allowlisted. */
function fixture(opts: { hitlAboveUsdc?: number } = {}) {
  const org = store.createOrg(`Oct30 Co ${++n}`, 1_000_000_000n);
  const agent = store.createAgent(org.id, "Buyer");
  const budget = store.createDepartment(org.id, "API budget");
  assert.equal(store.assignAgentBudget(org.id, agent.agentId, budget.id), "ok");
  const t = store.getPolicyTemplate(org.id);
  store.setPolicyTemplate(org.id, {
    ...t,
    vendorAllowlist: [`${sellerBase}/report`],
    addressAllowlist: [PAYEE],
    perTxMaxMicro: 100_000_000n,
    dailyMaxMicro: 500_000_000n,
    hitlAboveMicro: BigInt(opts.hitlAboveUsdc ?? 1000) * 1_000_000n,
    newCounterpartyCooldownHours: 0,
    hitlCategories: [],
    maxPaysPerMinute: 100,
    maxPaysPerHour: 1000,
    quietHours: undefined,
    automation: [],
  });
  store.addKnownCounterparty(org.id, `${sellerBase}/report`);
  store.addKnownCounterparty(org.id, PAYEE);
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
  const held = () => store.getAccountMap(org.id).get(`dept:${budget.id}:held`)?.balanceMicro ?? 0n;
  const avail = () =>
    store.getAccountMap(org.id).get(`dept:${budget.id}:available`)?.balanceMicro ?? 0n;
  return { org, agent, budget, held, avail };
}

/** An x402 payment that signs, then loses the seller's answer. */
async function uncertainX402(f: ReturnType<typeof fixture>, authorizedMicro = 20_000n) {
  const intentId = id("int");
  const result = await executeIntent({
    orgId: f.org.id,
    agentId: f.agent.agentId,
    tool: "pay_api",
    amountMicro: authorizedMicro,
    amountUsdc: (Number(authorizedMicro) / 1e6).toString(),
    destination: `${sellerBase}/report`,
    intentId,
  });
  assert.equal(result.ok, false);
  return { intentId, result };
}

// ============================================================ item 2 + 3

describe("item 2: uncertain x402 payments are rechecked, not guessed", () => {
  it("an unknown outcome names its resolver and human, has two deadlines, and holds only the signed maximum", async () => {
    const f = fixture();
    const before = f.avail();
    price = "10000";
    const { intentId, result } = await uncertainX402(f, 20_000n);
    assert.equal(result.status, 409);
    const p = result.payload as Json;
    assert.equal(p.state, "outcome_unknown");
    assert.ok(p.recheck_after, "the agent is told when to look again");
    assert.equal(p.status_url, `/v1/agent/intents/${intentId}/status`);

    const row = store.getSettlement(intentId)!;
    assert.equal(row.outcome, "outcome_unknown");
    assert.equal(row.resolver, "x402:authorization_state");
    assert.match(String(row.escalateTo), /^owner:/);
    assert.ok(row.recheckAfter! < row.escalateAt!, "first deadline before the second");
    assert.match(String(row.authorization?.nonce), /^0x[0-9a-f]{64}$/i);
    assert.ok(Number(row.authorization?.validBefore) > Date.now() / 1000);
    assert.equal(row.policyRevision, store.getPolicyVersion(f.org.id));

    // Item 3: only the signed 0.01 can ever move, so only 0.01 stays held.
    assert.equal(row.signedMaxMicro, 10_000n);
    assert.equal(f.held(), 10_000n);
    assert.equal(f.avail(), before - 10_000n);
    assert.equal(row.releasedMicro, 10_000n);
    assert.equal(row.releasedTo, `dept:${f.budget.id}:available`);
    assert.equal(row.releaseReason, "above_signed_max");
  });

  it("stop after send, restart after the deadline: a fresh worker neither retries nor declares failure", async () => {
    const f = fixture();
    const { intentId } = await uncertainX402(f);
    const hits = paidHits;
    const heldBefore = f.held();
    const first = store.getSettlement(intentId)!;
    recovery.__setOutcomeReadersForTests({
      authorizationState: async () => "unknown",
      txStatus: async () => "unknown",
    });

    // The worker died; a new one starts after the first deadline.
    __setStoreClockOffsetForTests(3 * MIN);
    await recovery.recoverStuckSettlements();
    let row = store.getSettlement(intentId)!;
    assert.equal(paidHits, hits, "the payment is never retried");
    assert.equal(row.outcome, "outcome_unknown", "never declared failed without evidence");
    assert.equal(row.state, "needs_review");
    assert.equal(f.held(), heldBefore, "amount stays held while unknown");
    assert.ok(row.recheckAfter! > first.recheckAfter!, "next read scheduled on the store clock");
    assert.equal(row.escalatedAt, undefined);

    // Past the second deadline: handed to the named human, still held.
    __setStoreClockOffsetForTests(62 * MIN);
    const out = await recovery.recoverStuckSettlements();
    row = store.getSettlement(intentId)!;
    assert.ok((out.escalated ?? 0) >= 1);
    assert.ok(row.escalatedAt);
    assert.equal(row.escalateTo, first.escalateTo);
    assert.equal(row.outcome, "outcome_unknown");
    assert.equal(f.held(), heldBefore);
    assert.equal(paidHits, hits);
  });

  it("a row a dead process left in 'broadcast' becomes unknown on restart, not failed", async () => {
    const f = fixture();
    const intentId = id("int");
    store.beginSettlement({
      intentId,
      orgId: f.org.id,
      agentId: f.agent.agentId,
      tool: "pay_api",
      destination: `${sellerBase}/report`,
      amountMicro: 5_000n,
    });
    store.recordSignedMax(intentId, 5_000n, {
      nonce: `0x${"cd".repeat(32)}`,
      validBefore: String(Math.floor(Date.now() / 1000) + 300),
      payer: account.address,
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      network: "eip155:84532",
    });
    store.markSettlementBroadcast(intentId, "x402-v2", `x402-auth:0x${"cd".repeat(32)}`);
    recovery.__setOutcomeReadersForTests({ authorizationState: async () => "unknown" });
    __setStoreClockOffsetForTests(11 * MIN);
    await recovery.recoverStuckSettlements();
    const row = store.getSettlement(intentId)!;
    assert.equal(row.outcome, "outcome_unknown");
    assert.notEqual(row.state, "failed");
    assert.equal(row.resolver, "x402:authorization_state");
    assert.match(String(row.escalateTo), /^owner:/);
  });

  it("a claimed authorization becomes claimed_unbooked for a named human; the hold stays", async () => {
    const f = fixture();
    const { intentId } = await uncertainX402(f);
    const heldBefore = f.held();
    recovery.__setOutcomeReadersForTests({ authorizationState: async () => "used" });
    __setStoreClockOffsetForTests(3 * MIN);
    await recovery.recoverStuckSettlements();
    const row = store.getSettlement(intentId)!;
    assert.equal(row.outcome, "claimed_unbooked");
    assert.equal(row.resolvedBy, "resolver:x402:authorization_state");
    assert.ok(row.escalatedAt, "a human books it");
    assert.equal(
      f.held(),
      heldBefore,
      "a background job never books or releases a claimed payment",
    );
  });

  it("an authorization that expired unclaimed ends as expired_unclaimed and the hold goes back", async () => {
    const f = fixture();
    const start = f.avail();
    const { intentId } = await uncertainX402(f, 10_000n);
    assert.equal(f.held(), 10_000n);
    recovery.__setOutcomeReadersForTests({ authorizationState: async () => "unused" });

    // Still valid: unused proves nothing yet.
    __setStoreClockOffsetForTests(3 * MIN);
    await recovery.recoverStuckSettlements();
    assert.equal(store.getSettlement(intentId)!.outcome, "outcome_unknown");

    // Past validBefore (+ grace): it can never be claimed.
    __setStoreClockOffsetForTests(15 * MIN);
    await recovery.recoverStuckSettlements();
    const row = store.getSettlement(intentId)!;
    assert.equal(row.outcome, "expired_unclaimed");
    assert.equal(row.state, "failed");
    assert.equal(f.held(), 0n);
    assert.equal(f.avail(), start);
    assert.equal(row.releasedTo, `dept:${f.budget.id}:available`);
    assert.equal(row.releaseReason, "expired_unclaimed");

    const status = await call(`/v1/agent/intents/${intentId}/status`, f.agent.apiKey);
    assert.equal(status.status, 200);
    assert.equal(status.body.state, "expired_unclaimed");
    assert.equal(status.body.terminal, true);
    assert.equal(status.body.recheck_after, undefined);

    // A second sweep cannot release it twice.
    await recovery.recoverStuckSettlements();
    assert.equal(f.avail(), start);
  });

  it("a named human can close an unknown as unresolved; the amount stays counted", async () => {
    const f = fixture();
    const { intentId } = await uncertainX402(f);
    const closed = await call(`/v1/guardian/settlements/${intentId}/close`, f.org.guardianKey, {});
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    assert.equal(closed.body.state, "unresolved_closed");
    assert.ok(closed.body.settlement.resolvedBy);
    assert.ok(closed.body.settlement.resolvedAt);
    assert.equal(f.held(), 10_000n, "closing does not release the budget");
    assert.ok(store.merchantReservedMicro(f.org.id, `${sellerBase}/report`) >= 10_000n);
    // It is not "failed", and it cannot be closed twice.
    const again = await call(`/v1/guardian/settlements/${intentId}/close`, f.org.guardianKey, {});
    assert.equal(again.status, 409);
  });
});

describe("item 2: status read, recheck_after, not assessed, unknown-on-mismatch", () => {
  it("returns not_assessed when the policy could not be evaluated", async () => {
    const f = fixture();
    const original = store.getPolicyTemplate;
    store.getPolicyTemplate = () => {
      throw new Error("policy row unreadable");
    };
    let r: Awaited<ReturnType<typeof call>>;
    try {
      r = await call("/v1/agent/pay", f.agent.apiKey, {
        amountUsdc: "1",
        destination: PAYEE,
        idempotencyKey: key(),
      });
    } finally {
      store.getPolicyTemplate = original;
    }
    assert.equal(r.status, 503);
    assert.equal(r.body.state, "not_assessed");
    assert.ok(r.body.recheck_after);
    const s = await call(`/v1/agent/intents/${r.body.intentId}/status`, f.agent.apiKey);
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.body.state, "not_assessed");
    assert.equal(s.body.terminal, true);
  });

  it("awaiting approval carries recheck_after; a refusal reads rejected_by_policy; settled reads settled", async () => {
    const f = fixture({ hitlAboveUsdc: 5 });
    const parked = await call("/v1/agent/pay", f.agent.apiKey, {
      amountUsdc: "6",
      destination: PAYEE,
      idempotencyKey: key(),
    });
    assert.equal(parked.status, 202);
    assert.equal(parked.body.state, "awaiting_approval");
    assert.ok(parked.body.recheck_after);
    const s1 = await call(`/v1/agent/intents/${parked.body.intentId}/status`, f.agent.apiKey);
    assert.equal(s1.body.state, "awaiting_approval");
    assert.ok(s1.body.recheck_after);

    const denied = await call("/v1/agent/pay", f.agent.apiKey, {
      amountUsdc: "1",
      destination: "0x9999999999999999999999999999999999999999",
      idempotencyKey: key(),
    });
    assert.equal(denied.status, 403);
    const s2 = await call(`/v1/agent/intents/${denied.body.intentId}/status`, f.agent.apiKey);
    assert.equal(s2.body.state, "rejected_by_policy");

    const ok = await call("/v1/agent/pay", f.agent.apiKey, {
      amountUsdc: "1",
      destination: PAYEE,
      idempotencyKey: key(),
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const s3 = await call(`/v1/agent/intents/${ok.body.intentId}/status`, f.agent.apiKey);
    assert.equal(s3.body.state, "settled");
    assert.equal(s3.body.terminal, true);

    // Another agent cannot read it.
    const other = store.createAgent(f.org.id, "Other");
    const s4 = await call(`/v1/agent/intents/${ok.body.intentId}/status`, other.apiKey);
    assert.equal(s4.status, 404);
  });

  it("the same key with a different request maps to unknown, not failed", async () => {
    const f = fixture();
    const k = key();
    const first = await call("/v1/agent/pay", f.agent.apiKey, {
      amountUsdc: "1",
      destination: PAYEE,
      idempotencyKey: k,
    });
    assert.equal(first.status, 200);
    const mismatch = await call("/v1/agent/pay", f.agent.apiKey, {
      amountUsdc: "2",
      destination: PAYEE,
      idempotencyKey: k,
    });
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.error.code, "IDEMPOTENCY_MISMATCH");
    assert.equal(mismatch.body.state, "outcome_unknown");
    assert.equal(mismatch.body.intentId, first.body.intentId);
    const replay = await call("/v1/agent/pay", f.agent.apiKey, {
      amountUsdc: "1",
      destination: PAYEE,
      idempotencyKey: k,
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    // The key's retention expiry is stored next to the operation.
    const row = store.getSettlement(first.body.intentId)!;
    assert.equal(row.idempotencyKey, k);
    assert.ok(Date.parse(row.idempotencyExpiresAt!) > Date.now() + 24 * 60 * MIN);
  });

  it("the escalation deadline is always before the idempotency key expires", () => {
    assert.ok(recovery.escalateAfterMs() < storeMod.idempotencyTtlMs());
    const d = recovery.unknownDeadlines(0);
    assert.ok(Date.parse(d.escalateAt) < storeMod.idempotencyTtlMs());
  });
});

// ============================================================ withdrawals

/** Org with $100 that arrived on-chain, booked in the treasury. */
function treasuryOrg() {
  const org = store.createOrg(`Oct30 Treasury ${++n}`, 0n);
  store.applyEntries(org.id, [
    {
      id: `j_seed_${org.id}`,
      orgId: org.id,
      memo: "onchain_deposit:test",
      createdAt: new Date().toISOString(),
      lines: [
        { accountId: `org:${org.id}:external`, deltaMicro: -100_000_000n },
        { accountId: `org:${org.id}:available`, deltaMicro: 100_000_000n },
      ],
    },
  ]);
  return org;
}
const withdraw = (guardianKey: string, body: Record<string, unknown>) =>
  call("/v1/guardian/treasury/withdraw", guardianKey, body);

describe("item 2: withdrawals are safe to retry and guarded", () => {
  it("the same idempotency key sends once and replays the first result", async () => {
    const org = treasuryOrg();
    const k = key();
    const before = broadcasts;
    const a = await withdraw(org.guardianKey, {
      amountUsdc: "5",
      destination: DEST,
      idempotencyKey: k,
    });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await withdraw(org.guardianKey, {
      amountUsdc: "5",
      destination: DEST,
      idempotencyKey: k,
    });
    assert.equal(b.status, 200);
    assert.equal(b.body.replayed, true);
    assert.equal(b.body.intentId, a.body.intentId);
    assert.equal(broadcasts, before + 1, "one transfer, not two");
    const row = store.getSettlement(a.body.intentId)!;
    assert.equal(row.state, "settled");
    assert.equal(row.idempotencyKey, `withdraw:${k}`);
    assert.ok(row.idempotencyExpiresAt);
    assert.equal(row.resolver, "chain:tx_receipt");
    assert.equal(row.signedMaxMicro, 5_000_000n);

    // Header form works too, and a different request under the key is unknown.
    const c = await fetch(`${base}/v1/guardian/treasury/withdraw`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${org.guardianKey}`,
        "content-type": "application/json",
        "idempotency-key": k,
      },
      body: JSON.stringify({ amountUsdc: "6", destination: DEST }),
    });
    const cj = (await c.json()) as Json;
    assert.equal(c.status, 409);
    assert.equal(cj.error.code, "IDEMPOTENCY_MISMATCH");
    assert.equal(cj.state, "outcome_unknown");
    assert.equal(broadcasts, before + 1);
  });

  it("a clean failure frees the key so the same request can be retried", async () => {
    const org = treasuryOrg();
    const k = key();
    onchainUsdc = 0n;
    const a = await withdraw(org.guardianKey, {
      amountUsdc: "5",
      destination: DEST,
      idempotencyKey: k,
    });
    assert.equal(a.status, 400);
    assert.equal(store.getSettlement(a.body.intentId ?? "")?.state ?? "failed", "failed");
    onchainUsdc = 10_000_000_000_000n;
    const b = await withdraw(org.guardianKey, {
      amountUsdc: "5",
      destination: DEST,
      idempotencyKey: k,
    });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.notEqual(b.body.replayed, true);
  });

  it("an unconfirmed withdrawal is outcome_unknown, replays as unknown, and its amount is reserved", async () => {
    const org = treasuryOrg();
    // Raise the review threshold so both sends below execute directly.
    store.setOrgSettings(org.id, {
      ...(store.getOrg(org.id)!.settings ?? {}),
      treasuryHitlUsdc: "500",
    } as never);
    const k = key();
    receipt = "timeout";
    const before = broadcasts;
    const a = await withdraw(org.guardianKey, {
      amountUsdc: "40",
      destination: DEST,
      idempotencyKey: k,
    });
    assert.equal(a.status, 409, JSON.stringify(a.body));
    assert.equal(a.body.state, "outcome_unknown");
    assert.ok(a.body.recheck_after);
    assert.ok(a.body.escalate_at);
    const row = store.getSettlement(a.body.intentId)!;
    assert.equal(row.outcome, "outcome_unknown");
    assert.match(String(row.escalateTo), /^owner:/);
    assert.ok(Date.parse(row.escalateAt!) < Date.parse(row.idempotencyExpiresAt!));

    receipt = "success";
    const retry = await withdraw(org.guardianKey, {
      amountUsdc: "40",
      destination: DEST,
      idempotencyKey: k,
    });
    assert.equal(retry.status, 409);
    assert.equal(retry.body.replayed, true);
    assert.equal(broadcasts, before + 1, "a retry never sends twice");

    // The ledger still shows $100, but $40 may be gone: a new $70 must not pass (only $60 is free).
    const more = await withdraw(org.guardianKey, {
      amountUsdc: "70",
      destination: DEST,
      idempotencyKey: key(),
    });
    assert.equal(more.status, 403, JSON.stringify(more.body));
    assert.deepEqual(more.body.ruleIds, ["treasury_withdraw_reserved"]);

    const status = await call(`/v1/guardian/settlements/${a.body.intentId}`, org.guardianKey);
    assert.equal(status.body.state, "outcome_unknown");
    assert.equal(status.body.settlement.heldUsdc, "40");
  });

  it("an in-flight withdrawal is reserved in the shared database, not in process memory", () => {
    const org = treasuryOrg();
    const g = guardTreasuryWithdraw({
      org,
      actor: "tester",
      assetId: "asset_usdc",
      amountMicro: 7_000_000n,
      amountDisplay: "7",
      destination: DEST,
      availableMicro: 100_000_000n,
    });
    assert.equal(g.ok, true);
    assert.equal(store.treasuryWithdrawInFlightMicro(org.id), 7_000_000n);
    if (g.ok) g.fail("test", "TEST");
    assert.equal(store.treasuryWithdrawInFlightMicro(org.id), 0n);
  });
});

// ============================================================ cross-process locks

describe("item 2: locks work across processes", () => {
  it("a vault lock waits for a lease held by another process", async () => {
    const vault = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const child = join(dir, "holder.mjs");
    writeFileSync(
      child,
      `const { store } = await import(${JSON.stringify(join(here, "store.ts"))});
       if (!store.acquireJobLock("lock:${vault}", "child-process", 60000)) process.exit(3);
       console.log("held");
       setTimeout(() => { store.releaseJobLock("lock:${vault}", "child-process"); console.log("released"); setTimeout(() => process.exit(0), 50); }, 400);`,
    );
    const proc = spawn(process.execPath, ["--import", "tsx", child], {
      cwd: join(here, ".."),
      // Not a test-runner child: strip the runner's context from the env.
      env: Object.fromEntries(
        Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")),
      ),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = new Promise((r) => proc.once("exit", r));
    let out = "";
    let releasedAt = 0;
    let errOut = "";
    proc.stderr.on("data", (d) => {
      errOut += String(d);
    });
    proc.stdout.on("data", (d) => {
      out += String(d);
      if (out.includes("released") && !releasedAt) releasedAt = Date.now();
    });
    await new Promise<void>((resolve, reject) => {
      const t = setInterval(() => {
        if (out.includes("held")) {
          clearInterval(t);
          resolve();
        }
      }, 10);
      proc.once("exit", (code) => {
        if (!out.includes("held"))
          reject(new Error(`child exited ${code}: ${errOut.slice(0, 500)}`));
      });
    });
    let ranAt = 0;
    await withVaultLock(vault, async () => {
      ranAt = Date.now();
    });
    await exited;
    assert.ok(releasedAt > 0, "child released its lease");
    assert.ok(ranAt >= releasedAt - 5, "the task waited for the other process's lease");
  });

  it("gives up before running anything when the other holder never lets go", async () => {
    const vault = "0x1234123412341234123412341234123412341234";
    assert.ok(store.acquireJobLock(`lock:${vault}`, "stuck-holder", 60_000));
    const prev = process.env.ABI_VAULT_LOCK_WAIT_MS;
    process.env.ABI_VAULT_LOCK_WAIT_MS = "100";
    let ran = false;
    try {
      await assert.rejects(
        withVaultLock(vault, async () => {
          ran = true;
        }),
        (e: unknown) => e instanceof VaultLockTimeoutError,
      );
    } finally {
      if (prev === undefined) delete process.env.ABI_VAULT_LOCK_WAIT_MS;
      else process.env.ABI_VAULT_LOCK_WAIT_MS = prev;
      store.releaseJobLock(`lock:${vault}`, "stuck-holder");
    }
    assert.equal(ran, false, "nothing signed or sent");
  });

  it("a crashed holder's lease expires instead of wedging the vault", () => {
    assert.ok(store.acquireJobLock("lock:crash-test", "dead", 1));
    const wait = Date.now() + 5;
    while (Date.now() < wait) {
      /* let the 1ms lease lapse */
    }
    assert.ok(store.acquireJobLock("lock:crash-test", "alive", 60_000));
    store.releaseJobLock("lock:crash-test", "alive");
  });
});

// ============================================================ item 4

describe("item 4: approval record and outflow reconciliation", () => {
  it("the agent can read who approved, when, and the rules hash it was checked against", async () => {
    const f = fixture({ hitlAboveUsdc: 5 });
    const parked = await call("/v1/agent/pay", f.agent.apiKey, {
      amountUsdc: "6",
      destination: PAYEE,
      idempotencyKey: key(),
    });
    const before = await call(`/v1/agent/approvals/${parked.body.approvalId}`, f.agent.apiKey);
    assert.equal(before.status, 200);
    assert.match(before.body.approval.rulesHash, /^[0-9a-f]{64}$/);
    assert.equal(before.body.approval.policyRevision, store.getPolicyVersion(f.org.id));
    assert.equal(before.body.approval.approver, null);
    assert.deepEqual(before.body.approval.stale, []);
    assert.ok(before.body.approval.staleIf.includes("policy_revision_changed"));

    // A policy edit makes the pending approval visibly stale.
    store.setPolicyTemplate(f.org.id, { ...store.getPolicyTemplate(f.org.id) }, "edit");
    const stale = await call(`/v1/agent/approvals/${parked.body.approvalId}`, f.agent.apiKey);
    assert.deepEqual(stale.body.approval.stale, ["policy_revision_changed"]);

    const resolved = await call(
      `/v1/guardian/approvals/${parked.body.approvalId}/resolve`,
      f.org.guardianKey,
      { approve: true },
    );
    assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
    const afterRead = await call(`/v1/agent/approvals/${parked.body.approvalId}`, f.agent.apiKey);
    const approver = afterRead.body.approval.approver;
    assert.ok(approver.resolvedBy);
    assert.ok(approver.resolvedAt);
    assert.equal(approver.votes.length, 1);
    assert.equal(approver.votes[0].approve, true);
    assert.ok(approver.votes[0].guardian);
    assert.ok(approver.votes[0].at);
  });

  it("lists outflows with transfer id, policy revision, staleness, and where released money went", async () => {
    const f = fixture();
    price = "10000";
    const { intentId } = await uncertainX402(f, 20_000n);
    const ok = await call("/v1/agent/pay", f.agent.apiKey, {
      amountUsdc: "1",
      destination: PAYEE,
      idempotencyKey: key(),
    });
    assert.equal(ok.status, 200);
    store.setPolicyTemplate(f.org.id, { ...store.getPolicyTemplate(f.org.id) }, "edit");

    const r = await call("/v1/guardian/reconciliation/outflows", f.org.guardianKey);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.note, /do not move the vault nonce/);
    const x = r.body.outflows.find((o: Json) => o.intentId === intentId);
    assert.equal(x.kind, "eip3009_authorization");
    assert.match(x.transferId, /^eip3009:0x[0-9a-f]{64}$/i);
    assert.equal(x.state, "outcome_unknown");
    assert.equal(x.signedMaxUsdc, "0.01");
    assert.ok(x.policyRevision);
    assert.ok(x.checkedAt);
    assert.deepEqual(x.stale, ["policy_revision_changed"]);
    assert.ok(x.staleIf.includes("amount_changed"));
    assert.equal(x.released.to, `dept:${f.budget.id}:available`);
    assert.equal(x.released.amountUsdc, "0.01");
    assert.equal(x.released.cancelledAfterEffect, true);
    const settled = r.body.outflows.find((o: Json) => o.intentId === ok.body.intentId);
    assert.equal(settled.state, "settled");
    assert.equal(r.body.summary.open >= 1, true);

    // On-chain cross-check with stand-in readers: a claimed voucher the ledger
    // has not booked is a finding; the nonce gap is reported.
    recovery.__setOutcomeReadersForTests({
      authorizationState: async () => "used",
      txStatus: async () => "unknown",
      vaultNonce: async () => 3,
    });
    const onchain = await call("/v1/guardian/reconciliation/outflows?onchain=1", f.org.guardianKey);
    const xo = onchain.body.outflows.find((o: Json) => o.intentId === intentId);
    assert.equal(xo.onchain.voucherClaim, "used");
    assert.deepEqual(xo.onchain.findings, ["claimed_not_booked"]);
    assert.equal(onchain.body.nonce.onchainNonce, 3);
    assert.equal(onchain.body.nonce.recordedDirectSends, 0);
    assert.equal(onchain.body.nonce.unexplained, 3);
  });
});

// ============================================================ item 5

describe("item 5: x402 SDK pinned at 2.28", () => {
  it("installs @x402/core and @x402/evm 2.28.x and pins them in the API and both sellers", () => {
    const root = join(here, "..", "..", "..");
    for (const pkg of ["@x402/core", "@x402/evm"]) {
      const v = JSON.parse(readFileSync(join(root, "node_modules", pkg, "package.json"), "utf8"))
        .version as string;
      assert.match(v, /^2\.28\./, `${pkg} is ${v}`);
    }
    for (const app of ["api", "x402-seller", "x402-seller-worker"]) {
      const deps = JSON.parse(readFileSync(join(root, "apps", app, "package.json"), "utf8"))
        .dependencies as Record<string, string>;
      assert.equal(deps["@x402/core"], "~2.28.0", app);
      assert.equal(deps["@x402/evm"], "~2.28.0", app);
    }
  });
});
