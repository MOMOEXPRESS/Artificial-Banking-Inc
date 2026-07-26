#!/usr/bin/env node
/**
 * Wipe the local development database.
 *
 * This is the *only* remaining way to perform a global reset. It used to be
 * reachable as an unauthenticated `POST /v1/demo/bootstrap`, which meant anyone
 * could destroy every organization on a deployed instance — including vault
 * private keys, making any on-chain funds unrecoverable.
 *
 * Refuses to run against a production environment, and requires an explicit
 * confirmation flag so it cannot be triggered by a stray npm script.
 *
 *   npm run db:reset -- --yes
 */

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to reset: NODE_ENV=production.");
  process.exit(1);
}

if (!process.argv.includes("--yes")) {
  console.error(
    "This deletes EVERY organization, ledger, agent key and vault key in\n" +
      `  ${process.env.POLICYVAULT_DB ?? "apps/api/data/policyvault.db"}\n\n` +
      "Re-run with --yes if that is what you want:\n" +
      "  npm run db:reset -- --yes",
  );
  process.exit(1);
}

let mod;
try {
  mod = await import("../dist/store.js");
} catch {
  console.error("Build first: npm run build -w @policyvault/api");
  process.exit(1);
}

mod.store.resetAllData();
console.log(`Reset ${mod.getDbPath()} — all organizations removed.`);
