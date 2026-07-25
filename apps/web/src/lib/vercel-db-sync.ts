/**
 * Persist / hydrate the embedded ABI SQLite DB across Vercel serverless isolates
 * via Runtime Cache (single file — journal_mode DELETE on VERCEL).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const CACHE_KEY = "abi-sqlite-v1";
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

type CacheBlob = { base64: string; updatedAt?: number };

async function tryGetCache(): Promise<{
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown, opts?: { ttl?: number; tags?: string[] }) => Promise<void>;
} | null> {
  try {
    const { getCache } = await import("@vercel/functions");
    return getCache();
  } catch {
    // Local/dev or missing Runtime Cache — no-op.
    return null;
  }
}

/** Write cached SQLite bytes to dbPath before opening/reloading better-sqlite3. */
export async function hydrateDbFromCache(dbPath: string): Promise<void> {
  const cache = await tryGetCache();
  if (!cache) return;
  try {
    const value = (await cache.get(CACHE_KEY)) as CacheBlob | null | undefined;
    if (!value || typeof value !== "object" || typeof value.base64 !== "string") return;

    // Do not clobber a newer local file with a stale cache snapshot (race guard).
    if (existsSync(dbPath)) {
      const localMtime = statSync(dbPath).mtimeMs;
      const cacheAt = typeof value.updatedAt === "number" ? value.updatedAt : 0;
      if (localMtime > 0 && cacheAt > 0 && localMtime >= cacheAt) return;
      if (statSync(dbPath).size > 0 && cacheAt === 0) {
        // Legacy blob without timestamp: prefer non-empty local over blind overwrite
        // only when local is very recent (< 30s) — otherwise take cache (cross-isolate).
        if (Date.now() - localMtime < 30_000) return;
      }
    }

    mkdirSync(dirname(dbPath), { recursive: true });
    writeFileSync(dbPath, Buffer.from(value.base64, "base64"));
  } catch (e) {
    console.warn("[abi-db-sync] hydrate skipped:", e instanceof Error ? e.message : e);
  }
}

/** Snapshot dbPath into Runtime Cache after a successful embedded request. */
export async function persistDbToCache(dbPath: string): Promise<void> {
  const cache = await tryGetCache();
  if (!cache) return;
  try {
    const buf = readFileSync(dbPath);
    await cache.set(
      CACHE_KEY,
      { base64: buf.toString("base64"), updatedAt: Date.now() } satisfies CacheBlob,
      { ttl: TTL_SECONDS, tags: ["abi-db"] },
    );
  } catch (e) {
    console.warn("[abi-db-sync] persist skipped:", e instanceof Error ? e.message : e);
  }
}
