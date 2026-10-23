import { defineConfig } from "vitest/config";

/**
 * Note: `@cloudflare/vitest-plugin` needs zod@4, but this monorepo overrides
 * zod to 3.25.76 for the API. Until that override is relaxed, Workers-runtime
 * tests run via `wrangler dev` + `scripts/verify-local.mjs` instead of the
 * vitest Workers pool. This config keeps Node-side helper tests available.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/*.node.test.ts"],
    testTimeout: 30_000,
  },
});
