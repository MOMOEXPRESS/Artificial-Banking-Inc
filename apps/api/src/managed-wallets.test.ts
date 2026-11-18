import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
const directory = mkdtempSync(join(tmpdir(), "abi-managed-wallet-"));
Object.assign(process.env, {
  POLICYVAULT_DB: join(directory, "test.db"),
  ABI_NO_LISTEN: "1",
  ABI_RUN_JOBS: "0",
  ABI_CHAT_LLM: "0",
  ABI_KEY_PEPPER: "managed-fixture",
  PRIVY_APP_ID: "managed-fixture-app",
  PRIVY_APP_SECRET: "local-fixture-secret",
});
const { store, commerceDatabase: db } = await import("./store.js");
const { ensureWorkspaces, createWorkspace } = await import("./workspaces.js");
const {
  provisionManagedWallet: provision,
  managedWalletSummary: summary,
  managedWalletStatus: status,
  selectManagedAsset: select,
  managedProvider,
} = await import("./managed-wallets.js");
const { prepareManagedSend: prepare, confirmManagedSend: confirm } =
  await import("./managed-wallet-sends.js");
const { walletAsset, readAssetBalance } = await import("./wallet-assets.js");
import type { ManagedProvider } from "./managed-wallets.js";
after(() => rmSync(directory, { recursive: true, force: true }));
function fixture() {
  const org = store.createOrg("Realistic fixture", 0n),
    user = store.createUser({
      email: `${crypto.randomUUID()}@example.invalid`,
      name: "Owner",
      passwordHash: "unused",
    });
  if ("conflict" in user) throw Error();
  store.addMembership(user.id, org.id, "owner");
  return { org, user, w: ensureWorkspaces(org.id)[0]! };
}
function provider() {
  const wallets = new Map<
      string,
      {
        id: string;
        address: string;
        external_id: string;
        chain_type: "ethereum";
        owner_id: null;
        archived_at: null;
      }
    >(),
    signers = new Map<string, ReturnType<typeof privateKeyToAccount>>();
  let creates = 0,
    lost = false,
    bad = false,
    sends = 0,
    unknown = false;
  const p: ManagedProvider = {
    async get(id) {
      return wallets.get(id) ?? null;
    },
    async create(id, key) {
      assert.match(key, /^[\w-]+$/);
      const account = privateKeyToAccount(generatePrivateKey()),
        wallet = {
          id: `managed_${++creates}_${crypto.randomUUID()}`,
          address: account.address,
          external_id: id,
          chain_type: "ethereum" as const,
          owner_id: null,
          archived_at: null,
        };
      wallets.set(id, wallet);
      signers.set(wallet.id, account);
      if (lost) throw Error("lost response");
      return wallet;
    },
    async prove(id, proof) {
      return (bad ? privateKeyToAccount(generatePrivateKey()) : signers.get(id)!).signTypedData(
        proof,
      );
    },
    async send(_id, chain, tx, key) {
      sends++;
      assert.ok(tx.to);
      assert.ok(key);
      assert.equal(chain, 8453);
      if (unknown) throw Error("uncertain provider response");
      return `0x${"a".repeat(64)}`;
    },
  };
  return {
    p,
    wallets,
    signers,
    get creates() {
      return creates;
    },
    get sends() {
      return sends;
    },
    set lost(v: boolean) {
      lost = v;
    },
    set bad(v: boolean) {
      bad = v;
    },
    set unknown(v: boolean) {
      unknown = v;
    },
  };
}
function client(chain = 8453) {
  return {
    getChainId: async () => chain,
    getBlockNumber: async () => 123n,
    getBalance: async () => 10n ** 18n,
    readContract: async () => 100_000_000n,
    estimateFeesPerGas: async () => ({ maxFeePerGas: 2n, maxPriorityFeePerGas: 1n }),
    estimateGas: async () => 21000n,
  } as unknown as NonNullable<Parameters<typeof prepare>[4]>;
}
test("three password-account workspaces have distinct idempotent app-controlled wallets without social identities", async () => {
  const f = fixture(),
    p = provider(),
    ws = [
      f.w,
      createWorkspace(f.org.id, "Travel", crypto.randomUUID()),
      createWorkspace(f.org.id, "Research", crypto.randomUUID()),
    ];
  const views = [];
  for (const w of ws) {
    views.push(await provision(f.org.id, String(w.id), f.user.id, p.p));
    await provision(f.org.id, String(w.id), f.user.id, p.p);
  }
  assert.equal(p.creates, 3);
  assert.equal(new Set(views.map((v) => v.address)).size, 3);
  assert.ok(views.every((v) => v.receiveEnabled && v.withdrawalEnabled && !v.spendingEnabled));
  assert.equal(
    (
      db()
        .prepare("SELECT COUNT(*) AS n FROM abi_external_identities WHERE user_id=?")
        .get(f.user.id) as { n: number }
    ).n,
    0,
  );
});
test("ambiguous create recovers the same external ID and never duplicates the wallet", async () => {
  const f = fixture(),
    p = provider();
  p.lost = true;
  const a = await provision(f.org.id, String(f.w.id), f.user.id, p.p);
  assert.equal(a.status, "ready");
  assert.equal(p.creates, 1);
  assert.equal((await provision(f.org.id, String(f.w.id), f.user.id, p.p)).address, a.address);
});
test("wrong signature stays unavailable, owner/app mismatches never silently replace addresses", async () => {
  const f = fixture(),
    p = provider();
  p.bad = true;
  await assert.rejects(
    provision(f.org.id, String(f.w.id), f.user.id, p.p),
    /control could not be verified/,
  );
  assert.equal(summary(f.org.id, String(f.w.id)).address, null);
  p.bad = false;
  const ready = await provision(f.org.id, String(f.w.id), f.user.id, p.p);
  const other = fixture();
  await assert.rejects(
    provision(f.org.id, String(f.w.id), other.user.id, p.p),
    /Only an account owner/,
  );
  process.env.PRIVY_APP_ID = "another-app";
  assert.throws(() => summary(f.org.id, String(f.w.id)), /original Privy/);
  process.env.PRIVY_APP_ID = "managed-fixture-app";
  assert.equal(summary(f.org.id, String(f.w.id)).address, ready.address);
});
test("asset selection persists while balances stay chain/address-specific and unreadable is never zero", async () => {
  const f = fixture(),
    p = provider();
  await provision(f.org.id, String(f.w.id), f.user.id, p.p);
  select(f.org.id, String(f.w.id), f.user.id, "ethereum:eth");
  assert.equal(summary(f.org.id, String(f.w.id)).asset.chainId, 1);
  const unavailable = await status(f.org.id, String(f.w.id), f.user.id, async () => {
    throw Error("private RPC detail");
  });
  assert.equal(unavailable.balance.status, "unavailable");
  assert.equal(unavailable.balance.amount, null);
  const value = await readAssetBalance(
    unavailable.address! as `0x${string}`,
    walletAsset("base:usdc"),
    client()!,
  );
  assert.equal(value.amount, "100");
  await assert.rejects(
    readAssetBalance(unavailable.address! as `0x${string}`, walletAsset("ethereum:eth"), client()!),
    /network verification/,
  );
});
test("review is immutable, confirmation is idempotent and another send stays locked pending finality", async () => {
  const f = fixture(),
    p = provider();
  await provision(f.org.id, String(f.w.id), f.user.id, p.p);
  const a = await prepare(
    f.org.id,
    String(f.w.id),
    f.user.id,
    { assetId: "base:usdc", amount: "1", recipient: "0x2222222222222222222222222222222222222222" },
    client(),
  );
  const b = await confirm(f.org.id, String(f.w.id), f.user.id, a.id, p.p);
  assert.equal(b.state, "submitted");
  await confirm(f.org.id, String(f.w.id), f.user.id, a.id, p.p);
  assert.equal(p.sends, 1);
  const next = await prepare(
    f.org.id,
    String(f.w.id),
    f.user.id,
    { assetId: "base:usdc", amount: "1", recipient: a.recipient },
    client(),
  );
  await assert.rejects(
    confirm(f.org.id, String(f.w.id), f.user.id, next.id, p.p),
    /Another transfer/,
  );
  assert.equal(p.sends, 1);
});
test("a failed provider response locks an unknown outcome, never retries or claims success", async () => {
  const f = fixture(),
    p = provider();
  await provision(f.org.id, String(f.w.id), f.user.id, p.p);
  const a = await prepare(
    f.org.id,
    String(f.w.id),
    f.user.id,
    { assetId: "base:usdc", amount: "1", recipient: "0x2222222222222222222222222222222222222222" },
    client(),
  );
  p.unknown = true;
  await assert.rejects(
    confirm(f.org.id, String(f.w.id), f.user.id, a.id, p.p),
    /Do not send again/,
  );
  assert.equal((await confirm(f.org.id, String(f.w.id), f.user.id, a.id, p.p)).state, "unknown");
  assert.equal(p.sends, 1);
});
test("rechecks org freeze at confirmation, denies precision errors and amounts needing guardian review", async () => {
  const f = fixture(),
    p = provider();
  await provision(f.org.id, String(f.w.id), f.user.id, p.p);
  const input = {
    assetId: "base:usdc",
    amount: "1",
    recipient: "0x2222222222222222222222222222222222222222",
  };
  await assert.rejects(
    prepare(f.org.id, String(f.w.id), f.user.id, { ...input, amount: "1.0000001" }, client()),
    /at most 6/,
  );
  await assert.rejects(
    prepare(f.org.id, String(f.w.id), f.user.id, { ...input, amount: "51" }, client()),
    /guardian review/,
  );
  const a = await prepare(f.org.id, String(f.w.id), f.user.id, input, client());
  store.setOrgStatus(f.org.id, "frozen");
  await assert.rejects(confirm(f.org.id, String(f.w.id), f.user.id, a.id, p.p), /frozen/);
  assert.equal(p.sends, 0);
});
test("SDK creates an application wallet with Workers manual transport and no social owner or JWT", async () => {
  const original = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.redirect, "manual");
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "created" });
  };
  try {
    await managedProvider().create("stable-external", crypto.randomUUID());
    assert.equal(requests[0].owner, undefined);
    assert.equal(requests[0].chain_type, "ethereum");
    assert.equal(requests[0].external_id, "stable-external");
  } finally {
    globalThis.fetch = original;
  }
});

test("adopts an existing application-controlled trial address instead of replacing its keys", async () => {
  const { createHash } = await import("node:crypto");
  const f = fixture(),
    p = provider(),
    externalId = "existing-trial-" + crypto.randomUUID(),
    request = crypto.randomUUID();
  const w = (await p.p.create(externalId, request)) as { id: string; address: string };
  db()
    .prepare(
      "INSERT INTO abi_privy_test_wallets(workspace_id,org_id,app_hash,external_id,request_key,wallet_id,address,created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(
      f.w.id,
      f.org.id,
      createHash("sha256").update(process.env.PRIVY_APP_ID!).digest("hex"),
      externalId,
      request,
      w.id,
      w.address,
      new Date().toISOString(),
    );
  const view = await provision(f.org.id, String(f.w.id), f.user.id, p.p);
  assert.equal(view.address, w.address);
  assert.equal(view.providerWalletId, w.id);
  assert.equal(p.creates, 1);
});
test("a failed refresh invalidates a cached balance across Overview and Wallet", async () => {
  const f = fixture(),
    p = provider();
  await provision(f.org.id, String(f.w.id), f.user.id, p.p);
  await status(f.org.id, String(f.w.id), f.user.id, async () => ({
    amount: "12",
    units: "12000000",
    gasEth: "0.01",
    block: "10",
    observedAt: "2000-01-01T00:00:00.000Z",
    status: "available",
  }));
  await status(f.org.id, String(f.w.id), f.user.id, async () => {
    throw Error("RPC unavailable");
  });
  assert.equal(summary(f.org.id, String(f.w.id)).balance.status, "unavailable");
});

test("background rollout provisions only the account treasury by default, without creating accounts", async () => {
  const { backfillManagedWallets } = await import("./managed-wallets.js");
  db().prepare("UPDATE users SET email_verified_at=NULL").run();
  const f = fixture(),
    p = provider();
  createWorkspace(f.org.id, "Travel", crypto.randomUUID());
  createWorkspace(f.org.id, "Operations", crypto.randomUUID());
  db()
    .prepare("UPDATE users SET email_verified_at=? WHERE id=?")
    .run(new Date().toISOString(), f.user.id);
  const count = (db().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  for (let n = 0; n < 3; n++)
    await backfillManagedWallets((org, w, user) => provision(org, w, user, p.p));
  assert.equal(p.creates, 1);
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, count);
});

test("legacy trial clients reuse a managed workspace wallet instead of creating another address", async () => {
  const f = fixture(),
    p = provider();
  const view = await provision(f.org.id, String(f.w.id), f.user.id, p.p);
  const { provisionPrivyTrial } = await import("./privy-trial.js");
  const legacy = await provisionPrivyTrial(f.org.id, String(f.w.id), async () => {
    throw Error("A second provider request must not occur");
  });
  assert.equal(legacy.wallet?.address, view.address);
  assert.equal(legacy.wallet?.providerWalletId, view.providerWalletId);
  assert.equal(p.creates, 1);
});

test("asset accounts are distinct, durable across networks, preserve the original USDC address and fail closed before ETH setup", async () => {
  const f = fixture(),
    p = provider(),
    id = String(f.w.id);
  const usdc = await provision(f.org.id, id, f.user.id, p.p);
  select(f.org.id, id, f.user.id, "base:eth");
  assert.equal(summary(f.org.id, id).address, null);
  assert.equal(summary(f.org.id, id).receiveEnabled, false);
  const eth = await provision(f.org.id, id, f.user.id, p.p);
  assert.notEqual(eth.address, usdc.address);
  assert.equal(eth.accountSymbol, "ETH");
  assert.equal(p.creates, 2);
  for (const assetId of ["ethereum:eth", "base-sepolia:eth", "base:eth"]) {
    select(f.org.id, id, f.user.id, assetId);
    assert.equal((await provision(f.org.id, id, f.user.id, p.p)).address, eth.address);
  }
  select(f.org.id, id, f.user.id, "ethereum:usdc");
  assert.equal(summary(f.org.id, id).address, usdc.address);
  assert.equal(p.creates, 2);
  assert.equal(
    summary(f.org.id, id, { assetId: "base:eth", sourceAccount: "USDC" }).address,
    usdc.address,
  );
  const other = fixture();
  assert.throws(() => select(other.org.id, id, other.user.id, "base:eth"), /workspace|Workspace/);
});

test("ETH provisioning recovers response loss and rejects a provider reusing the USDC wallet", async () => {
  const f = fixture(),
    p = provider(),
    id = String(f.w.id);
  const usdc = await provision(f.org.id, id, f.user.id, p.p);
  select(f.org.id, id, f.user.id, "base:eth");
  const alias: ManagedProvider = {
    ...p.p,
    get: async () => null,
    create: async (external) => ({
      id: usdc.providerWalletId,
      address: usdc.address,
      external_id: external,
      chain_type: "ethereum",
      owner_id: null,
    }),
  };
  await assert.rejects(provision(f.org.id, id, f.user.id, alias), /own wallet address/);
  assert.equal(summary(f.org.id, id).address, null);
  p.lost = true;
  const eth = await provision(f.org.id, id, f.user.id, p.p);
  assert.notEqual(eth.address, usdc.address);
  assert.equal(p.creates, 2);
  assert.equal((await provision(f.org.id, id, f.user.id, p.p)).address, eth.address);
});

test("native sends and workspace allocation resolve the asset account independently of the displayed asset", async () => {
  const f = fixture(),
    p = provider(),
    id = String(f.w.id);
  const usdc = await provision(f.org.id, id, f.user.id, p.p);
  const eth = await provision(f.org.id, id, f.user.id, p.p, { assetId: "base:eth" });
  const target = createWorkspace(f.org.id, "ETH destination", crypto.randomUUID());
  await provision(f.org.id, String(target.id), f.user.id, p.p);
  const destination = await provision(f.org.id, String(target.id), f.user.id, p.p, {
    assetId: "base:eth",
  });
  const review = await prepare(
    f.org.id,
    id,
    f.user.id,
    { assetId: "base:eth", amount: "0.01", toWorkspaceId: String(target.id) },
    client(),
  );
  assert.equal(review.source, eth.address);
  assert.equal(review.recipient, destination.address);
  assert.notEqual(review.source, usdc.address);
  let sentWallet = "";
  const signing: ManagedProvider = {
    ...p.p,
    send: async (wallet, ...args) => {
      sentWallet = wallet;
      return p.p.send(wallet, ...args);
    },
  };
  await confirm(f.org.id, id, f.user.id, review.id, signing);
  assert.equal(sentWallet, eth.providerWalletId);
});

test("owner recovery can spend historical ETH at the original USDC account without changing normal ETH routing", async () => {
  const f = fixture(),
    p = provider(),
    id = String(f.w.id);
  const old = await provision(f.org.id, id, f.user.id, p.p);
  const eth = await provision(f.org.id, id, f.user.id, p.p, { assetId: "base:eth" });
  const review = await prepare(
    f.org.id,
    id,
    f.user.id,
    { assetId: "base:eth", sourceAccount: "USDC", amount: "0.01", recipient: eth.address! },
    client(),
  );
  assert.equal(review.source, old.address);
  let wallet = "";
  await confirm(f.org.id, id, f.user.id, review.id, {
    ...p.p,
    send: async (id, ...args) => {
      wallet = id;
      return p.p.send(id, ...args);
    },
  });
  assert.equal(wallet, old.providerWalletId);
  assert.equal(summary(f.org.id, id, { assetId: "base:eth" }).address, eth.address);
  const stranger = fixture();
  await assert.rejects(
    prepare(
      f.org.id,
      id,
      stranger.user.id,
      { assetId: "base:eth", sourceAccount: "USDC", amount: "0.01", recipient: eth.address! },
      client(),
    ),
    /Only an account owner/,
  );
});

test("balance reads and caches are bound to the selected asset address, including historical recovery", async () => {
  const f = fixture(),
    p = provider(),
    id = String(f.w.id);
  const usdc = await provision(f.org.id, id, f.user.id, p.p);
  const eth = await provision(f.org.id, id, f.user.id, p.p, { assetId: "base:eth" });
  const reader: Parameters<typeof status>[3] = async (address) => ({
    amount: address === eth.address ? "2" : "20",
    units: "0",
    gasEth: "0.01",
    block: "500",
    observedAt: new Date().toISOString(),
    status: "available",
  });
  const recovery = await status(f.org.id, id, f.user.id, reader, {
    assetId: "base:eth",
    sourceAccount: "USDC",
  });
  assert.equal(recovery.address, usdc.address);
  assert.equal(recovery.balance.amount, "20");
  const regular = await status(f.org.id, id, f.user.id, reader, { assetId: "base:eth" });
  assert.equal(regular.address, eth.address);
  assert.equal(regular.balance.amount, "2");
  const recoveryAgain = await status(f.org.id, id, f.user.id, reader, {
    assetId: "base:eth",
    sourceAccount: "USDC",
  });
  assert.equal(recoveryAgain.balance.amount, "20");
  assert.equal(summary(f.org.id, id).selectedAssetId, "base:usdc");
});

test("account allocations reserve confirmed USDC once, preserve addresses and prevent treasury double spending", async () => {
  const { allocateAccountTreasury, accountTreasuryView, assertTreasurySendCapacity } =
    await import("./account-treasury.js");
  const { setCard } = await import("./workspaces.js");
  const f = fixture(),
    p = provider(),
    w = createWorkspace(f.org.id, "Allocated", crypto.randomUUID());
  await provision(f.org.id, String(f.w.id), f.user.id, p.p);
  const address = summary(f.org.id, String(f.w.id)).address;
  const key = crypto.randomUUID(),
    input = {
      workspaceId: w.id,
      assetId: "base:usdc",
      amountUsdc: "60",
      direction: "allocate" as const,
      idempotencyKey: key,
    };
  await allocateAccountTreasury(f.org.id, f.user.id, input, client());
  await allocateAccountTreasury(f.org.id, f.user.id, input, client());
  let view = await accountTreasuryView(f.org.id, f.user.id, "base:usdc", client());
  assert.equal(view.allocatedUsdc, "60");
  assert.equal(view.unallocatedUsdc, "40");
  assert.equal(summary(f.org.id, String(f.w.id)).address, address);
  assert.equal(p.sends, 0);
  assert.throws(
    () =>
      assertTreasurySendCapacity(f.org.id, String(f.w.id), "base:usdc", 41_000_000n, 100_000_000n),
    /allocated/,
  );
  await assert.rejects(
    () =>
      allocateAccountTreasury(
        f.org.id,
        f.user.id,
        { ...input, amountUsdc: "41", idempotencyKey: crypto.randomUUID() },
        client(),
      ),
    /Not enough/,
  );
  await assert.rejects(
    () => allocateAccountTreasury(f.org.id, f.user.id, { ...input, amountUsdc: "61" }, client()),
    /different details/,
  );
  await allocateAccountTreasury(
    f.org.id,
    f.user.id,
    { ...input, direction: "return", amountUsdc: "10", idempotencyKey: crypto.randomUUID() },
    client(),
  );
  view = await accountTreasuryView(f.org.id, f.user.id, "base:usdc", client());
  assert.equal(view.allocatedUsdc, "50");
  assert.equal(view.unallocatedUsdc, "50");
  const lower = { ...client(), readContract: async () => 49_000_000n };
  assert.equal(
    (await accountTreasuryView(f.org.id, f.user.id, "base:usdc", lower)).reconciliationRequired,
    true,
  );
  await assert.rejects(
    () =>
      allocateAccountTreasury(
        f.org.id,
        f.user.id,
        { ...input, amountUsdc: "1", idempotencyKey: crypto.randomUUID() },
        lower,
      ),
    /reconciliation/,
  );
  setCard(f.org.id, w.id, { status: "frozen" });
  await assert.rejects(
    () =>
      allocateAccountTreasury(
        f.org.id,
        f.user.id,
        { ...input, amountUsdc: "1", idempotencyKey: crypto.randomUUID() },
        client(),
      ),
    /Unfreeze/,
  );
});
test("treasury allocation rejects pending transfers and uses the lower of confirmed and latest balances", async () => {
  const { allocateAccountTreasury, accountTreasuryView } = await import("./account-treasury.js");
  const f = fixture(),
    p = provider(),
    w = createWorkspace(f.org.id, "Pending", crypto.randomUUID());
  await provision(f.org.id, String(f.w.id), f.user.id, p.p);
  const rpc = {
    ...client(),
    readContract: async (a: { blockNumber?: bigint }) =>
      a.blockNumber === 120n ? 100_000_000n : 20_000_000n,
  };
  assert.equal(
    (await accountTreasuryView(f.org.id, f.user.id, "base:usdc", rpc)).unallocatedUsdc,
    "20",
  );
  await prepare(
    f.org.id,
    String(f.w.id),
    f.user.id,
    { assetId: "base:usdc", amount: "1", recipient: "0x1111111111111111111111111111111111111111" },
    client(),
  );
  await assert.rejects(
    () =>
      allocateAccountTreasury(
        f.org.id,
        f.user.id,
        {
          workspaceId: w.id,
          assetId: "base:usdc",
          amountUsdc: "1",
          direction: "allocate",
          idempotencyKey: crypto.randomUUID(),
        },
        client(),
      ),
    /prepared transfer/,
  );
});

test("parallel account allocations cannot over-assign the same chain balance and duplicate logs never duplicate history", async () => {
  const { allocateAccountTreasury, accountTreasuryView } = await import("./account-treasury.js");
  const f = fixture(),
    p = provider(),
    a = createWorkspace(f.org.id, "A", crypto.randomUUID()),
    b = createWorkspace(f.org.id, "B", crypto.randomUUID());
  await provision(f.org.id, String(f.w.id), f.user.id, p.p);
  const address = summary(f.org.id, String(f.w.id)).address!;
  const rpc = {
    ...client(),
    getLogs: async () => [
      {
        transactionHash: `0x${"a".repeat(64)}` as `0x${string}`,
        logIndex: 0,
        blockNumber: 100n,
        args: {
          from: "0x1111111111111111111111111111111111111111" as const,
          to: address as `0x${string}`,
          value: 100_000_000n,
        },
      },
    ],
  };
  const attempts = await Promise.allSettled(
    [a, b].map((w) =>
      allocateAccountTreasury(
        f.org.id,
        f.user.id,
        {
          workspaceId: w.id,
          assetId: "base:usdc",
          amountUsdc: "60",
          direction: "allocate",
          idempotencyKey: crypto.randomUUID(),
        },
        rpc,
      ),
    ),
  );
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  let view = await accountTreasuryView(f.org.id, f.user.id, "base:usdc", rpc);
  assert.equal(view.allocatedUsdc, "60");
  assert.equal(view.activity.length, 1);
  assert.equal(view.activity[0]?.direction, "deposit");
  view = await accountTreasuryView(f.org.id, f.user.id, "base:usdc", rpc);
  assert.equal(view.activity.length, 1);
  assert.equal(view.confirmedUsdc, "100");
});
test("review preparation cannot spend treasury USDC already allocated to a workspace", async () => {
  const { allocateAccountTreasury } = await import("./account-treasury.js");
  const f = fixture(),
    p = provider(),
    w = createWorkspace(f.org.id, "Protected", crypto.randomUUID());
  await provision(f.org.id, String(f.w.id), f.user.id, p.p);
  await allocateAccountTreasury(
    f.org.id,
    f.user.id,
    {
      workspaceId: w.id,
      assetId: "base:usdc",
      amountUsdc: "99",
      direction: "allocate",
      idempotencyKey: crypto.randomUUID(),
    },
    client(),
  );
  await assert.rejects(
    () =>
      prepare(
        f.org.id,
        String(f.w.id),
        f.user.id,
        {
          assetId: "base:usdc",
          amount: "2",
          recipient: "0x1111111111111111111111111111111111111111",
        },
        client(),
      ),
    /allocated/,
  );
  assert.equal(p.sends, 0);
});
