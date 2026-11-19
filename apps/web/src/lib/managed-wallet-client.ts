import { z } from "zod";
const address = z.string().regex(/^0x[\da-fA-F]{40}$/);
export const managedWalletSchema = z.object({
  provider: z.literal("privy"),
  control: z.literal("abi-managed"),
  workspaceId: z.string(),
  status: z.enum(["ready", "setup_pending"]),
  address: address.nullable(),
  providerWalletId: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  receiveEnabled: z.boolean(),
  withdrawalEnabled: z.boolean(),
  spendingEnabled: z.literal(false),
  accountSymbol: z.enum(["USDC", "ETH"]).optional(),
  selectedAssetId: z.string(),
  asset: z.object({
    id: z.string(),
    symbol: z.enum(["USDC", "ETH"]),
    network: z.string(),
    chainId: z.number(),
    testnet: z.boolean(),
  }),
  assets: z.array(
    z.object({
      id: z.string(),
      symbol: z.enum(["USDC", "ETH"]),
      network: z.string(),
      chainId: z.number(),
      testnet: z.boolean(),
    }),
  ),
  balance: z.object({
    status: z.enum(["available", "unavailable"]),
    amount: z.string().nullable(),
    observedAt: z.string().nullable(),
    stale: z.boolean().optional(),
    gasEth: z.string().optional(),
  }),
  explorerAddress: z.string().url().nullable(),
  balanceError: z.string().optional(),
});
export type ManagedWallet = z.infer<typeof managedWalletSchema>;
export const walletChanged = () => window.dispatchEvent(new Event("abi:wallet-changed"));
export function walletAmount(wallet: ManagedWallet | undefined) {
  return wallet?.balance.status === "available" ? wallet.balance.amount : "—";
}

/** Older deployed APIs omit accountSymbol. Never invent a separate asset binding. */
export function parseManagedWallet(value: unknown): ManagedWallet {
  const result = managedWalletSchema.safeParse(value);
  if (!result.success)
    throw new Error("Wallet details could not be loaded. Please refresh and try again.");
  return result.data;
}
export function managedWalletReady(
  wallet:
    | Pick<
        ManagedWallet,
        "status" | "receiveEnabled" | "address" | "accountSymbol" | "asset" | "selectedAssetId"
      >
    | null
    | undefined,
  recovery?: { accountSymbol: "USDC" | "ETH"; assetId: string },
): boolean {
  if (!wallet || wallet.status !== "ready" || !wallet.receiveEnabled || !wallet.address)
    return false;
  if (recovery)
    return (
      wallet.accountSymbol === recovery.accountSymbol && wallet.selectedAssetId === recovery.assetId
    );
  return !wallet.accountSymbol || wallet.accountSymbol === wallet.asset.symbol;
}
