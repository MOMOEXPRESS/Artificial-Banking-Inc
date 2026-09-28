/**
 * Compatibility shim for older workers. Agents no longer receive individual
 * top-ups: they spend from their group's shared budget under policy.
 */
export function runAutoFundSweep(opts?: { force?: boolean }): { toppedUp: number } {
  void opts;
  return { toppedUp: 0 };
}
