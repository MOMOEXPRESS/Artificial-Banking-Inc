/** Explicit preview capability. Legacy asset reads/recovery do not migrate funds. */
export function previewTestnetEnabled() {
  return process.env.ABI_PREVIEW_TESTNET === "1";
}
export function assertPreviewChain() {
  if (previewTestnetEnabled() && process.env.CHAIN && process.env.CHAIN !== "base-sepolia")
    throw Error("Testnet preview requires CHAIN=base-sepolia.");
}
