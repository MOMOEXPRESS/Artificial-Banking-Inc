/**
 * Client view of GET /v1/guardian/wallet — the wallet source of truth.
 * Pure helpers so they can be unit tested with node:test.
 */
export type SendMode = "onchain" | "simulated" | "recorded" | "unsupported";

export type WalletProfile = {
  address: string | null;
  addressVerified: boolean;
  verification: "verified" | "no-vault" | "no-key" | "key-mismatch";
  network: {
    id: string;
    name: string;
    chainId: number;
    testnet: boolean;
    explorerAddress: string | null;
  };
  ledgerMode: "sandbox" | "live";
  balancesSimulated: boolean;
  usdc: {
    ledgerAvailableUsdc: string;
    simulatedUsdc: string;
    onchainUsdc: string | null;
  };
  gas: {
    symbol: string;
    networkName: string;
    chainId: number;
    balanceEth: string | null;
    recommendedMinEth: string;
    sufficient: boolean | null;
    empty: boolean | null;
    readError: string | null;
  };
  funding: { instructions: string[]; wrongNetworks: { name: string; chainId: number }[] };
  assets: {
    assetId: string;
    symbol: string;
    decimals: number;
    networkName: string;
    receiveAddress: string | null;
    send: { mode: SendMode; reason: string };
  }[];
};

/** Copy target for an asset: only a verified receiving address, never a guess. */
export function receiveAddressFor(
  profile: WalletProfile | null | undefined,
  assetId: string,
): string | null {
  if (!profile?.addressVerified) return null;
  return profile.assets.find((a) => a.assetId === assetId)?.receiveAddress ?? null;
}

/** Decorative card identifier — explicitly NOT an address. */
export function cardIdentifier(address: string | null | undefined): string {
  const tail = (address ?? "").replace(/^0x/i, "").slice(-4).toUpperCase();
  return tail ? `ABI •••• ${tail}` : "ABI •••• ----";
}

/** One-line gas status for the vault, with the exact network. */
export function gasStatusLine(profile: WalletProfile | null | undefined): {
  tone: "ok" | "warn" | "unknown";
  text: string;
} {
  if (!profile) return { tone: "unknown", text: "Gas balance not loaded" };
  const g = profile.gas;
  if (g.balanceEth === null || g.sufficient === null) {
    return { tone: "unknown", text: `${g.networkName} ETH balance unavailable — not assumed` };
  }
  if (g.sufficient) {
    return {
      tone: "ok",
      text: `${g.balanceEth} ETH on ${g.networkName} (chain ${g.chainId}) for gas`,
    };
  }
  return {
    tone: "warn",
    text: `${g.balanceEth} ETH on ${g.networkName} — below ${g.recommendedMinEth} ETH. Send ${g.networkName} ETH (chain ${g.chainId}) to the vault; USDC cannot pay gas.`,
  };
}

/** Input decimals for an asset amount (ETH is 18, USDC/EURC 6). */
export function assetInputDecimals(
  profile: WalletProfile | null | undefined,
  assetId: string,
): number {
  return profile?.assets.find((a) => a.assetId === assetId)?.decimals ?? 6;
}
