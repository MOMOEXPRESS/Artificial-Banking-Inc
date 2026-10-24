/**
 * The single switch for the training layer.
 *
 * Training (guided scenarios, hints, sandbox setup, drills) is available only
 * when the build allows it AND the org is in sandbox mode. A live org gets the
 * workflow runner alone: real steps, no demo setup, no policy edits, no drills.
 * Set NEXT_PUBLIC_ABI_TRAINING=0 to remove it everywhere.
 */
export function trainingBuildEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ABI_TRAINING?.trim() !== "0";
}

export function isTrainingEnabled(
  org: { ledgerMode?: "sandbox" | "live" } | null | undefined,
): boolean {
  if (!trainingBuildEnabled()) return false;
  // Unknown mode is treated as live: fail closed on the safer side.
  return org?.ledgerMode === "sandbox";
}
