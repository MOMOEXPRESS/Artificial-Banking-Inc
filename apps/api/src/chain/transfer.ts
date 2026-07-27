/**
 * Outbound USDC transfer from the org vault EOA (Base / Base Sepolia).
 * Used by the agent `pay` rail so settlement is a real ERC-20 Transfer, not a mock hash.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { activeChain, rpcUrl, type ChainConfig } from "./network.js";
import { store } from "../store.js";
import { withVaultLock } from "./vault-queue.js";

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export class VaultTransferError extends Error {
  constructor(
    readonly code:
      | "CUSTODY_UNAVAILABLE"
      | "INVALID_DESTINATION"
      | "INSUFFICIENT_ONCHAIN_USDC"
      | "INSUFFICIENT_GAS"
      | "TRANSFER_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "VaultTransferError";
  }
}

export type VaultTransferResult = {
  txHash: Hex;
  from: Address;
  to: Address;
  amountMicro: bigint;
  explorerUrl: string;
  network: ChainConfig["id"];
  chainId: number;
};

function clients(cfg: ChainConfig, privateKey: Hex) {
  const chain = cfg.id === "base" ? base : baseSepolia;
  const transport = http(rpcUrl(cfg), { timeout: 45_000 });
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });
  return { account, publicClient, walletClient };
}

/**
 * Broadcast a USDC transfer from an org's vault.
 *
 * Serialised per vault: concurrent callers previously read the same nonce and
 * one transaction silently replaced the other, while the ledger recorded both.
 * See chain/vault-queue.ts.
 */
export async function transferUsdcFromVault(input: {
  orgId: string;
  to: string;
  amountMicro: bigint;
  /** Invoked as soon as the transaction hash exists, before confirmation. */
  onBroadcast?: (txHash: string) => void;
}): Promise<VaultTransferResult> {
  const vault = store.getVaultAddress(input.orgId);
  if (!vault) {
    throw new VaultTransferError("CUSTODY_UNAVAILABLE", "No vault for this org");
  }
  return withVaultLock(vault, () => broadcastUsdcTransfer(input));
}

async function broadcastUsdcTransfer(input: {
  orgId: string;
  to: string;
  amountMicro: bigint;
  onBroadcast?: (txHash: string) => void;
}): Promise<VaultTransferResult> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.to)) {
    throw new VaultTransferError("INVALID_DESTINATION", "Destination must be a 0x address");
  }
  if (input.amountMicro <= 0n) {
    throw new VaultTransferError("TRANSFER_FAILED", "Amount must be positive");
  }

  const privateKey = store.getVaultPrivateKey(input.orgId);
  const vaultAddress = store.getVaultAddress(input.orgId);
  if (!privateKey || !vaultAddress) {
    throw new VaultTransferError("CUSTODY_UNAVAILABLE", "No vault key for this org");
  }

  const cfg = activeChain();
  const to = input.to as Address;
  const { account, publicClient, walletClient } = clients(cfg, privateKey);

  if (account.address.toLowerCase() !== vaultAddress.toLowerCase()) {
    throw new VaultTransferError(
      "CUSTODY_UNAVAILABLE",
      "Vault address / key mismatch — refuse to broadcast",
    );
  }

  const [usdcBal, ethBal] = await Promise.all([
    publicClient.readContract({
      address: cfg.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    }),
    publicClient.getBalance({ address: account.address }),
  ]);

  if (usdcBal < input.amountMicro) {
    throw new VaultTransferError(
      "INSUFFICIENT_ONCHAIN_USDC",
      `Vault on-chain USDC ${usdcBal.toString()} < required ${input.amountMicro.toString()}`,
    );
  }
  // Dust floor so we fail fast with a clear message before estimateGas blows up.
  if (ethBal === 0n) {
    throw new VaultTransferError(
      "INSUFFICIENT_GAS",
      `Vault needs Base Sepolia ETH for gas. Fund ${account.address} then retry.`,
    );
  }

  try {
    const hash = await walletClient.writeContract({
      address: cfg.usdc,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, input.amountMicro],
      account,
      chain: cfg.id === "base" ? base : baseSepolia,
    });
    // The money is gone from here on. Persist the hash before the long await:
    // a crash or timeout during confirmation must still be recoverable.
    input.onBroadcast?.(hash);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 120_000,
    });
    if (receipt.status !== "success") {
      throw new VaultTransferError("TRANSFER_FAILED", `USDC transfer reverted (${hash})`);
    }
    return {
      txHash: hash,
      from: account.address,
      to,
      amountMicro: input.amountMicro,
      explorerUrl: cfg.explorerTx(hash),
      network: cfg.id,
      chainId: cfg.chainId,
    };
  } catch (e) {
    if (e instanceof VaultTransferError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (/insufficient funds|gas|intrinsic/i.test(msg)) {
      throw new VaultTransferError(
        "INSUFFICIENT_GAS",
        `Vault needs more ETH for gas: ${msg}`,
      );
    }
    throw new VaultTransferError("TRANSFER_FAILED", msg);
  }
}
