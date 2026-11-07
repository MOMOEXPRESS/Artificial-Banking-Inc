type Balance = { availableUsdc: string; heldUsdc: string };
export type WalletBalances = { org: Balance; departments: Balance[]; shared: Balance[] };
const micro = (value: string) => {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) throw new Error("Invalid wallet balance");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
};
export function walletAmount(value: bigint) {
  const fraction = (value % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return `${value / 1_000_000n}.${fraction}`;
}
/** Agent balances alias group authority; count each actual wallet only once. */
export function walletSummary(wallets: WalletBalances) {
  const allocations = [...wallets.departments, ...wallets.shared];
  return {
    available: walletAmount(micro(wallets.org.availableUsdc)),
    allocated: walletAmount(allocations.reduce((n, w) => n + micro(w.availableUsdc), 0n)),
    pending: walletAmount(
      [wallets.org, ...allocations].reduce((n, w) => n + micro(w.heldUsdc), 0n),
    ),
  };
}
