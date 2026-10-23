/**
 * Wrangler alias target for `better-sqlite3`.
 *
 * On Workers the real native addon cannot load. The Durable Object injects a
 * SqlStorage-backed Database via `globalThis.__ABI_STORE_DB__` before the API
 * store module opens a connection.
 */
import type { DatabaseLike } from "../storage/do-sql.js";

declare global {
  var __ABI_STORE_DB__: DatabaseLike | undefined;
  var __ABI_STORE_DB_FACTORY__: (() => DatabaseLike) | undefined;
}

class ShimDatabase {
  constructor(_path?: string, _options?: unknown) {
    const injected =
      globalThis.__ABI_STORE_DB__ ??
      (typeof globalThis.__ABI_STORE_DB_FACTORY__ === "function"
        ? globalThis.__ABI_STORE_DB_FACTORY__()
        : undefined);
    if (!injected) {
      throw new Error(
        "better-sqlite3 shim: no Durable Object database injected (set __ABI_STORE_DB__ first)",
      );
    }
    return injected as unknown as ShimDatabase;
  }
}

export default ShimDatabase;
export type { DatabaseLike };
