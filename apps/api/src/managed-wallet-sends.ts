import { WorkspaceError } from "./workspaces.js";
import { workspaceGovernance } from "./workspace-governance.js";
import { assertTreasurySendCapacity } from "./account-treasury.js";
/** Human-reviewed native/USDC sends. Prepared payloads cannot be edited at confirmation. */
import { randomUUID } from "node:crypto";
import {
  encodeFunctionData,
  getAddress,
  parseUnits,
  formatUnits,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { commerceDatabase, store } from "./store.js";
import {
  guardTreasuryWithdraw,
  treasuryWithdrawLimits,
  treasuryWithdrawnLast24h,
} from "./treasury-guard.js";
import { treasuryApprovalThresholdMicro } from "./treasury-threshold.js";
import {
  readyManagedWallet,
  managedSendAccount,
  assertManagedWalletOwner,
  type WalletAccount,
  managedProvider,
  ManagedWalletError,
  type ManagedProvider,
} from "./managed-wallets.js";
import {
  walletAsset,
  assetClient,
  balanceAbi,
  walletExplorer,
  type WalletChainClient,
} from "./wallet-assets.js";
const db = () => commerceDatabase();
const transferAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;
type Tx = {
  to: Address;
  value: Hex;
  data?: Hex;
  gas_limit?: Hex;
  max_fee_per_gas?: Hex;
  max_priority_fee_per_gas?: Hex;
};
type SendRow = {
  id: string;
  workspace_id: string;
  org_id: string;
  user_id: string;
  asset_id: string;
  chain_id: number;
  address: Address;
  wallet_id: string;
  recipient: Address;
  amount: string;
  tx_json: string;
  request_key: string;
  state: string;
  tx_hash: Hex | null;
  created_at: string;
  expires_at: string;
};
function publicSend(r: SendRow) {
  const a = walletAsset(r.asset_id),
    tx = JSON.parse(r.tx_json) as Tx;
  return {
    id: r.id,
    createdAt: r.created_at,
    assetId: r.asset_id,
    symbol: a.symbol,
    network: a.network,
    testnet: a.testnet,
    amount: r.amount,
    recipient: r.recipient,
    source: r.address,
    state: r.state,
    hash: r.tx_hash,
    explorerUrl: r.tx_hash ? `${walletExplorer(a)}/tx/${r.tx_hash}` : null,
    expiresAt: r.expires_at,
    maxNetworkFeeEth: formatUnits(BigInt(tx.gas_limit!) * BigInt(tx.max_fee_per_gas!), 18),
  };
}
function checkPolicy(
  orgId: string,
  userId: string,
  assetId: string,
  amount: string,
  recipient: string,
) {
  const asset = walletAsset(assetId),
    org = store.getOrg(orgId)!;
  const micro = parseUnits(amount, asset.decimals);
  const guard = guardTreasuryWithdraw({
    org,
    actor: userId,
    assetId: asset.symbol === "USDC" ? "asset_usdc" : "asset_eth",
    amountMicro: micro,
    amountDisplay: asset.symbol === "USDC" ? amount : "0",
    destination: recipient,
    dryRun: true,
  });
  if (!guard.ok) throw new ManagedWalletError(guard.code, guard.reasons.join(" "), guard.status);
  if (
    (store.getPolicyTemplate(orgId).approvalQuorum ?? 1) > 1 ||
    (asset.symbol === "USDC" &&
      micro > treasuryApprovalThresholdMicro(org.settings as Record<string, unknown>))
  )
    throw new ManagedWalletError(
      "GUARDIAN_REVIEW_REQUIRED",
      "This transfer requires guardian review. Privy transfers needing multiple approvals are not enabled yet; nothing was submitted.",
      409,
    );
  if (asset.symbol === "USDC") {
    const since = new Date(Date.now() - 86400000).toISOString();
    const rows = db()
      .prepare(
        "SELECT amount FROM abi_managed_sends WHERE org_id=? AND asset_id LIKE '%:usdc' AND ((state IN ('submitting','submitted','unknown')) OR (state='confirmed' AND created_at>=?))",
      )
      .all(orgId, since) as { amount: string }[];
    const pending = rows.reduce((sum, r) => sum + parseUnits(r.amount, 6), 0n);
    const legacy = treasuryWithdrawnLast24h(orgId) + store.treasuryWithdrawInFlightMicro(orgId);
    if (pending + micro + legacy > treasuryWithdrawLimits(orgId).dailyMaxMicro)
      throw new ManagedWalletError(
        "DAILY_LIMIT",
        "The rolling treasury withdrawal limit is reached.",
        403,
      );
  }
}
export async function prepareManagedSend(
  orgId: string,
  workspaceId: string,
  userId: string,
  input: {
    assetId: string;
    amount: string;
    recipient?: string;
    toWorkspaceId?: string;
    sourceAccount?: WalletAccount;
  },
  client?: WalletChainClient,
) {
  try {
    return await prepareManagedSendUnsafe(
      orgId,
      workspaceId,
      userId,
      input,
      client ?? assetClient(walletAsset(input.assetId)),
    );
  } catch (e) {
    if (e instanceof ManagedWalletError || e instanceof WorkspaceError) throw e;
    throw new ManagedWalletError(
      "NETWORK_UNAVAILABLE",
      "The balance or network fee could not be verified. Check your funds and ETH for gas, then retry. Nothing was submitted.",
    );
  }
}
async function prepareManagedSendUnsafe(
  orgId: string,
  workspaceId: string,
  userId: string,
  input: {
    assetId: string;
    amount: string;
    recipient?: string;
    toWorkspaceId?: string;
    sourceAccount?: WalletAccount;
  },
  client = assetClient(walletAsset(input.assetId)),
) {
  if (workspaceGovernance(orgId, workspaceId).effectiveQuorum > 1)
    throw new ManagedWalletError(
      "GUARDIAN_REVIEW_REQUIRED",
      "This workspace requires multiple approvers. Mainnet transfers with workspace quorum are not enabled; nothing was submitted.",
      409,
    );
  const row = readyManagedWallet(
      orgId,
      workspaceId,
      userId,
      true,
      input.assetId,
      input.sourceAccount,
    ),
    asset = walletAsset(input.assetId);
  const destination = input.toWorkspaceId
    ? readyManagedWallet(orgId, input.toWorkspaceId, userId, true, input.assetId).address
    : input.recipient;
  if (!destination)
    throw new ManagedWalletError(
      "RECIPIENT_REQUIRED",
      "Choose a receiving workspace or address.",
      400,
    );
  let recipient: Address;
  try {
    recipient = getAddress(destination);
  } catch {
    throw new ManagedWalletError("INVALID_ADDRESS", "Enter a valid EVM address.", 400);
  }
  if (/^0x0{40}$/i.test(recipient) || recipient.toLowerCase() === row.address.toLowerCase())
    throw new ManagedWalletError(
      "INVALID_ADDRESS",
      "Choose a different, nonzero receiving address.",
      400,
    );
  if (
    !/^\d{1,24}(\.\d{1,18})?$/.test(input.amount) ||
    (input.amount.split(".")[1]?.length ?? 0) > asset.decimals
  )
    throw new ManagedWalletError(
      "INVALID_AMOUNT",
      `Enter a positive ${asset.symbol} amount with at most ${asset.decimals} decimal places.`,
      400,
    );
  checkPolicy(orgId, userId, asset.id, input.amount, recipient);
  const units = parseUnits(input.amount, asset.decimals);
  if (units <= 0n)
    throw new ManagedWalletError("INVALID_AMOUNT", "Enter an amount greater than zero.", 400);
  if ((await client.getChainId()) !== asset.chainId)
    throw new ManagedWalletError(
      "NETWORK_MISMATCH",
      "Network verification failed. No transaction was prepared.",
    );
  const [gasBalance, tokenBalance, fees] = await Promise.all([
    client.getBalance({ address: row.address }),
    asset.contract
      ? client.readContract({
          address: asset.contract,
          abi: balanceAbi,
          functionName: "balanceOf",
          args: [row.address],
        })
      : Promise.resolve(null),
    client.estimateFeesPerGas(),
  ]);
  if (units > (tokenBalance ?? gasBalance))
    throw new ManagedWalletError(
      "INSUFFICIENT_FUNDS",
      `Not enough ${asset.symbol} on ${asset.network}.`,
      409,
    );
  const tx: Tx = asset.contract
    ? {
        to: asset.contract,
        value: "0x0",
        data: encodeFunctionData({
          abi: transferAbi,
          functionName: "transfer",
          args: [recipient, units],
        }),
      }
    : { to: recipient, value: toHex(units) };
  const gas = await client.estimateGas({
    account: row.address,
    to: tx.to,
    value: BigInt(tx.value),
    ...(tx.data ? { data: tx.data } : {}),
  });
  const gasLimit = (gas * 120n + 99n) / 100n,
    maxFee = fees.maxFeePerGas,
    priority = fees.maxPriorityFeePerGas;
  if (maxFee === undefined || priority === undefined)
    throw new ManagedWalletError("FEE_UNAVAILABLE", "A network fee could not be verified. Retry.");
  if (gasBalance < (asset.contract ? 0n : units) + gasLimit * maxFee)
    throw new ManagedWalletError(
      "GAS_REQUIRED",
      `Add ETH on ${asset.network} to the sending address ${row.address} to cover the network fee. ETH held at a different asset address cannot cover this fee.`,
      409,
    );
  Object.assign(tx, {
    gas_limit: toHex(gasLimit),
    max_fee_per_gas: toHex(maxFee),
    max_priority_fee_per_gas: toHex(priority),
  });
  assertTreasurySendCapacity(
    orgId,
    workspaceId,
    asset.id,
    units,
    tokenBalance ?? gasBalance,
    row.address,
  );
  const id = `send_${randomUUID()}`,
    created = new Date().toISOString(),
    expires = new Date(Date.now() + 5 * 60000).toISOString();
  db()
    .prepare(
      "INSERT INTO abi_managed_sends(id,workspace_id,org_id,user_id,asset_id,chain_id,address,wallet_id,recipient,amount,tx_json,request_key,state,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'prepared',?,?)",
    )
    .run(
      id,
      workspaceId,
      orgId,
      userId,
      asset.id,
      asset.chainId,
      row.address,
      row.wallet_id,
      recipient,
      formatUnits(units, asset.decimals),
      JSON.stringify(tx),
      randomUUID(),
      created,
      expires,
    );
  return publicSend(db().prepare("SELECT * FROM abi_managed_sends WHERE id=?").get(id) as SendRow);
}
export async function confirmManagedSend(
  orgId: string,
  workspaceId: string,
  userId: string,
  sendId: string,
  provider?: ManagedProvider,
) {
  assertManagedWalletOwner(orgId, workspaceId, userId);
  const row = db()
    .prepare(
      "SELECT * FROM abi_managed_sends WHERE id=? AND org_id=? AND workspace_id=? AND user_id=?",
    )
    .get(sendId, orgId, workspaceId, userId) as SendRow | undefined;
  if (!row)
    throw new ManagedWalletError(
      "SEND_NOT_FOUND",
      "This transfer does not belong to your account.",
      404,
    );
  const sourceAccount = managedSendAccount(orgId, workspaceId, userId, row.wallet_id);
  const wallet = readyManagedWallet(orgId, workspaceId, userId, true, row.asset_id, sourceAccount);
  if (row.state !== "prepared") return publicSend(row);
  if (Date.parse(row.expires_at) < Date.now())
    throw new ManagedWalletError(
      "SEND_EXPIRED",
      "This review has expired. Prepare a new transfer.",
      409,
    );
  if (
    row.wallet_id !== wallet.wallet_id ||
    row.address.toLowerCase() !== wallet.address.toLowerCase()
  )
    throw new ManagedWalletError(
      "WALLET_MISMATCH",
      "The sending wallet changed. No transfer was submitted.",
      409,
    );
  const p = provider ?? managedProvider(); // Validate configuration before acquiring the durable lock.
  try {
    const locked = db().transaction(() => {
      if (workspaceGovernance(orgId, workspaceId).effectiveQuorum > 1)
        throw new ManagedWalletError(
          "GUARDIAN_REVIEW_REQUIRED",
          "This workspace now requires multiple approvers. Nothing was submitted.",
          409,
        );
      checkPolicy(orgId, userId, row.asset_id, row.amount, row.recipient);
      return db()
        .prepare("UPDATE abi_managed_sends SET state='submitting' WHERE id=? AND state='prepared'")
        .run(sendId);
    })();
    if (!locked.changes)
      return publicSend(
        db().prepare("SELECT * FROM abi_managed_sends WHERE id=?").get(sendId) as SendRow,
      );
  } catch (e) {
    if (e instanceof ManagedWalletError || e instanceof WorkspaceError) throw e;
    throw new ManagedWalletError(
      "SEND_IN_PROGRESS",
      "Another transfer on this network is pending. Wait for its confirmation.",
      409,
    );
  }
  try {
    const hash = await p.send(
      row.wallet_id,
      row.chain_id,
      JSON.parse(row.tx_json),
      row.request_key,
    );
    db()
      .prepare(
        "UPDATE abi_managed_sends SET state='submitted',tx_hash=? WHERE id=? AND state='submitting'",
      )
      .run(hash, sendId);
    return publicSend({ ...row, state: "submitted", tx_hash: hash });
  } catch {
    db()
      .prepare("UPDATE abi_managed_sends SET state='unknown' WHERE id=? AND state='submitting'")
      .run(sendId);
    throw new ManagedWalletError(
      "SEND_STATUS_UNKNOWN",
      "The provider did not confirm submission. Do not send again. Contact ABI support with this transfer ID: " +
        sendId,
      409,
    );
  }
}
export async function managedSends(orgId: string, workspaceId: string, userId: string) {
  assertManagedWalletOwner(orgId, workspaceId, userId);
  const rows = db()
    .prepare(
      "SELECT * FROM abi_managed_sends WHERE org_id=? AND workspace_id=? ORDER BY created_at DESC LIMIT 20",
    )
    .all(orgId, workspaceId) as SendRow[];
  for (const r of rows) {
    if (r.state !== "submitted" || !r.tx_hash) continue;
    try {
      const c = assetClient(walletAsset(r.asset_id));
      if ((await c.getChainId()) !== r.chain_id) continue;
      const receipt = await c.getTransactionReceipt({ hash: r.tx_hash });
      if (receipt.blockNumber && (await c.getBlockNumber()) >= receipt.blockNumber + 2n) {
        r.state = receipt.status === "success" ? "confirmed" : "reverted";
        db()
          .prepare("UPDATE abi_managed_sends SET state=? WHERE id=? AND state='submitted'")
          .run(r.state, r.id);
      }
    } catch {
      /* Pending or unavailable stays pending; no false success. */
    }
  }
  return rows.map(publicSend);
}
