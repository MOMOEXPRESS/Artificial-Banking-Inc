/**
 * Outbound USDC transfer from the org vault EOA (Base / Base Sepolia).
 * Used by the agent `pay` rail so settlement is a real ERC-20 Transfer, not a mock hash.
 */
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { activeChain, rpcUrl, type ChainConfig } from "./network.js";
import { store } from "../store.js";
import { withVaultLock } from "./vault-queue.js";
import { clearVaultBalanceCache } from "./deposits.js";

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
      | "TRANSFER_FAILED"
      /**
       * The transaction was broadcast but no receipt arrived in time. Funds may
       * or may not have moved: this is neither success nor failure, and must be
       * resolved by reconciliation against the chain, never by resubmitting.
       */
      | "SETTLEMENT_UNCONFIRMED",
    message: string,
    readonly txHash?: string,
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

/** The subset of viem's clients the transfer needs (narrow so tests can fake it). */
export type VaultChainClients = {
  account: { address: Address };
  publicClient: {
    readContract(args: unknown): Promise<unknown>;
    getBalance(args: { address: Address }): Promise<bigint>;
    estimateContractGas(args: unknown): Promise<bigint>;
    estimateFeesPerGas(): Promise<{ maxFeePerGas?: bigint; gasPrice?: bigint }>;
    waitForTransactionReceipt(args: { hash: Hex; timeout: number }): Promise<{ status: string }>;
  };
  walletClient: { writeContract(args: unknown): Promise<Hex> };
};

function realClients(cfg: ChainConfig, privateKey: Hex): VaultChainClients {
  const chain = cfg.id === "base" ? base : baseSepolia;
  const transport = http(rpcUrl(cfg), { timeout: 45_000 });
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });
  return {
    account,
    publicClient: publicClient as unknown as VaultChainClients["publicClient"],
    walletClient: walletClient as unknown as VaultChainClients["walletClient"],
  };
}

type ClientFactory = (cfg: ChainConfig, privateKey: Hex) => VaultChainClients;
let clientFactory: ClientFactory = realClients;

/** TEST ONLY: replace the chain clients with a local fake (null restores viem). */
export function setVaultChainClientsForTests(factory: ClientFactory | null): void {
  clientFactory = factory ?? realClients;
}

/** Receipt wait after broadcast. Overridable so tests do not sit for two minutes. */
function receiptTimeoutMs(): number {
  const n = Number(process.env.ABI_TX_RECEIPT_TIMEOUT_MS ?? 120_000);
  return Number.isFinite(n) && n > 0 ? n : 120_000;
}

/** Headroom on the gas estimate (Base fees move between estimate and inclusion). */
const GAS_HEADROOM_BPS = 12_000n; // 1.2x

/**
 * Native-gas preflight. USDC cannot pay gas: an EOA vault needs the chain's
 * native ETH (Base Sepolia ETH on testnet — Ethereum Sepolia ETH is a different
 * chain and never arrives here). Returns the shortfall in wei, 0n when covered.
 */
export function gasShortfallWei(input: {
  nativeBalanceWei: bigint;
  gasLimit: bigint;
  maxFeePerGasWei: bigint;
}): { requiredWei: bigint; shortfallWei: bigint } {
  const requiredWei = (input.gasLimit * input.maxFeePerGasWei * GAS_HEADROOM_BPS) / 10_000n;
  const shortfallWei =
    input.nativeBalanceWei >= requiredWei ? 0n : requiredWei - input.nativeBalanceWei;
  return { requiredWei, shortfallWei };
}

export function formatWeiAsEth(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "").slice(0, 8);
  return frac ? `${whole}.${frac}` : whole.toString();
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

  if (input.to.toLowerCase() === vaultAddress.toLowerCase()) {
    // A self-transfer burns gas, moves nothing, and the ledger would book an
    // outflow the vault never lost. Pay another account's vault, not your own.
    throw new VaultTransferError(
      "INVALID_DESTINATION",
      "Destination is this organization's own vault — choose another wallet or another ABI account's vault address",
    );
  }

  const cfg = activeChain();
  const to = input.to as Address;
  const { account, publicClient, walletClient } = clientFactory(cfg, privateKey);

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

  if ((usdcBal as bigint) < input.amountMicro) {
    throw new VaultTransferError(
      "INSUFFICIENT_ONCHAIN_USDC",
      `Vault on-chain USDC ${String(usdcBal)} < required ${input.amountMicro.toString()} (${cfg.name}, chain id ${cfg.chainId})`,
    );
  }
  // Gas preflight: estimate the real cost instead of only refusing a 0 balance.
  // A dust balance used to pass the old `ethBal === 0n` check and then fail
  // inside writeContract with an opaque RPC error.
  const fundHint = `Send ${cfg.name} ETH (chain id ${cfg.chainId}) to ${account.address}. USDC cannot pay gas${
    cfg.id === "base-sepolia"
      ? ", and Ethereum Sepolia ETH (chain id 11155111) is a different network"
      : ""
  }.`;
  if (ethBal === 0n) {
    throw new VaultTransferError(
      "INSUFFICIENT_GAS",
      `Vault has no ${cfg.name} ETH for gas. ${fundHint}`,
    );
  }
  let gasLimit: bigint;
  let maxFeePerGas: bigint;
  try {
    const [g, fees] = await Promise.all([
      publicClient.estimateContractGas({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "transfer",
        args: [to, input.amountMicro],
        account: account.address,
      }),
      publicClient.estimateFeesPerGas(),
    ]);
    gasLimit = g;
    maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0]! : String(e);
    if (/insufficient funds|exceeds balance|gas required exceeds/i.test(msg)) {
      throw new VaultTransferError("INSUFFICIENT_GAS", `Gas estimate failed: ${msg}. ${fundHint}`);
    }
    // Nothing was broadcast, so this is a clean, retryable failure.
    throw new VaultTransferError("TRANSFER_FAILED", `Could not estimate gas: ${msg}`);
  }
  const gas = gasShortfallWei({
    nativeBalanceWei: ethBal,
    gasLimit,
    maxFeePerGasWei: maxFeePerGas,
  });
  if (gas.shortfallWei > 0n) {
    throw new VaultTransferError(
      "INSUFFICIENT_GAS",
      `Vault has ${formatWeiAsEth(ethBal)} ETH but needs about ${formatWeiAsEth(gas.requiredWei)} ETH for gas. ${fundHint}`,
    );
  }

  let hash: Hex;
  try {
    hash = await walletClient.writeContract({
      address: cfg.usdc,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, input.amountMicro],
      account,
      chain: cfg.id === "base" ? base : baseSepolia,
      gas: (gasLimit * GAS_HEADROOM_BPS) / 10_000n,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/insufficient funds|intrinsic gas|gas required exceeds/i.test(msg)) {
      throw new VaultTransferError(
        "INSUFFICIENT_GAS",
        `Vault needs more ETH for gas: ${msg}. ${fundHint}`,
      );
    }
    throw new VaultTransferError("TRANSFER_FAILED", msg);
  }

  // The money may be gone from here on. Persist the hash before the long await:
  // a crash or timeout during confirmation must still be recoverable.
  input.onBroadcast?.(hash);
  // Balances read before the send are stale now.
  clearVaultBalanceCache();

  let receipt: { status: string };
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: receiptTimeoutMs() });
  } catch (e) {
    // NOT a failure: the transaction exists and may still be mined. Resubmitting
    // here is how a timeout turns into a double payment.
    const msg = e instanceof Error ? e.message.split("\n")[0]! : String(e);
    throw new VaultTransferError(
      "SETTLEMENT_UNCONFIRMED",
      `Transfer ${hash} was broadcast but not confirmed yet (${msg}). It will be reconciled against the chain; do not retry.`,
      hash,
    );
  }
  clearVaultBalanceCache();
  if (receipt.status !== "success") {
    throw new VaultTransferError("TRANSFER_FAILED", `USDC transfer reverted (${hash})`, hash);
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
}
