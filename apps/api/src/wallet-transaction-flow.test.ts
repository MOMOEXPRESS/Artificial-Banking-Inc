/**
 * Wallet + transaction flow regressions (PROMPT 2).
 *
 * TEST-ONLY FIXTURES: the chain is a local fake (setVaultChainClientsForTests)
 * and CHAIN_RPC_URL points at a closed port, so nothing here touches Base
 * Sepolia or any real RPC. Transaction hashes below are synthetic fixture
 * values, never presented as on-chain evidence.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { generatePrivateKey } from "viem/accounts";

const dir = mkdtempSync(join(tmpdir(), "abi-wallet-flow-"));
process.env.POLICYVAULT_DB = join(dir, "wallet.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_KEK = "test-kek";
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";
process.env.CHAIN = "base-sepolia";
// Unreachable on purpose: any accidental real RPC read fails fast.
process.env.CHAIN_RPC_URL = "http://127.0.0.1:9";
process.env.ABI_TX_RECEIPT_TIMEOUT_MS = "50";
delete process.env.POLICYVAULT_MOCK_TRANSFER;

const { store } = await import("./store.js");
const { app } = await import("./index.js");
const { id } = await import("./engine.js");
const transfer = await import("./chain/transfer.js");
const { buildWalletProfile, verifyVaultAddress, assetSendSupport } =
  await import("./chain/wallet-profile.js");
const { setCustodyProvider, DevLocalProvider } = await import("@policyvault/custody");
setCustodyProvider(
  new DevLocalProvider(
    () => null,
    async () => "0x" as `0x${string}`,
  ),
);

const FIXTURE_HASH = `0x${"ab".repeat(32)}` as `0x${string}`; // synthetic, test-only
const DEST = `0x${"22".repeat(20)}`;

type FakeChain = {
  usdcMicro: bigint;
  ethWei: bigint;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  receipt: "success" | "reverted" | "timeout";
  writes: number;
  writeDelayMs: number;
};
let chain: FakeChain;
function resetChain(over: Partial<FakeChain> = {}) {
  chain = {
    usdcMicro: 1_000_000_000n,
    ethWei: 10n ** 16n, // 0.01 ETH
    gasLimit: 65_000n,
    maxFeePerGas: 1_000_000_000n, // 1 gwei
    receipt: "success",
    writes: 0,
    writeDelayMs: 0,
    ...over,
  };
}
resetChain();
transfer.setVaultChainClientsForTests((_cfg, privateKey) => {
  // Same derivation as viem, so the vault key/address check still runs.
  const address = (globalThis as { __acct?: (k: string) => `0x${string}` }).__acct!(privateKey);
  return {
    account: { address },
    publicClient: {
      readContract: async () => chain.usdcMicro,
      getBalance: async () => chain.ethWei,
      estimateContractGas: async () => chain.gasLimit,
      estimateFeesPerGas: async () => ({ maxFeePerGas: chain.maxFeePerGas }),
      waitForTransactionReceipt: async () => {
        if (chain.receipt === "timeout") throw new Error("Timed out while waiting for transaction");
        return { status: chain.receipt };
      },
    },
    walletClient: {
      writeContract: async () => {
        chain.writes += 1;
        if (chain.writeDelayMs) await new Promise((r) => setTimeout(r, chain.writeDelayMs));
        return FIXTURE_HASH;
      },
    },
  };
});
const { privateKeyToAccount } = await import("viem/accounts");
(globalThis as { __acct?: (k: string) => `0x${string}` }).__acct = (k) =>
  privateKeyToAccount(k as `0x${string}`).address;

let base = "";
let server: ReturnType<typeof app.listen>;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  transfer.setVaultChainClientsForTests(null);
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => resetChain());

const asGuardian = (key: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

function creditOrg(orgId: string, micro: bigint) {
  store.applyEntries(orgId, [
    {
      id: id("j"),
      orgId,
      memo: "test_onchain_deposit",
      createdAt: new Date().toISOString(),
      lines: [
        { accountId: `org:${orgId}:external`, deltaMicro: -micro },
        { accountId: `org:${orgId}:available`, deltaMicro: micro },
      ],
    },
  ]);
}

describe("wallet source of truth", () => {
  it("one verified address for every token on Base Sepolia; gas is separate and never guessed", async () => {
    const org = store.createOrg("Profile Co", 0n, { ledgerMode: "sandbox" });
    const res = await asGuardian(org.guardianKey, "/v1/guardian/wallet");
    assert.equal(res.status, 200);
    const p = (await res.json()) as {
      address: string;
      addressVerified: boolean;
      network: { id: string; chainId: number };
      gas: { sufficient: boolean | null; balanceEth: string | null; chainId: number };
      funding: { instructions: string[]; wrongNetworks: { chainId: number }[] };
      balancesSimulated: boolean;
      custody: { gasSponsorship: boolean };
      assets: { symbol: string; receiveAddress: string | null; send: { mode: string } }[];
    };
    const vault = store.getVaultAddress(org.id)!;
    assert.equal(p.addressVerified, true);
    assert.equal(p.address, vault);
    assert.equal(p.network.id, "base-sepolia");
    assert.equal(p.network.chainId, 84532);
    assert.equal(p.gas.chainId, 84532);
    // RPC unreachable in tests: unknown, not "0" and not "enough".
    assert.equal(p.gas.sufficient, null);
    assert.equal(p.gas.balanceEth, null);
    assert.equal(p.custody.gasSponsorship, false);
    assert.equal(p.balancesSimulated, true);
    assert.ok(
      p.funding.wrongNetworks.some((n) => n.chainId === 11155111),
      "warns about Ethereum Sepolia",
    );
    assert.match(p.funding.instructions.join(" "), /chain id 84532/);
    const by = (s: string) => p.assets.find((a) => a.symbol === s)!;
    assert.equal(by("USDC").receiveAddress, vault);
    assert.equal(by("EURC").receiveAddress, vault, "tokens on one network share the address");
    assert.equal(by("ETH").receiveAddress, vault);
    assert.equal(by("BTC").receiveAddress, null, "never reuse the EVM address for BTC");
    assert.equal(by("USDC").send.mode, "simulated");
  });

  it("sandbox profile says agent wallet payments use real testnet USDC, not simulated", async () => {
    const org = store.createOrg("Honest Sandbox Co", 0n, { ledgerMode: "sandbox" });
    const res = await asGuardian(org.guardianKey, "/v1/guardian/wallet");
    const p = (await res.json()) as {
      agentPayments: {
        mode: string;
        realFunds: boolean;
        testnet: boolean;
        chainId: number;
        note: string;
      };
      assets: { symbol: string; send: { mode: string; reason: string } }[];
    };
    assert.equal(p.agentPayments.mode, "onchain");
    assert.equal(p.agentPayments.realFunds, true);
    assert.equal(p.agentPayments.testnet, true);
    assert.equal(p.agentPayments.chainId, 84532);
    assert.match(p.agentPayments.note, /real Base Sepolia testnet USDC/);
    const usdc = p.assets.find((a) => a.symbol === "USDC")!;
    assert.match(usdc.send.reason, /Agent payments to a wallet address/);
    assert.match(usdc.send.reason, /real Base Sepolia testnet USDC/);
    assert.doesNotMatch(
      usdc.send.reason,
      /^Sandbox organization: the books move, nothing is broadcast on-chain\.$/,
    );
  });

  it("sandbox agent payment to a 0x address really broadcasts on the USDC rail (kept on purpose)", async () => {
    const org = store.createOrg("Sandbox Rail Co", 0n, { ledgerMode: "sandbox" });
    const agent = store.createAgent(org.id, "Sandbox payer");
    const budget = store.createDepartment(org.id, "Ops");
    assert.equal(store.assignAgentBudget(org.id, agent.agentId, budget.id), "ok");
    const t = store.getPolicyTemplate(org.id);
    store.setPolicyTemplate(org.id, {
      ...t,
      addressAllowlist: [DEST],
      perTxMaxMicro: 100_000_000n,
      dailyMaxMicro: 500_000_000n,
      hitlAboveMicro: 1_000_000_000n,
      newCounterpartyCooldownHours: 0,
    });
    store.addKnownCounterparty(org.id, DEST);
    store.applyEntries(org.id, [
      {
        id: id("j"),
        orgId: org.id,
        memo: "seed",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `org:${org.id}:external`, deltaMicro: -10_000_000n },
          { accountId: `dept:${budget.id}:available`, deltaMicro: 10_000_000n },
        ],
      },
    ]);
    const res = await fetch(`${base}/v1/agent/pay`, {
      method: "POST",
      headers: { authorization: `Bearer ${agent.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        amountUsdc: "1",
        destination: DEST,
        idempotencyKey: "sandbox-rail-1",
      }),
    });
    const body = (await res.json()) as { intentId: string; outcome: string };
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(chain.writes, 1, "sandbox agent payments broadcast a real transfer");
    const row = store.getSettlement(body.intentId);
    assert.equal(row?.state, "settled");
    assert.equal(row?.rail, "evm-usdc-transfer");
    assert.equal(row?.txHash, FIXTURE_HASH);
  });

  it("hides the address (no copy/QR target) when the stored key does not derive to it", () => {
    const other = generatePrivateKey();
    assert.equal(verifyVaultAddress(DEST, other), "key-mismatch");
    assert.equal(verifyVaultAddress(undefined, other), "no-vault");
    const p = buildWalletProfile({
      orgId: "org_x",
      ledgerMode: "live",
      vaultAddress: DEST,
      vaultPrivateKey: other,
      custodyProvider: "dev-local",
      assets: store.listAssets("org_x"),
      ledgerAvailableMicro: 0n,
      unbackedMicro: 0n,
      snap: null,
    });
    assert.equal(p.address, null);
    assert.equal(p.addressVerified, false);
    assert.ok(p.assets.every((a) => a.receiveAddress === null));
    assert.equal(p.funding.sendUsdcTo, null);
  });

  it("reports insufficient gas despite a USDC balance", () => {
    const key = generatePrivateKey();
    const addr = privateKeyToAccount(key).address;
    const p = buildWalletProfile({
      orgId: "org_y",
      ledgerMode: "live",
      vaultAddress: addr,
      vaultPrivateKey: key,
      custodyProvider: "self-custody",
      assets: [],
      ledgerAvailableMicro: 5_000_000n,
      unbackedMicro: 0n,
      snap: {
        ok: true,
        nativeBalanceWei: "0",
        onchainBalanceUsdc: "5.00",
        onchainBalanceMicro: "5000000",
      } as never,
    });
    assert.equal(p.usdc.onchainUsdc, "5.00");
    assert.equal(p.gas.sufficient, false);
    assert.equal(p.gas.empty, true);
  });
});

describe("pasted agent / session keys are checked against the authenticated org", () => {
  it("rejects a key from another account, revoked and malformed keys; accepts its own", async () => {
    const a = store.createOrg("Account A", 0n, { ledgerMode: "sandbox" });
    const b = store.createOrg("Account B", 0n, { ledgerMode: "sandbox" });
    const agentA = store.createAgent(a.id, "A agent");
    const agentB = store.createAgent(b.id, "B agent");

    const own = await asGuardian(a.guardianKey, "/v1/guardian/agent-keys/verify", {
      key: agentA.apiKey,
    });
    assert.equal(own.status, 200);
    assert.equal(((await own.json()) as { agentId: string }).agentId, agentA.agentId);

    const cross = await asGuardian(a.guardianKey, "/v1/guardian/agent-keys/verify", {
      key: agentB.apiKey,
    });
    assert.equal(cross.status, 403);
    const crossBody = (await cross.json()) as { error: { code: string; message: string } };
    assert.equal(crossBody.error.code, "KEY_ORG_MISMATCH");
    assert.doesNotMatch(JSON.stringify(crossBody), new RegExp(`${agentB.agentId}|${b.id}|B agent`));

    const sess = store.createSessionKey({ orgId: a.id, agentId: agentA.agentId, scopes: ["read"] });
    const okSess = await asGuardian(a.guardianKey, "/v1/guardian/agent-keys/verify", {
      key: sess.token,
    });
    assert.deepEqual(((await okSess.json()) as { scopes: string[] }).scopes, ["read"]);
    store.revokeSessionKey(a.id, sess.id);
    const revoked = await asGuardian(a.guardianKey, "/v1/guardian/agent-keys/verify", {
      key: sess.token,
    });
    assert.equal(revoked.status, 401);

    const malformed = await asGuardian(a.guardianKey, "/v1/guardian/agent-keys/verify", {
      key: "hello",
    });
    assert.equal(malformed.status, 400);

    // A client-supplied org header cannot redirect a guardian key to another org.
    const spoof = await fetch(`${base}/v1/guardian/agent-keys/verify`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${a.guardianKey}`,
        "x-abi-org": b.id,
        "content-type": "application/json",
      },
      body: JSON.stringify({ key: agentB.apiKey }),
    });
    assert.equal(spoof.status, 403);
  });
});

describe("simulated vs real, and unsupported assets", () => {
  it("sandbox deposit is labelled simulated and is tracked as unbacked", async () => {
    const org = store.createOrg("Sandbox Co", 0n, { ledgerMode: "sandbox" });
    const before_ = store.getUnbackedMicro(org.id);
    const res = await asGuardian(org.guardianKey, "/v1/guardian/treasury/deposit", {
      amountUsdc: "25",
    });
    const body = (await res.json()) as { simulated: boolean; onchain: boolean };
    assert.equal(res.status, 200);
    assert.equal(body.simulated, true);
    assert.equal(body.onchain, false);
    assert.equal(store.getUnbackedMicro(org.id) - before_, 25_000_000n);
    assert.equal(chain.writes, 0);
  });

  it("live org cannot mint USDC or 'send' EURC/ETH by bookkeeping", async () => {
    const org = store.createOrg("Live Co", 0n, { ledgerMode: "live" });
    const mint = await asGuardian(org.guardianKey, "/v1/guardian/treasury/deposit", {
      amountUsdc: "5",
    });
    assert.equal(mint.status, 400);
    for (const assetId of ["asset_eurc", "asset_eth"]) {
      const res = await asGuardian(org.guardianKey, "/v1/guardian/treasury/withdraw", {
        amountUsdc: "1",
        assetId,
        destination: DEST,
      });
      assert.equal(res.status, 409, assetId);
      assert.equal(
        ((await res.json()) as { error: { code: string } }).error.code,
        "ASSET_SEND_UNSUPPORTED",
      );
    }
    assert.equal(chain.writes, 0);
  });

  it("send support matrix is explicit", () => {
    const usdc = store.getAsset("asset_usdc")!;
    const eurc = store.getAsset("asset_eurc")!;
    const btc = store.getAsset("asset_btc")!;
    assert.equal(assetSendSupport(usdc, "live").mode, "onchain");
    assert.equal(assetSendSupport(usdc, "sandbox").mode, "simulated");
    assert.equal(assetSendSupport(eurc, "live").mode, "unsupported");
    assert.equal(assetSendSupport(btc, "live").mode, "recorded");
  });
});

describe("chain transfer preflight and uncertain settlement", () => {
  it("refuses before broadcast when ETH cannot cover gas, even with plenty of USDC", async () => {
    const org = store.createOrg("Gasless Co", 0n, { ledgerMode: "live" });
    resetChain({ ethWei: 1_000n, usdcMicro: 50_000_000n });
    await assert.rejects(
      transfer.transferUsdcFromVault({ orgId: org.id, to: DEST, amountMicro: 1_000_000n }),
      (e: InstanceType<typeof transfer.VaultTransferError>) => {
        assert.equal(e.code, "INSUFFICIENT_GAS");
        assert.match(e.message, /Base Sepolia ETH \(chain id 84532\)/);
        assert.match(e.message, /Ethereum Sepolia/);
        return true;
      },
    );
    assert.equal(chain.writes, 0);
  });

  it("refuses to transfer to the org's own vault before broadcasting", async () => {
    const org = store.createOrg("Self Pay Co", 0n, { ledgerMode: "live" });
    const self = store.getVaultAddress(org.id)!;
    await assert.rejects(
      transfer.transferUsdcFromVault({ orgId: org.id, to: self, amountMicro: 1_000_000n }),
      (e: Error & { code?: string }) => e.code === "INVALID_DESTINATION",
    );
    assert.equal(chain.writes, 0);
  });

  it("an agent can pay another ABI account's vault on-chain (org A -> org B)", async () => {
    const b = store.createOrg("Receiver B", 0n, { ledgerMode: "sandbox" });
    const vaultB = store.getVaultAddress(b.id)!;
    const a = store.createOrg("Payer A", 0n, { ledgerMode: "sandbox" });
    const agent = store.createAgent(a.id, "A payer");
    const budget = store.createDepartment(a.id, "Ops");
    assert.equal(store.assignAgentBudget(a.id, agent.agentId, budget.id), "ok");
    store.setPolicyTemplate(a.id, {
      ...store.getPolicyTemplate(a.id),
      addressAllowlist: [vaultB],
      perTxMaxMicro: 100_000_000n,
      dailyMaxMicro: 500_000_000n,
      hitlAboveMicro: 1_000_000_000n,
      newCounterpartyCooldownHours: 0,
    });
    store.addKnownCounterparty(a.id, vaultB);
    store.applyEntries(a.id, [
      {
        id: id("j"),
        orgId: a.id,
        memo: "seed",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `org:${a.id}:external`, deltaMicro: -5_000_000n },
          { accountId: `dept:${budget.id}:available`, deltaMicro: 5_000_000n },
        ],
      },
    ]);
    const res = await fetch(`${base}/v1/agent/pay`, {
      method: "POST",
      headers: { authorization: `Bearer ${agent.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ amountUsdc: "0.10", destination: vaultB, idempotencyKey: "a-to-b-1" }),
    });
    const body = (await res.json()) as { txHash: string; rail: string; resource: { to: string } };
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.rail, "evm-usdc-transfer");
    assert.equal(body.txHash, FIXTURE_HASH);
    assert.equal(chain.writes, 1);
  });

  it("gas shortfall math uses estimate x fee x 1.2 headroom", () => {
    const r = transfer.gasShortfallWei({
      nativeBalanceWei: 0n,
      gasLimit: 100n,
      maxFeePerGasWei: 10n,
    });
    assert.equal(r.requiredWei, 1_200n);
    assert.equal(r.shortfallWei, 1_200n);
    assert.equal(
      transfer.gasShortfallWei({ nativeBalanceWei: 5_000n, gasLimit: 100n, maxFeePerGasWei: 10n })
        .shortfallWei,
      0n,
    );
  });

  it("a receipt timeout is SETTLEMENT_UNCONFIRMED with the hash, not a failure", async () => {
    const org = store.createOrg("Slow Chain Co", 0n, { ledgerMode: "live" });
    resetChain({ receipt: "timeout" });
    const seen: string[] = [];
    await assert.rejects(
      transfer.transferUsdcFromVault({
        orgId: org.id,
        to: DEST,
        amountMicro: 1_000_000n,
        onBroadcast: (h) => seen.push(h),
      }),
      (e: InstanceType<typeof transfer.VaultTransferError>) => {
        assert.equal(e.code, "SETTLEMENT_UNCONFIRMED");
        assert.equal(e.txHash, FIXTURE_HASH);
        return true;
      },
    );
    assert.deepEqual(seen, [FIXTURE_HASH]);
  });

  it("a broadcast invalidates cached balance reads so the next refresh is fresh", async () => {
    const { vaultBalanceCacheForTests } = await import("./chain/deposits.js");
    const org = store.createOrg("Stale Cache Co", 0n, { ledgerMode: "live" });
    vaultBalanceCacheForTests.prime(`rpc|${store.getVaultAddress(org.id)!.toLowerCase()}`);
    assert.equal(vaultBalanceCacheForTests.size(), 1);
    await transfer.transferUsdcFromVault({ orgId: org.id, to: DEST, amountMicro: 1_000n });
    assert.equal(vaultBalanceCacheForTests.size(), 0);
  });

  it("agent pay: uncertain settlement keeps the hold, is never booked, and a retry never re-broadcasts", async () => {
    const org = store.createOrg("Agent Pay Co", 0n, { ledgerMode: "live" });
    const agent = store.createAgent(org.id, "Payer");
    const budget = store.createDepartment(org.id, "Ops");
    assert.equal(store.assignAgentBudget(org.id, agent.agentId, budget.id), "ok");
    const t = store.getPolicyTemplate(org.id);
    store.setPolicyTemplate(org.id, {
      ...t,
      addressAllowlist: [DEST],
      perTxMaxMicro: 100_000_000n,
      dailyMaxMicro: 500_000_000n,
      hitlAboveMicro: 1_000_000_000n,
      newCounterpartyCooldownHours: 0,
    });
    store.addKnownCounterparty(org.id, DEST);
    store.applyEntries(org.id, [
      {
        id: id("j"),
        orgId: org.id,
        memo: "seed",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `org:${org.id}:external`, deltaMicro: -10_000_000n },
          { accountId: `dept:${budget.id}:available`, deltaMicro: 10_000_000n },
        ],
      },
    ]);
    resetChain({ receipt: "timeout" });
    const pay = () =>
      fetch(`${base}/v1/agent/pay`, {
        method: "POST",
        headers: { authorization: `Bearer ${agent.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          amountUsdc: "1.5",
          destination: DEST,
          idempotencyKey: "pay-uncertain-1",
        }),
      });
    const first = await pay();
    const body = (await first.json()) as {
      intentId: string;
      outcome: string;
      error: { code: string };
      settlement: { txHash: string };
    };
    assert.equal(first.status, 409);
    assert.equal(body.error.code, "SETTLEMENT_UNCERTAIN");
    assert.equal(body.outcome, "pending_reconciliation");
    assert.equal(body.settlement.txHash, FIXTURE_HASH);
    assert.equal(store.getSettlement(body.intentId)?.state, "needs_review");
    const map = store.getAccountMap(org.id);
    assert.equal(map.get(`dept:${budget.id}:held`)?.balanceMicro, 1_500_000n, "hold kept");
    assert.equal(map.get(`dept:${budget.id}:available`)?.balanceMicro, 8_500_000n);

    const retry = await pay();
    assert.equal(retry.status, 409);
    assert.equal(chain.writes, 1, "the retry must not broadcast a second transfer");
  });

  it("treasury withdraw: timeout leaves the books untouched and flags reconciliation", async () => {
    const org = store.createOrg("Withdraw Co", 0n, { ledgerMode: "live" });
    creditOrg(org.id, 10_000_000n);
    resetChain({ receipt: "timeout" });
    const res = await asGuardian(org.guardianKey, "/v1/guardian/treasury/withdraw", {
      amountUsdc: "1",
      destination: DEST,
    });
    const body = (await res.json()) as { intentId: string; error: { code: string } };
    assert.equal(res.status, 409);
    assert.equal(body.error.code, "SETTLEMENT_UNCERTAIN");
    assert.equal(store.getSettlement(body.intentId)?.state, "needs_review");
    assert.equal(
      store.getAccountMap(org.id).get(`org:${org.id}:available`)?.balanceMicro,
      10_000_000n,
    );
  });

  it("treasury withdraw: a confirmed live withdrawal marks its settlement settled with the hash", async () => {
    const org = store.createOrg("Settled Co", 0n, { ledgerMode: "live" });
    creditOrg(org.id, 10_000_000n);
    const res = await asGuardian(org.guardianKey, "/v1/guardian/treasury/withdraw", {
      amountUsdc: "1",
      destination: DEST,
    });
    const body = (await res.json()) as { intentId: string; txHash: string };
    assert.equal(res.status, 200);
    assert.equal(body.txHash, FIXTURE_HASH);
    const row = store.getSettlement(body.intentId);
    assert.equal(row?.state, "settled");
    assert.equal(row?.txHash, FIXTURE_HASH);
    // The recovery sweep only looks at pending/broadcast rows, so it can never
    // flag this withdrawal as "confirmed on-chain but not in the ledger".
    const { recoverStuckSettlements } = await import("./jobs/settlement-recovery.js");
    const before_ = store.getSettlement(body.intentId)?.state;
    await recoverStuckSettlements();
    assert.equal(store.getSettlement(body.intentId)?.state, before_);
  });

  it("concurrent treasury withdraws cannot both broadcast past the ledger balance", async () => {
    const org = store.createOrg("Race Co", 0n, { ledgerMode: "live" });
    creditOrg(org.id, 1_000_000n);
    resetChain({ writeDelayMs: 30 });
    const send = () =>
      asGuardian(org.guardianKey, "/v1/guardian/treasury/withdraw", {
        amountUsdc: "1",
        destination: DEST,
      });
    const [r1, r2] = await Promise.all([send(), send()]);
    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [200, 400]);
    assert.equal(chain.writes, 1);
    assert.equal(store.getAccountMap(org.id).get(`org:${org.id}:available`)?.balanceMicro, 0n);
  });
});
