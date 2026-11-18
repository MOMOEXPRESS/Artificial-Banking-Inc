/** Native USDC allocations backed by an existing account wallet. No bridge or chain transfer. */
import { randomUUID } from "node:crypto";
import { parseUsdcToMicro, formatMicroToUsdc } from "@policyvault/common";
import { commerceDatabase, store } from "./store.js";
import { findWorkspace, WorkspaceError } from "./workspaces.js";
import { readyManagedWallet, ManagedWalletError } from "./managed-wallets.js";
import {
  walletAsset,
  readAssetBalance,
  assetClient,
  type WalletChainClient,
  tokenTransferEvent,
} from "./wallet-assets.js";
const db = () => commerceDatabase();
export function treasuryWorkspace(orgId: string) {
  const row = db()
    .prepare("SELECT id FROM abi_workspaces WHERE org_id=? AND is_default=1")
    .get(orgId) as { id: string } | undefined;
  if (!row)
    throw new WorkspaceError("TREASURY_NOT_READY", "Load your account workspaces first.", 409);
  return findWorkspace(orgId, row.id);
}
export function allocatedTreasuryMicro(orgId: string, assetId: string) {
  return (
    db()
      .prepare("SELECT amount_micro FROM abi_account_workspace_funds WHERE org_id=? AND asset_id=?")
      .all(orgId, assetId) as { amount_micro: string }[]
  ).reduce((s, r) => s + BigInt(r.amount_micro), 0n);
}
export function assertTreasurySendCapacity(
  orgId: string,
  workspaceId: string,
  assetId: string,
  amount: bigint,
  balance: bigint,
  address?: string,
) {
  const w = treasuryWorkspace(orgId);
  if (w.id !== workspaceId || !["base:usdc", "ethereum:usdc"].includes(assetId)) return;
  if (address) {
    const source = db()
      .prepare("SELECT address FROM abi_managed_wallets WHERE workspace_id=? AND org_id=?")
      .get(workspaceId, orgId) as { address: string } | undefined;
    if (source?.address.toLowerCase() !== address.toLowerCase()) return;
  }
  if (allocatedTreasuryMicro(orgId, assetId) + amount > balance)
    throw new WorkspaceError(
      "FUNDS_ALLOCATED",
      "These funds are allocated to workspaces. Return an allocation to the account before withdrawing it.",
      409,
    );
}
export async function accountTreasuryView(
  orgId: string,
  userId: string,
  assetId: string,
  client?: WalletChainClient,
) {
  if (!["base:usdc", "ethereum:usdc"].includes(assetId))
    throw new WorkspaceError(
      "ASSET_NOT_SUPPORTED",
      "Internal account allocations support native USDC on Base and Ethereum.",
      400,
    );
  const w = treasuryWorkspace(orgId),
    asset = walletAsset(assetId),
    wallet = readyManagedWallet(orgId, String(w.id), userId, false, assetId);
  const rpc = client ?? assetClient(asset);
  const [chainId, head] = await Promise.all([rpc.getChainId(), rpc.getBlockNumber()]);
  if (chainId !== asset.chainId)
    throw new ManagedWalletError("NETWORK_MISMATCH", "Treasury network could not be verified.");
  if (head < 3n)
    throw new ManagedWalletError("NETWORK_UNAVAILABLE", "Treasury confirmations are unavailable.");
  // Allocate only against a confirmed view, never the pending/latest token balance.
  const confirmedClient = {
    ...rpc,
    getChainId: async () => chainId,
    getBlockNumber: async () => head - 3n,
    getBalance: (a: Parameters<WalletChainClient["getBalance"]>[0]) => rpc.getBalance(a),
    readContract: (a: Parameters<WalletChainClient["readContract"]>[0]) => rpc.readContract(a),
  } as WalletChainClient;
  const [confirmed, latest] = await Promise.all([
    readAssetBalance(wallet.address, asset, confirmedClient),
    readAssetBalance(wallet.address, asset, {
      ...confirmedClient,
      getBlockNumber: async () => head,
    }),
  ]);
  const balance = BigInt(confirmed.units) < BigInt(latest.units) ? confirmed : latest;
  const fromBlock = head > 2002n ? head - 2002n : 0n,
    toBlock = head - 3n;
  let activityAvailable = false;
  if (rpc.getLogs && asset.contract) {
    try {
      const batches = await Promise.all([
        rpc.getLogs({
          address: asset.contract,
          event: tokenTransferEvent,
          args: { to: wallet.address },
          fromBlock,
          toBlock,
        }),
        rpc.getLogs({
          address: asset.contract,
          event: tokenTransferEvent,
          args: { from: wallet.address },
          fromBlock,
          toBlock,
        }),
      ]);
      db().transaction(() => {
        db()
          .prepare(
            "DELETE FROM abi_account_token_activity WHERE org_id=? AND asset_id=? AND lower(address)=lower(?) AND CAST(block_number AS INTEGER)>=? AND CAST(block_number AS INTEGER)<=?",
          )
          .run(orgId, assetId, wallet.address, Number(fromBlock), Number(toBlock));
        for (const log of batches.flat()) {
          if (
            !log.transactionHash ||
            log.logIndex === null ||
            log.blockNumber === null ||
            log.blockNumber > toBlock ||
            log.blockNumber < fromBlock ||
            log.args.value === undefined ||
            !log.args.from ||
            !log.args.to
          )
            continue;
          const incoming = log.args.to.toLowerCase() === wallet.address.toLowerCase(),
            outgoing = log.args.from.toLowerCase() === wallet.address.toLowerCase();
          if (!incoming && !outgoing) continue;
          db()
            .prepare(
              "INSERT OR IGNORE INTO abi_account_token_activity(org_id,asset_id,address,tx_hash,log_index,block_number,direction,amount_micro,counterparty) VALUES (?,?,?,?,?,?,?,?,?)",
            )
            .run(
              orgId,
              assetId,
              wallet.address,
              log.transactionHash,
              log.logIndex,
              log.blockNumber.toString(),
              incoming && outgoing ? "self" : incoming ? "deposit" : "withdrawal",
              log.args.value.toString(),
              incoming ? log.args.from : log.args.to,
            );
        }
      })();
      activityAvailable = true;
    } catch {
      /* An unavailable history scan never credits funds or claims no deposits. */
    }
  }
  const activity = (
    db()
      .prepare(
        "SELECT tx_hash AS hash,direction,amount_micro,counterparty,block_number AS block FROM abi_account_token_activity WHERE org_id=? AND asset_id=? AND lower(address)=lower(?) ORDER BY CAST(block_number AS INTEGER) DESC LIMIT 50",
      )
      .all(orgId, assetId, wallet.address) as {
      hash: string;
      direction: string;
      amount_micro: string;
      counterparty: string;
      block: string;
    }[]
  ).map((r) => ({ ...r, amountUsdc: formatMicroToUsdc(BigInt(r.amount_micro)) }));
  const rows = db()
    .prepare(
      "SELECT f.workspace_id,w.name,f.amount_micro FROM abi_account_workspace_funds f JOIN abi_workspaces w ON w.id=f.workspace_id WHERE f.org_id=? AND f.asset_id=?",
    )
    .all(orgId, assetId) as { workspace_id: string; name: string; amount_micro: string }[];
  const assigned = allocatedTreasuryMicro(orgId, assetId),
    total = BigInt(balance.units);
  const pending = !!db()
    .prepare(
      "SELECT 1 FROM abi_managed_sends WHERE org_id=? AND wallet_id=? AND chain_id=? AND (state IN ('submitting','submitted','unknown') OR (state='prepared' AND expires_at>=?)) LIMIT 1",
    )
    .get(orgId, wallet.wallet_id, asset.chainId, new Date().toISOString());
  return {
    activity,
    activityAvailable,
    activityFromBlock: fromBlock.toString(),
    activityToBlock: toBlock.toString(),
    workspaceId: String(w.id),
    assetId,
    network: asset.network,
    address: wallet.address,
    confirmedUsdc: balance.amount,
    allocatedUsdc: formatMicroToUsdc(assigned),
    unallocatedUsdc: formatMicroToUsdc(total > assigned ? total - assigned : 0n),
    reconciliationRequired: assigned > total,
    pendingTransfer: pending,
    observedAt: balance.observedAt,
    block: balance.block,
    allocations: rows.map((r) => ({
      workspaceId: r.workspace_id,
      name: r.name,
      amountUsdc: formatMicroToUsdc(BigInt(r.amount_micro)),
    })),
    events: db()
      .prepare(
        "SELECT id,workspace_id AS workspaceId,asset_id AS assetId,amount_micro AS amountMicro,direction,created_at AS createdAt FROM abi_account_allocation_events WHERE org_id=? AND asset_id=? ORDER BY created_at DESC LIMIT 50",
      )
      .all(orgId, assetId),
  };
}
export async function allocateAccountTreasury(
  orgId: string,
  userId: string,
  input: {
    assetId: string;
    workspaceId: string;
    amountUsdc: string;
    direction: "allocate" | "return";
    idempotencyKey: string;
  },
  client?: WalletChainClient,
) {
  const w = findWorkspace(orgId, input.workspaceId),
    treasury = treasuryWorkspace(orgId);
  if (w.id === treasury.id)
    throw new WorkspaceError(
      "INVALID_ALLOCATION",
      "Choose a workspace other than the account treasury.",
      400,
    );
  const amount = parseUsdcToMicro(input.amountUsdc);
  if (amount <= 0n) throw new WorkspaceError("INVALID_ALLOCATION", "Enter a positive amount.", 400);
  function previous() {
    const r = db()
      .prepare("SELECT * FROM abi_account_allocation_events WHERE org_id=? AND create_key=?")
      .get(orgId, input.idempotencyKey) as Record<string, string> | undefined;
    if (
      r &&
      (r.workspace_id !== input.workspaceId ||
        r.asset_id !== input.assetId ||
        r.amount_micro !== amount.toString() ||
        r.direction !== input.direction)
    )
      throw new WorkspaceError(
        "IDEMPOTENCY_CONFLICT",
        "This allocation key has different details.",
      );
    return r;
  }
  const old = previous();
  if (old) return { allocation: old };
  const source = readyManagedWallet(orgId, String(treasury.id), userId, false, input.assetId);
  const sendState = () =>
    JSON.stringify(
      db()
        .prepare(
          "SELECT id,state,tx_hash FROM abi_managed_sends WHERE org_id=? AND wallet_id=? AND chain_id=? ORDER BY id",
        )
        .all(orgId, source.wallet_id, walletAsset(input.assetId).chainId),
    );
  const before = sendState();
  const view = await accountTreasuryView(orgId, userId, input.assetId, client);
  return db().transaction(() => {
    const retry = previous();
    if (retry) return { allocation: retry };
    if (before !== sendState())
      throw new WorkspaceError(
        "TREASURY_CHANGED",
        "A treasury transfer changed while checking the balance. Refresh and retry.",
      );
    if (w.card_status !== "active" || treasury.card_status !== "active")
      throw new WorkspaceError(
        "CARD_FROZEN",
        "Unfreeze the account and workspace cards before changing allocations.",
      );
    if (store.getOrg(orgId)?.status !== "active")
      throw new WorkspaceError("ACCOUNT_FROZEN", "Unfreeze the account before allocating funds.");
    // Recompute obligations inside the write transaction after the network read.
    const asset = walletAsset(input.assetId),
      wallet = readyManagedWallet(orgId, String(treasury.id), userId, false, input.assetId);
    const pending = db()
      .prepare(
        "SELECT 1 FROM abi_managed_sends WHERE org_id=? AND wallet_id=? AND chain_id=? AND (state IN ('submitting','submitted','unknown') OR (state='prepared' AND expires_at>=?)) LIMIT 1",
      )
      .get(orgId, wallet.wallet_id, asset.chainId, new Date().toISOString());
    if (pending)
      throw new WorkspaceError(
        "TRANSFER_IN_PROGRESS",
        "Finish or let the prepared transfer expire before changing allocations.",
      );
    const assigned = allocatedTreasuryMicro(orgId, input.assetId);
    if (assigned > parseUsdcToMicro(view.confirmedUsdc))
      throw new WorkspaceError(
        "RECONCILIATION_REQUIRED",
        "The account balance needs reconciliation before allocations can change.",
      );
    const row = db()
      .prepare(
        "SELECT amount_micro FROM abi_account_workspace_funds WHERE org_id=? AND workspace_id=? AND asset_id=?",
      )
      .get(orgId, w.id, input.assetId) as { amount_micro: string } | undefined;
    const current = BigInt(row?.amount_micro ?? "0");
    if (input.direction === "allocate" && assigned + amount > parseUsdcToMicro(view.confirmedUsdc))
      throw new WorkspaceError(
        "INSUFFICIENT_FUNDS",
        "Not enough confirmed, unallocated USDC on this network.",
      );
    if (input.direction === "return" && amount > current)
      throw new WorkspaceError(
        "INSUFFICIENT_FUNDS",
        "This workspace does not have that much allocated USDC.",
      );
    const next = input.direction === "allocate" ? current + amount : current - amount;
    db()
      .prepare(
        "INSERT INTO abi_account_workspace_funds(org_id,workspace_id,asset_id,amount_micro) VALUES (?,?,?,?) ON CONFLICT(org_id,workspace_id,asset_id) DO UPDATE SET amount_micro=excluded.amount_micro",
      )
      .run(orgId, w.id, input.assetId, next.toString());
    const id = `pool_${randomUUID()}`;
    db()
      .prepare(
        "INSERT INTO abi_account_allocation_events(id,org_id,workspace_id,asset_id,amount_micro,direction,create_key,created_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        orgId,
        w.id,
        input.assetId,
        amount.toString(),
        input.direction,
        input.idempotencyKey,
        new Date().toISOString(),
      );
    return { allocation: previous() };
  })();
}
