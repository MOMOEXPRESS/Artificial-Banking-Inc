/**
 * Wallet source of truth for an organization.
 *
 * Every surface that shows "where do I send money" or "what can I send" (the
 * vault card, Treasury → Vault, Receive, Settings, the playground) reads this
 * one object instead of re-deriving it. Before this, the console guessed:
 * the card rendered the vault address as a grouped "card number", the gas
 * balance was a chip, sandbox credits were labelled "Receive", and EURC/ETH
 * "sends" debited a number in the database with no transaction behind them.
 *
 * Facts this encodes:
 *  - One org has ONE EVM vault address. Tokens on the same network share it;
 *    there is no per-currency address.
 *  - The address is only offered as a receiving address when the stored key
 *    actually derives to it (`addressVerified`).
 *  - USDC never pays gas. The vault needs the active network's native ETH —
 *    on testnet that is Base Sepolia ETH (chain 84532), not Ethereum Sepolia
 *    (chain 11155111). No paymaster/sponsorship is configured in this
 *    codebase (custody is a self-custodied EOA), so none is claimed.
 *  - There is no sandbox mode and no simulated top-up. Every org is live:
 *    USDC on the books arrived at the vault on-chain, Treasury sends and
 *    agent payments to a 0x address broadcast real transfers. On testnet
 *    (CHAIN=base-sepolia) that is real Base Sepolia testnet USDC.
 */
import type { AssetRecord } from "@policyvault/common";
import { formatMicroToUsdc } from "@policyvault/common";
import { privateKeyToAccount } from "viem/accounts";
import { assetBacking, isTestnetChain, networkName } from "./asset-adapters.js";
import type { OnchainVaultSnapshot } from "./deposits.js";
import { activeChain } from "./network.js";
import { formatWeiAsEth } from "./transfer.js";

export type SendMode =
  /** A real transaction is broadcast; the ledger books it only after it confirms. */
  | "onchain"
  /** Asset with no chain adapter: a hand-kept record, never a settlement. */
  | "recorded"
  /** Refused: the asset is read from the chain but no send rail exists for it. */
  | "unsupported";

export type SendSupport = { mode: SendMode; reason: string };

const USDC_ASSET_ID = "asset_usdc";

/**
 * What "send" means for an asset in this org. The only on-chain send rail is
 * the USDC ERC-20 transfer (chain/transfer.ts). EURC and native ETH are read
 * from the chain, so a live org may not "send" them by editing a number.
 */
export function assetSendSupport(asset: AssetRecord): SendSupport {
  const backing = assetBacking(asset);
  const net = networkName(asset.chain);
  if (asset.id === USDC_ASSET_ID) {
    return {
      mode: "onchain",
      reason: `Broadcasts a USDC transfer from the vault on ${networkName(activeChain().id)}. The ledger records it only after the transaction confirms.`,
    };
  }
  if (backing.kind === "chain") {
    return {
      mode: "unsupported",
      reason: `${asset.symbol} on ${net} is read from the chain, but ABI has no on-chain send rail for it yet. Sending is disabled so the books never record a transfer that did not happen.`,
    };
  }
  return {
    mode: "recorded",
    reason:
      backing.reason ?? `${asset.symbol} has no chain adapter; balances are recorded by hand.`,
  };
}

export type AddressVerification = "verified" | "no-vault" | "no-key" | "key-mismatch";

/** Does the stored vault key derive to the stored vault address? */
export function verifyVaultAddress(
  address: string | undefined | null,
  privateKey: `0x${string}` | undefined | null,
): AddressVerification {
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return "no-vault";
  if (!privateKey) return "no-key";
  try {
    return privateKeyToAccount(privateKey).address.toLowerCase() === address.toLowerCase()
      ? "verified"
      : "key-mismatch";
  } catch {
    return "key-mismatch";
  }
}

/** Gas floor the console treats as "enough": same knob as the gas monitor. */
export function gasWarnThresholdWei(): bigint {
  const n = Number(process.env.ABI_GAS_WARN_ETH ?? "0.002");
  if (!Number.isFinite(n) || n < 0) return 2_000_000_000_000_000n;
  return BigInt(Math.round(n * 1e18));
}

export type WalletProfile = ReturnType<typeof buildWalletProfile>;

export function buildWalletProfile(input: {
  orgId: string;
  vaultAddress: string | undefined | null;
  vaultPrivateKey: `0x${string}` | undefined | null;
  custodyProvider: string | null;
  assets: AssetRecord[];
  ledgerAvailableMicro: bigint;
  unbackedMicro: bigint;
  /** Fresh balances read; null/!ok when the RPC was unreachable. */
  snap: OnchainVaultSnapshot | null;
}) {
  const cfg = activeChain();
  const verification = verifyVaultAddress(input.vaultAddress, input.vaultPrivateKey);
  const addressVerified = verification === "verified";
  const address = input.vaultAddress ?? null;
  const chainRead = Boolean(input.snap?.ok);
  const nativeWei = chainRead ? BigInt(input.snap!.nativeBalanceWei) : null;
  const threshold = gasWarnThresholdWei();
  const testnet = isTestnetChain(cfg.id);
  const wrongNetworks =
    cfg.id === "base-sepolia"
      ? [
          { name: "Ethereum Sepolia", chainId: 11155111 },
          { name: "Base (mainnet)", chainId: 8453 },
          { name: "Ethereum (mainnet)", chainId: 1 },
        ]
      : [
          { name: "Ethereum (mainnet)", chainId: 1 },
          { name: "Base Sepolia (testnet)", chainId: 84532 },
        ];

  return {
    orgId: input.orgId,
    address: addressVerified ? address : null,
    /** The raw stored address, shown for diagnosis only when it is not verified. */
    storedAddress: address,
    addressVerified,
    verification,
    custody: {
      provider: input.custodyProvider,
      kind: "self-custodied EOA" as const,
      gasSponsorship: false,
      gasSponsorshipNote:
        "No paymaster or gas sponsorship is configured: the vault pays its own gas in native ETH.",
    },
    network: {
      id: cfg.id,
      name: cfg.name,
      chainId: cfg.chainId,
      testnet,
      usdcContract: cfg.usdc,
      explorerAddress: address && addressVerified ? cfg.explorerAddress(address) : null,
    },
    /** What an agent payment to a 0x address actually does. */
    agentPayments: {
      mode: "onchain" as const,
      realFunds: true,
      testnet,
      networkName: cfg.name,
      chainId: cfg.chainId,
      note: testnet
        ? `Agent payments to a wallet address send real ${cfg.name} testnet USDC (chain ${cfg.chainId}) from this vault. Each one has a transaction hash on the block explorer. Testnet USDC has no cash value.`
        : `Agent payments to a wallet address send real ${cfg.name} USDC (chain ${cfg.chainId}) from this vault.`,
    },
    usdc: {
      ledgerAvailableUsdc: formatMicroToUsdc(input.ledgerAvailableMicro),
      /** Pre-retirement simulated money still locked in an in-flight hold (normally 0). */
      unbackedUsdc: formatMicroToUsdc(input.unbackedMicro > 0n ? input.unbackedMicro : 0n),
      onchainUsdc: chainRead ? input.snap!.onchainBalanceUsdc : null,
      onchainMicro: chainRead ? input.snap!.onchainBalanceMicro : null,
    },
    gas: {
      symbol: "ETH",
      networkName: cfg.name,
      chainId: cfg.chainId,
      balanceWei: nativeWei?.toString() ?? null,
      balanceEth: nativeWei === null ? null : formatWeiAsEth(nativeWei),
      recommendedMinEth: formatWeiAsEth(threshold),
      /** null = unknown (RPC unreachable). Never guessed. */
      sufficient: nativeWei === null ? null : nativeWei >= threshold,
      empty: nativeWei === null ? null : nativeWei === 0n,
      readError: chainRead ? null : (input.snap?.error ?? "Chain not read"),
    },
    funding: {
      sendUsdcTo: addressVerified ? address : null,
      sendGasTo: addressVerified ? address : null,
      instructions: addressVerified
        ? [
            `Send ${cfg.name} USDC (contract ${cfg.usdc}) to ${address}.`,
            `Send ${cfg.name} ETH (chain id ${cfg.chainId}) to the same address for gas. USDC cannot pay gas.`,
            `Do not send from ${wrongNetworks.map((n) => `${n.name} (${n.chainId})`).join(", ")}: funds on another network never reach this vault.`,
          ]
        : ["No verified vault address. Receiving is disabled until the vault key is restored."],
      wrongNetworks,
    },
    assets: input.assets.map((asset) => {
      const backing = assetBacking(asset);
      const onVaultNetwork = asset.chain === cfg.id;
      return {
        assetId: asset.id,
        symbol: asset.symbol,
        decimals: asset.decimals,
        chain: asset.chain,
        networkName: networkName(asset.chain),
        contract: asset.contract ?? null,
        native: Boolean(backing.native),
        backing: backing.kind,
        /** Same vault address for every token on the vault's network; null otherwise. */
        receiveAddress:
          addressVerified && backing.kind === "chain" && onVaultNetwork ? address : null,
        send: assetSendSupport(asset),
      };
    }),
  };
}
