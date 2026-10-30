/**
 * The single switch for the training layer.
 *
 * Training (guided scenarios, hints, practice setup, drills) is available only
 * when the build allows it AND the deployment runs on a testnet, where funds
 * have no cash value. Sandbox mode no longer exists — every org is live — so
 * the network is the line between practice and real money. A mainnet (or
 * unknown) deployment gets the workflow runner alone: real steps, no demo
 * setup, no policy edits, no drills.
 * Set NEXT_PUBLIC_ABI_TRAINING=0 to remove it everywhere.
 */
export function trainingBuildEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ABI_TRAINING?.trim() !== "0";
}

export function isTrainingEnabled(
  org: { network?: { testnet: boolean } } | null | undefined,
): boolean {
  if (!trainingBuildEnabled()) return false;
  // Unknown network is treated as mainnet: fail closed on the safer side.
  return org?.network?.testnet === true;
}
