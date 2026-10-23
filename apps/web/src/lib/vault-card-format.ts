/**
 * Pure helpers for the bank-card-style vault visual (vault-bank-card.tsx).
 * Kept framework-free so they can be unit tested with node:test.
 */

/**
 * Split an EVM address into card-number style groups of 4.
 * The `0x` prefix rides on the first group: "0x626B 15e6 …" (10 hex groups + prefix).
 * Non-hex / non-0x strings are still grouped by 4 so nothing is ever hidden.
 */
export function groupVaultAddress(address: string): string[] {
  const raw = address.trim();
  if (!raw) return [];
  const hasPrefix = /^0x/i.test(raw);
  const body = hasPrefix ? raw.slice(2) : raw;
  const groups: string[] = [];
  for (let i = 0; i < body.length; i += 4) groups.push(body.slice(i, i + 4));
  if (hasPrefix && groups.length) groups[0] = `${raw.slice(0, 2)}${groups[0]}`;
  return groups;
}

/** Break groups into rows (default 5 per row → two tidy lines for a 40-hex address). */
export function cardNumberRows(groups: string[], perRow = 5): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < groups.length; i += perRow) rows.push(groups.slice(i, i + perRow));
  return rows;
}

/** Cardholder-style label: uppercase, collapsed whitespace, bounded length. */
export function cardholderName(name: string | undefined | null, max = 26): string {
  const clean = (name ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  if (!clean) return "ORGANIZATION";
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** The subset of a vault holding the card needs to pick an address. */
export type CardHolding = {
  id: string;
  symbol: string;
  chain: string;
  backing?: { kind: "chain" | "chain-unconfigured" | "manual" | string };
};

/**
 * Deposit address for the selected asset, or null when the vault has none.
 *
 * The org has a single EVM vault key. It is the receiving address only for
 * assets the API reads on-chain from that vault (`backing.kind === "chain"`,
 * e.g. USDC, EURC and native ETH on Base Sepolia). Manual-book assets such as
 * BTC or SOL, and EVM assets on a chain with no RPC configured, have no vault
 * address — we never reuse the EVM address for them.
 */
export function assetDepositAddress(
  holding: CardHolding | null | undefined,
  vaultAddress: string | null | undefined,
): string | null {
  const vault = (vaultAddress ?? "").trim();
  if (!holding || !vault) return null;
  if (holding.backing) return holding.backing.kind === "chain" ? vault : null;
  // No backing info (fallback roster before /assets loads): only the USDC spend rail.
  return holding.id === "asset_usdc" ? vault : null;
}
