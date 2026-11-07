/** Validate the fields used by Receive before replacing its last known profile. */
export function hasReceivingDetails(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  if (typeof p.addressVerified !== "boolean" || !p.network || typeof p.network !== "object")
    return false;
  const n = p.network as Record<string, unknown>;
  if (
    typeof n.name !== "string" ||
    !n.name.trim() ||
    typeof n.testnet !== "boolean" ||
    !Number.isSafeInteger(n.chainId)
  )
    return false;
  if (
    !Array.isArray(p.assets) ||
    !p.assets.every((a: unknown) => {
      if (!a || typeof a !== "object") return false;
      const row = a as Record<string, unknown>;
      return (
        typeof row.assetId === "string" &&
        (row.receiveAddress === null ||
          (typeof row.receiveAddress === "string" &&
            /^0x[a-fA-F0-9]{40}$/.test(row.receiveAddress)))
      );
    })
  )
    return false;
  if (p.funding !== undefined) {
    if (!p.funding || typeof p.funding !== "object") return false;
    const instructions = (p.funding as Record<string, unknown>).instructions;
    if (
      !Array.isArray(instructions) ||
      !instructions.every((line: unknown) => typeof line === "string")
    )
      return false;
  }
  return true;
}
