/**
 * Vault chain reads under real RPC limits.
 *
 * sepolia.base.org now refuses eth_getLogs wider than 200 blocks (HTTP 413,
 * "eth_getLogs is limited to a 200 range"). The scanner used 2000-block pages,
 * so every vault read failed — balance included — and no deposit was ever
 * credited. These tests run against an in-memory RPC that enforces that cap.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-scan-"));
process.env.POLICYVAULT_DB = join(dir, "scan.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";
// Nothing listens here: any un-mocked chain read fails fast.
process.env.CHAIN_RPC_URL = "http://127.0.0.1:9/";
delete process.env.CHAIN_LOG_RANGE;

const { store } = await import("../store.js");
const deposits = await import("./deposits.js");
const sync = await import("./sync-deposits.js");
const { app } = await import("../index.js");

let base = "";
let server: ReturnType<typeof app.listen>;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server?.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
beforeEach(() => {
  deposits.resetLearnedLogRanges();
  sync.resetDepositSweepState();
});

type Log = {
  args: { from: `0x${string}`; to: `0x${string}`; value: bigint };
  transactionHash: `0x${string}`;
  logIndex: number;
  blockNumber: bigint;
};

/** viem-shaped error for the node's range refusal. */
function rangeError(limit: number) {
  const e = new Error(
    `HTTP request failed.\n\nStatus: 413\nURL: https://sepolia.base.org\nDetails: {"jsonrpc":"2.0","id":1,"error":{"code":-32614,"message":"eth_getLogs is limited to a ${limit} range"}}`,
  ) as Error & { status: number };
  e.status = 413;
  return e;
}

function mockRpc(opts: {
  head: bigint;
  usdc?: bigint;
  wei?: bigint;
  cap?: number;
  /** Refuse with no number stated (forces halving). */
  silentCap?: number;
  logs?: Log[];
  failLogs?: boolean;
  failBalances?: boolean;
}) {
  const calls = { getLogs: [] as { from: bigint; to: bigint }[], balance: 0 };
  const client = {
    getBlockNumber: async () => {
      if (opts.failBalances) throw new Error("connect ECONNREFUSED");
      return opts.head;
    },
    readContract: async () => {
      calls.balance += 1;
      if (opts.failBalances) throw new Error("connect ECONNREFUSED");
      return opts.usdc ?? 0n;
    },
    getBalance: async () => {
      if (opts.failBalances) throw new Error("connect ECONNREFUSED");
      return opts.wei ?? 0n;
    },
    getLogs: async (a: { fromBlock: bigint; toBlock: bigint; args: { to: string } }) => {
      calls.getLogs.push({ from: a.fromBlock, to: a.toBlock });
      if (opts.failLogs) throw new Error("upstream timeout");
      const width = Number(a.toBlock - a.fromBlock + 1n);
      if (opts.cap !== undefined && width > opts.cap) throw rangeError(opts.cap);
      if (opts.silentCap !== undefined && width > opts.silentCap) {
        throw new Error("query exceeds max block range");
      }
      return (opts.logs ?? []).filter(
        (l) =>
          l.blockNumber >= a.fromBlock &&
          l.blockNumber <= a.toBlock &&
          l.args.to.toLowerCase() === a.args.to.toLowerCase(),
      );
    },
  };
  return { client, calls };
}

const FROM = "0x1111111111111111111111111111111111111111" as const;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;

describe("eth_getLogs range limits", () => {
  it("recognises the Base Sepolia 413 refusal and its stated limit", () => {
    assert.equal(deposits.logRangeLimitFromError(rangeError(200)), 200n);
    assert.equal(deposits.logRangeLimitFromError(new Error("block range too large")), 0n);
    assert.equal(deposits.logRangeLimitFromError(new Error("connect ECONNREFUSED")), null);
  });

  it("never asks for more than 200 blocks per call by default", async () => {
    const { client, calls } = mockRpc({ head: 50_000n, cap: 200 });
    const vault = "0x2222222222222222222222222222222222222222";
    const r = await deposits.scanTransferLogs({
      client,
      rpc: "mock",
      usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      vault,
      from: 1n,
      to: 1_000n,
      maxCalls: 10,
    });
    assert.equal(r.complete, true);
    assert.equal(r.error, undefined);
    assert.equal(r.through, 1_000n);
    assert.ok(calls.getLogs.every((c) => c.to - c.from + 1n <= 200n));
    assert.equal(calls.getLogs.length, 5);
  });

  it("learns a stricter stated limit and continues from the same block", async () => {
    const { client, calls } = mockRpc({ head: 50_000n, cap: 50 });
    const r = await deposits.scanTransferLogs({
      client,
      rpc: "strict",
      usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      vault: "0x2222222222222222222222222222222222222222",
      from: 1n,
      to: 200n,
      maxCalls: 20,
    });
    assert.equal(r.complete, true);
    assert.equal(r.through, 200n);
    assert.equal(deposits.logRangeFor("strict"), 50n);
    // One refused 200-wide call, then four 50-wide pages.
    assert.equal(calls.getLogs.length, 5);
  });

  it("halves the span when the node refuses without naming a limit", async () => {
    const { client } = mockRpc({ head: 50_000n, silentCap: 30 });
    const r = await deposits.scanTransferLogs({
      client,
      rpc: "silent",
      usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      vault: "0x2222222222222222222222222222222222222222",
      from: 1n,
      to: 100n,
      maxCalls: 50,
    });
    assert.equal(r.complete, true);
    assert.ok(deposits.logRangeFor("silent") <= 30n);
  });

  it("stops at its call budget and reports how far it got", async () => {
    const { client, calls } = mockRpc({ head: 50_000n, cap: 200 });
    const r = await deposits.scanTransferLogs({
      client,
      rpc: "budget",
      usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      vault: "0x2222222222222222222222222222222222222222",
      from: 1n,
      to: 10_000n,
      maxCalls: 3,
    });
    assert.equal(calls.getLogs.length, 3);
    assert.equal(r.complete, false);
    assert.equal(r.through, 600n);
  });
});

describe("readVaultOnchain", () => {
  it("keeps the balance when the log scan fails", async () => {
    const { client } = mockRpc({ head: 1_000n, usdc: 5_000_000n, wei: 10n ** 15n, failLogs: true });
    const snap = await deposits.readVaultOnchain("0x2222222222222222222222222222222222222222", {
      client,
    });
    assert.equal(snap.ok, true);
    assert.equal(snap.error, undefined);
    assert.equal(snap.onchainBalanceMicro, "5000000");
    assert.equal(snap.hasGas, true);
    assert.equal(snap.logsOk, false);
    assert.match(snap.logsError ?? "", /timeout/);
    assert.equal(snap.scannedThrough, null);
  });

  it("balancesOnly makes no log calls", async () => {
    const { client, calls } = mockRpc({ head: 1_000n, usdc: 1n });
    const snap = await deposits.readVaultOnchain("0x2222222222222222222222222222222222222222", {
      client,
      balancesOnly: true,
    });
    assert.equal(snap.ok, true);
    assert.equal(calls.getLogs.length, 0);
  });

  it("reports a balance outage as not ok", async () => {
    const { client } = mockRpc({ head: 1_000n, failBalances: true });
    const snap = await deposits.readVaultOnchain("0x2222222222222222222222222222222222222222", {
      client,
    });
    assert.equal(snap.ok, false);
    assert.ok(snap.error);
  });
});

describe("deposit crediting with a per-vault cursor", () => {
  it("credits a deposit once, then scans only new blocks", async () => {
    const org = store.createOrg("Cursor Co", 0n);
    const vault = store.getVaultAddress(org.id)! as `0x${string}`;
    const head = 20_000n;
    const logs: Log[] = [
      {
        args: { from: FROM, to: vault, value: 1_500_000n },
        transactionHash: hash(1),
        logIndex: 0,
        blockNumber: head - 100n,
      },
    ];
    // Start the cursor just before the deposit so one tick reaches it.
    store.setOnchainScanCursor(org.id, "base-sepolia", vault, head - 500n);
    const rpc = mockRpc({ head, cap: 200, usdc: 1_500_000n, logs });

    const first = await sync.syncOrgOnchainDeposits(org.id, { client: rpc.client, maxLogCalls: 6 });
    assert.equal(first.ok, true);
    assert.equal(first.newly.length, 1);
    assert.equal(Number(first.ledgerAvailableUsdc), 1.5);
    assert.ok(rpc.calls.getLogs.every((c) => c.to - c.from + 1n <= 200n));
    const cursor = store.getOnchainScanCursor(org.id, "base-sepolia", vault)!;
    assert.equal(cursor, head - deposits.CONFIRMATIONS);

    // Next tick: no new blocks → no log calls, no double credit.
    rpc.calls.getLogs.length = 0;
    const second = await sync.syncOrgOnchainDeposits(org.id, { client: rpc.client });
    assert.equal(second.newly.length, 0);
    assert.equal(rpc.calls.getLogs.length, 0);
    assert.equal(Number(second.ledgerAvailableUsdc), 1.5);

    // Recent deposits keep showing credited history even though the scan is empty.
    const { transfers } = sync.decorateOnchainTransfers(second.snap, org.id);
    assert.equal(transfers.length, 1);
    assert.equal(transfers[0]!.status, "credited");
  });

  it("does not advance the cursor past a failed scan", async () => {
    const org = store.createOrg("Retry Co", 0n);
    const vault = store.getVaultAddress(org.id)!;
    store.setOnchainScanCursor(org.id, "base-sepolia", vault, 9_000n);
    const rpc = mockRpc({ head: 10_000n, failLogs: true });
    const r = await sync.syncOrgOnchainDeposits(org.id, { client: rpc.client });
    assert.equal(r.ok, true, "balance still read");
    assert.ok(r.logsError);
    assert.equal(store.getOnchainScanCursor(org.id, "base-sepolia", vault), 9_000n);
  });

  it("catches up a long gap across ticks without missing a deposit", async () => {
    const org = store.createOrg("Catch-up Co", 0n);
    const vault = store.getVaultAddress(org.id)! as `0x${string}`;
    const head = 100_000n;
    const logs: Log[] = [
      {
        args: { from: FROM, to: vault, value: 2_000_000n },
        transactionHash: hash(2),
        logIndex: 3,
        blockNumber: head - 9_000n,
      },
    ];
    const rpc = mockRpc({ head, cap: 200, logs });
    let credited = 0;
    for (let tick = 0; tick < 20; tick++) {
      const r = await sync.syncOrgOnchainDeposits(org.id, { client: rpc.client, maxLogCalls: 4 });
      credited += r.newly.length;
    }
    assert.equal(credited, 1);
    assert.equal(
      store.getOnchainScanCursor(org.id, "base-sepolia", vault),
      head - deposits.CONFIRMATIONS,
    );
  });

  it("the sweep stays inside its subrequest budget", async () => {
    for (let i = 0; i < 12; i++) store.createOrg(`Budget ${i}`, 0n);
    let rpcCalls = 0;
    const rpc = mockRpc({ head: 1_000_000n, cap: 200 });
    const counted = {
      getBlockNumber: async () => (rpcCalls++, rpc.client.getBlockNumber()),
      readContract: async () => (rpcCalls++, rpc.client.readContract()),
      getBalance: async () => (rpcCalls++, rpc.client.getBalance()),
      getLogs: async (a: Parameters<typeof rpc.client.getLogs>[0]) => (
        rpcCalls++,
        rpc.client.getLogs(a)
      ),
    };
    const out = await sync.runOnchainDepositSweep({ force: true, budget: 30, client: counted });
    assert.ok(rpcCalls <= 30, `used ${rpcCalls} RPC calls`);
    assert.ok(out.skipped > 0, "orgs that did not fit wait for the next tick");
  });
});

describe("vault rotation guard", () => {
  it("refuses to rotate when the vault balance cannot be read", async () => {
    // CHAIN_RPC_URL points at a closed port, so the chain read fails.
    const org = store.createOrg("Rotate Guard Co", 0n);
    const before = store.getVaultAddress(org.id);
    const res = await fetch(`${base}/v1/guardian/treasury/recovery/rotate-vault`, {
      method: "POST",
      headers: { authorization: `Bearer ${org.guardianKey}`, "content-type": "application/json" },
      body: JSON.stringify({ acknowledgeFundsAtRisk: true }),
    });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "CHAIN_UNAVAILABLE");
    assert.equal(store.getVaultAddress(org.id), before, "vault unchanged");
  });
});

describe("shared RPC budget for an alarm tick", () => {
  it("stops every chain reader once the tick's allowance is spent", async () => {
    const { runWithRpcBudget, rpcRemaining, isRpcBudgetError } = await import("./rpc-budget.js");
    const rpc = mockRpc({ head: 1_000_000n, cap: 200 });
    let realCalls = 0;
    const counted = {
      getBlockNumber: async () => (realCalls++, rpc.client.getBlockNumber()),
      readContract: async () => (realCalls++, rpc.client.readContract()),
      getBalance: async () => (realCalls++, rpc.client.getBalance()),
      getLogs: async (a: Parameters<typeof rpc.client.getLogs>[0]) => (
        realCalls++,
        rpc.client.getLogs(a)
      ),
    };
    await runWithRpcBudget(10, async () => {
      // Deposit sweep spends what it can, then a balance read is refused.
      await sync.runOnchainDepositSweep({ force: true, budget: 100, client: counted });
      const left = rpcRemaining() ?? 0;
      assert.ok(left < 4);
      const snap = await deposits.readVaultOnchain("0x2222222222222222222222222222222222222222", {
        client: counted,
        balancesOnly: true,
      });
      if (left < 3) {
        assert.equal(snap.ok, false);
        assert.ok(isRpcBudgetError(snap.error));
      } else {
        assert.equal(snap.ok, true);
      }
    });
    assert.ok(realCalls <= 10, `used ${realCalls} calls`);
    // Outside the tick there is no cap.
    assert.equal(rpcRemaining(), null);
  });

  it("the backing sweep defers rather than marking vaults unreadable", async () => {
    const { runWithRpcBudget } = await import("./rpc-budget.js");
    const { runOnchainBackingSweep } = await import("../treasury-backing.js");
    const out = await runWithRpcBudget(0, () => runOnchainBackingSweep());
    assert.equal(out.unreadable, 0);
    assert.ok(out.deferred > 0);
  });
});
