/**
 * Worker stub — reconcile, escrow timeouts, webhooks (Phase 1+).
 * MVP API uses in-memory ledger; this process is a placeholder loop.
 */
const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 15_000);

console.log("PolicyVault worker started (stub reconcile loop)");

setInterval(() => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] reconcile tick — wire to chain indexer + ledger drift checks`);
}, INTERVAL_MS);
