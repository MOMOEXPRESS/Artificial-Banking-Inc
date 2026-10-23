/**
 * Human network names for the chain ids the API returns ("base-sepolia",
 * "eip155:84532", …). UI copy must never show a raw chain id.
 */
const NETWORK_NAMES: Record<string, string> = {
  "base-sepolia": "Base Sepolia",
  "eip155:84532": "Base Sepolia",
  base: "Base",
  "base-mainnet": "Base",
  "eip155:8453": "Base",
  ethereum: "Ethereum",
  "eip155:1": "Ethereum",
  sepolia: "Ethereum Sepolia",
  "eip155:11155111": "Ethereum Sepolia",
  bitcoin: "Bitcoin",
  solana: "Solana",
};

/** "base-sepolia" → "Base Sepolia". Unknown ids are title-cased, never shown raw. */
export function networkLabel(chain?: string | null, fallback = "—"): string {
  if (!chain) return fallback;
  const known = NETWORK_NAMES[chain.trim().toLowerCase()];
  if (known) return known;
  if (/^eip155:\d+$/i.test(chain)) return `Chain ${chain.split(":")[1]}`;
  return chain
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/** Prefer the API's display name; fall back to mapping the chain id. */
export function holdingNetwork(h?: { chain: string; networkName?: string } | null): string {
  if (!h) return "—";
  return h.networkName || networkLabel(h.chain);
}
