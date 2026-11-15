/** ABI-managed Privy wallets. No social identity, client secret or private key in the browser. */
import { createHash, randomUUID } from "node:crypto";
import { PrivyClient, NotFoundError, APIError } from "@privy-io/node";
import { z } from "zod";
import { verifyTypedData, type Address, type Hex } from "viem";
import { commerceDatabase } from "./store.js";
import { findWorkspace, WorkspaceError } from "./workspaces.js";
import { privyFetch } from "./privy-transport.js";
import { WALLET_ASSETS, walletAsset, readAssetBalance, walletExplorer } from "./wallet-assets.js";
export class ManagedWalletError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 503,
  ) {
    super(message);
  }
}
type Row = {
  workspace_id: string;
  org_id: string;
  app_hash: string;
  external_id: string;
  request_key: string;
  wallet_id: string | null;
  address: string | null;
  verified_at: string | null;
  selected_asset_id: string;
};
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const db = () => commerceDatabase();
function config() {
  const appId = process.env.PRIVY_APP_ID?.trim(),
    appSecret = process.env.PRIVY_APP_SECRET?.trim();
  if (!appId || !appSecret)
    throw new ManagedWalletError(
      "PRIVY_NOT_CONFIGURED",
      "Wallet provider is not configured. Contact ABI support.",
    );
  return { appId, appSecret };
}
export function assertManagedWalletOwner(orgId: string, workspaceId: string, userId: string) {
  findWorkspace(orgId, workspaceId);
  if (
    !db()
      .prepare(
        "SELECT 1 FROM memberships WHERE org_id=? AND user_id=? AND role='owner' AND revoked_at IS NULL",
      )
      .get(orgId, userId)
  )
    throw new ManagedWalletError(
      "WALLET_FORBIDDEN",
      "Only an account owner can manage this wallet.",
      403,
    );
}
export type WalletAccount = "USDC" | "ETH";
type WalletViewOptions = { assetId?: string; sourceAccount?: WalletAccount };
function walletStorage(workspaceId: string, symbol: WalletAccount) {
  return symbol === "USDC"
    ? { table: "abi_managed_wallets", where: "workspace_id=?", params: [workspaceId] }
    : {
        table: "abi_managed_asset_wallets",
        where: "workspace_id=? AND symbol=?",
        params: [workspaceId, symbol],
      };
}
function binding(orgId: string, workspaceId: string, symbol: WalletAccount = "USDC") {
  const storage = walletStorage(workspaceId, symbol);
  const r = db()
    .prepare(`SELECT * FROM ${storage.table} WHERE ${storage.where} AND org_id=?`)
    .get(...storage.params, orgId) as Row | undefined;
  if (r && r.app_hash !== hash(config().appId))
    throw new ManagedWalletError(
      "PRIVY_APP_CHANGED",
      "Restore this wallet’s original Privy application. Its address cannot be replaced.",
      409,
    );
  return r;
}
export function managedProvider() {
  const deadline = AbortSignal.timeout(12000);
  const client = new PrivyClient({
    ...config(),
    timeout: 6000,
    maxRetries: 0,
    authorizationKeyCacheMaxCapacity: 1,
    fetch: (input, init) =>
      privyFetch(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline,
      }),
  });
  return {
    async get(externalId: string): Promise<unknown | null> {
      try {
        return await client.wallets().get(`ext_wal_${externalId}`);
      } catch (e) {
        if (e instanceof NotFoundError) return null;
        throw e;
      }
    },
    async create(
      externalId: string,
      key: string,
      symbol: WalletAccount = "USDC",
    ): Promise<unknown> {
      return client.wallets().create({
        chain_type: "ethereum",
        external_id: externalId,
        display_name: `ABI ${symbol} workspace wallet`,
        idempotency_key: key,
      });
    },
    async prove(walletId: string, proof: ReturnType<typeof connectionProof>): Promise<Hex> {
      const { primaryType, ...rest } = proof;
      const s = await client
        .wallets()
        .ethereum()
        .signTypedData(walletId, {
          params: { typed_data: { ...rest, primary_type: primaryType } },
          caip2: "eip155:8453",
          idempotency_key: randomUUID(),
        });
      return s.signature as Hex;
    },
    async send(
      walletId: string,
      chainId: number,
      transaction: { to: Address; value: Hex; data?: Hex },
      key: string,
    ): Promise<Hex> {
      const s = await client
        .wallets()
        .ethereum()
        .sendTransaction(walletId, {
          caip2: `eip155:${chainId}`,
          params: { transaction },
          idempotency_key: key,
          reference_id: key,
        });
      if (!/^0x[\da-fA-F]{64}$/.test(s.hash) || s.caip2 !== `eip155:${chainId}`)
        throw Error("Provider returned an invalid transaction receipt.");
      return s.hash as Hex;
    },
  };
}
export type ManagedProvider = ReturnType<typeof managedProvider>;
function connectionProof(workspaceId: string, address: Address) {
  return {
    domain: { name: "ABI managed wallet connection", version: "1", chainId: 8453 },
    primaryType: "ABIConnectionProof" as const,
    types: {
      ABIConnectionProof: [
        { name: "workspaceId", type: "string" },
        { name: "wallet", type: "address" },
        { name: "challenge", type: "string" },
        { name: "expiresAt", type: "uint256" },
      ],
    },
    message: {
      workspaceId,
      wallet: address,
      challenge: randomUUID(),
      expiresAt: Math.floor(Date.now() / 1000) + 120,
    },
  };
}
const providerWallet = z.object({
  id: z.string().regex(/^[\w-]{1,128}$/),
  address: z.string().regex(/^0x[\da-fA-F]{40}$/),
  chain_type: z.literal("ethereum"),
  external_id: z.string(),
  owner_id: z.null().optional(),
  archived_at: z.null().optional(),
});
export function managedWalletSummary(
  orgId: string,
  workspaceId: string,
  options: WalletViewOptions = {},
) {
  findWorkspace(orgId, workspaceId);
  const selection = binding(orgId, workspaceId);
  const asset = walletAsset(options.assetId ?? selection?.selected_asset_id ?? "base:usdc");
  const account = options.sourceAccount ?? asset.symbol;
  const row = binding(orgId, workspaceId, account);
  const balance = row?.address
    ? (db()
        .prepare(
          "SELECT amount,observed_at AS observedAt,block,gas_eth AS gasEth FROM abi_managed_balances WHERE workspace_id=? AND asset_id=? AND lower(address)=lower(?)",
        )
        .get(workspaceId, asset.id, row.address) as
        { amount: string; observedAt: string; block: string; gasEth: string } | undefined)
    : undefined;
  return {
    provider: "privy" as const,
    control: "abi-managed" as const,
    workspaceId,
    status: row?.verified_at ? ("ready" as const) : ("setup_pending" as const),
    address: row?.verified_at ? row.address : null,
    providerWalletId: row?.wallet_id ?? null,
    verifiedAt: row?.verified_at ?? null,
    receiveEnabled: !!row?.verified_at,
    withdrawalEnabled: !!row?.verified_at,
    spendingEnabled: false,
    accountSymbol: account,
    selectedAssetId: asset.id,
    asset,
    assets: WALLET_ASSETS,
    balance: balance
      ? {
          ...balance,
          status: "available" as const,
          stale: Date.now() - Date.parse(balance.observedAt) > 60000,
        }
      : { status: "unavailable" as const, amount: null, observedAt: null },
    explorerAddress: row?.verified_at ? `${walletExplorer(asset)}/address/${row.address}` : null,
  };
}
export async function provisionManagedWallet(
  orgId: string,
  workspaceId: string,
  userId: string,
  provider?: ManagedProvider,
  options: WalletViewOptions = {},
) {
  assertManagedWalletOwner(orgId, workspaceId, userId);
  const { appId } = config(),
    appHash = hash(appId);
  const old = db()
    .prepare("SELECT * FROM abi_privy_test_wallets WHERE workspace_id=? AND org_id=?")
    .get(workspaceId, orgId) as Row | undefined;
  if (old && old.app_hash !== appHash)
    throw new ManagedWalletError(
      "PRIVY_APP_CHANGED",
      "Restore the application originally used for this workspace wallet.",
      409,
    );
  const externalId =
    old?.external_id ?? `abi_workspace_${hash(`${appId}|${orgId}|${workspaceId}`).slice(0, 48)}`;
  db()
    .prepare(
      "INSERT OR IGNORE INTO abi_managed_wallets(workspace_id,org_id,app_hash,external_id,request_key,wallet_id,address,created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(
      workspaceId,
      orgId,
      appHash,
      externalId,
      old?.request_key ?? randomUUID(),
      old?.wallet_id ?? null,
      old?.address ?? null,
      new Date().toISOString(),
    );
  const asset = walletAsset(
    options.assetId ?? binding(orgId, workspaceId)?.selected_asset_id ?? "base:usdc",
  );
  const symbol = options.sourceAccount ?? asset.symbol;
  if (symbol !== "USDC") {
    const external = `abi_asset_${hash(`${appId}|${orgId}|${workspaceId}|${symbol}`).slice(0, 48)}`;
    db()
      .prepare(
        "INSERT OR IGNORE INTO abi_managed_asset_wallets(workspace_id,org_id,symbol,app_hash,external_id,request_key,created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(workspaceId, orgId, symbol, appHash, external, randomUUID(), new Date().toISOString());
  }
  const storage = walletStorage(workspaceId, symbol);
  const row = binding(orgId, workspaceId, symbol)!;
  if (row.verified_at) return managedWalletSummary(orgId, workspaceId, options);
  const p = provider ?? managedProvider();
  try {
    let raw = await p.get(row.external_id);
    if (raw === null) {
      if (row.wallet_id)
        throw new ManagedWalletError(
          "PRIVY_WALLET_MISSING",
          "The existing wallet is unavailable. Restore it in Privy; ABI will not replace its address.",
          409,
        );
      try {
        raw = await p.create(row.external_id, row.request_key, symbol);
      } catch (e) {
        raw = await p.get(row.external_id);
        if (raw === null) throw e;
      }
    }
    const wallet = providerWallet.parse(raw);
    if (
      wallet.external_id !== row.external_id ||
      (row.wallet_id &&
        (row.wallet_id !== wallet.id ||
          row.address?.toLowerCase() !== wallet.address.toLowerCase()))
    )
      throw new ManagedWalletError(
        "PRIVY_WALLET_MISMATCH",
        "The provider wallet does not match this workspace. No address was replaced.",
        409,
      );
    const saved = db().transaction(() => {
      // Unique constraints cover each table; also prohibit reuse across the primary and asset tables.
      const other = symbol === "USDC" ? "abi_managed_asset_wallets" : "abi_managed_wallets";
      if (
        db()
          .prepare(`SELECT 1 FROM ${other} WHERE wallet_id=? OR lower(address)=lower(?)`)
          .get(wallet.id, wallet.address)
      )
        throw new ManagedWalletError(
          "PRIVY_WALLET_MISMATCH",
          "Each asset must have its own wallet address. No address was replaced.",
          409,
        );
      return db()
        .prepare(
          `UPDATE ${storage.table} SET wallet_id=?,address=? WHERE ${storage.where} AND (wallet_id IS NULL OR (wallet_id=? AND lower(address)=lower(?)))`,
        )
        .run(wallet.id, wallet.address, ...storage.params, wallet.id, wallet.address);
    })();
    if (!saved.changes)
      throw new ManagedWalletError(
        "PRIVY_WALLET_MISMATCH",
        "The workspace wallet changed. Refresh and contact support.",
        409,
      );
    const proof = connectionProof(workspaceId, wallet.address as Address),
      signature = await p.prove(wallet.id, proof);
    if (!(await verifyTypedData({ ...proof, address: wallet.address as Address, signature })))
      throw new ManagedWalletError(
        "PRIVY_PROOF_FAILED",
        "Wallet control could not be verified. Retry this workspace.",
      );
    db()
      .prepare(`UPDATE ${storage.table} SET verified_at=? WHERE ${storage.where} AND wallet_id=?`)
      .run(new Date().toISOString(), ...storage.params, wallet.id);
    return managedWalletSummary(orgId, workspaceId, options);
  } catch (e) {
    if (e instanceof ManagedWalletError) throw e;
    if (e instanceof APIError && (e.status === 401 || e.status === 403))
      throw new ManagedWalletError(
        "PRIVY_AUTH_FAILED",
        "Privy rejected this application’s wallet credentials or permissions. Contact ABI support.",
      );
    if (e instanceof APIError && e.status === 400)
      throw new ManagedWalletError(
        "PRIVY_REQUEST_REJECTED",
        "Privy rejected the wallet configuration. Contact ABI support; no address was replaced.",
      );
    throw new ManagedWalletError(
      "PRIVY_UNAVAILABLE",
      "Wallet setup could not finish. Retry this workspace; its address will be preserved.",
    );
  }
}
export async function managedWalletStatus(
  orgId: string,
  workspaceId: string,
  userId: string,
  reader = readAssetBalance,
  options: WalletViewOptions = {},
) {
  assertManagedWalletOwner(orgId, workspaceId, userId);
  const view = managedWalletSummary(orgId, workspaceId, options);
  if (!view.address) return view;
  if (
    view.balance.status === "available" &&
    Date.now() - Date.parse(view.balance.observedAt!) < 20000
  )
    return view;
  try {
    const balance = await reader(view.address as Address, view.asset);
    db()
      .prepare(
        "INSERT INTO abi_managed_balances(workspace_id,asset_id,address,amount,observed_at,block,gas_eth) VALUES (?,?,?,?,?,?,?) ON CONFLICT(workspace_id,asset_id) DO UPDATE SET address=excluded.address,amount=excluded.amount,observed_at=excluded.observed_at,block=excluded.block,gas_eth=excluded.gas_eth",
      )
      .run(
        workspaceId,
        view.asset.id,
        view.address,
        balance.amount,
        balance.observedAt,
        balance.block,
        balance.gasEth,
      );
    return managedWalletSummary(orgId, workspaceId, options);
  } catch {
    db()
      .prepare(
        "DELETE FROM abi_managed_balances WHERE workspace_id=? AND asset_id=? AND lower(address)=lower(?)",
      )
      .run(workspaceId, view.asset.id, view.address);
    return {
      ...view,
      balance: { status: "unavailable" as const, amount: null, observedAt: null },
      balanceError: "On-chain balance could not be refreshed. Retry; no zero balance is assumed.",
    };
  }
}
export function selectManagedAsset(
  orgId: string,
  workspaceId: string,
  userId: string,
  assetId: string,
) {
  assertManagedWalletOwner(orgId, workspaceId, userId);
  walletAsset(assetId);
  if (!binding(orgId, workspaceId))
    throw new ManagedWalletError("WALLET_NOT_READY", "Set up this workspace wallet first.", 409);
  db()
    .prepare("UPDATE abi_managed_wallets SET selected_asset_id=? WHERE workspace_id=? AND org_id=?")
    .run(assetId, workspaceId, orgId);
  return managedWalletSummary(orgId, workspaceId);
}
export function readyManagedWallet(
  orgId: string,
  workspaceId: string,
  userId: string,
  requireActive = true,
  assetId?: string,
  sourceAccount?: WalletAccount,
) {
  assertManagedWalletOwner(orgId, workspaceId, userId);
  const asset = walletAsset(
    assetId ?? binding(orgId, workspaceId)?.selected_asset_id ?? "base:usdc",
  );
  const row = binding(orgId, workspaceId, sourceAccount ?? asset.symbol);
  if (!row?.verified_at || !row.address || !row.wallet_id)
    throw new ManagedWalletError("WALLET_NOT_READY", "Set up and verify this wallet first.", 409);
  if (requireActive && findWorkspace(orgId, workspaceId).card_status !== "active")
    throw new WorkspaceError(
      "CARD_FROZEN",
      "Unfreeze this workspace card before sending funds.",
      409,
    );
  return row as Row & { address: Address; wallet_id: string };
}

/** One verified, enabled customer workspace per alarm; never creates synthetic accounts. */
export async function backfillManagedWallets(provisioner = provisionManagedWallet) {
  if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) return;
  const row = db()
    .prepare(
      `SELECT w.id,w.org_id,MIN(u.id) AS user_id FROM abi_workspaces w
    JOIN memberships m ON m.org_id=w.org_id AND m.role='owner' AND m.revoked_at IS NULL
    JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL
    JOIN orgs o ON o.id=w.org_id
    LEFT JOIN abi_managed_wallets p ON p.workspace_id=w.id
    LEFT JOIN abi_wallet_setup_attempts a ON a.workspace_id=w.id
    WHERE p.verified_at IS NULL AND o.status!='frozen' AND (a.last_attempt_at IS NULL OR a.last_attempt_at<?)
    GROUP BY w.id ORDER BY COALESCE(a.last_attempt_at,''),w.created_at LIMIT 1`,
    )
    .get(new Date(Date.now() - 10 * 60000).toISOString()) as
    { id: string; org_id: string; user_id: string } | undefined;
  if (!row) return;
  db()
    .prepare(
      "INSERT INTO abi_wallet_setup_attempts(workspace_id,last_attempt_at) VALUES (?,?) ON CONFLICT(workspace_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,error_code=NULL",
    )
    .run(row.id, new Date().toISOString());
  try {
    await provisioner(row.org_id, row.id, row.user_id);
    console.log(
      JSON.stringify({
        type: "abi.wallet.provision",
        status: "ready",
        workspaceId: row.id,
        walletsReady: (
          db()
            .prepare("SELECT COUNT(*) AS n FROM abi_managed_wallets WHERE verified_at IS NOT NULL")
            .get() as { n: number }
        ).n,
      }),
    );
  } catch (e) {
    const code = e instanceof ManagedWalletError ? e.code : "WALLET_SETUP_FAILED";
    db()
      .prepare("UPDATE abi_wallet_setup_attempts SET error_code=? WHERE workspace_id=?")
      .run(code, row.id);
    console.warn(JSON.stringify({ type: "abi.wallet.provision", status: "pending", code }));
  }
}

/** Resolve persisted reviews, including ETH formerly held at the original USDC address. */
export function managedSendAccount(
  orgId: string,
  workspaceId: string,
  userId: string,
  walletId: string,
): WalletAccount {
  assertManagedWalletOwner(orgId, workspaceId, userId);
  for (const symbol of ["USDC", "ETH"] as const) {
    const row = binding(orgId, workspaceId, symbol);
    if (row?.wallet_id === walletId) return symbol;
  }
  throw new ManagedWalletError(
    "WALLET_MISMATCH",
    "The sending wallet does not belong to this workspace.",
    409,
  );
}
