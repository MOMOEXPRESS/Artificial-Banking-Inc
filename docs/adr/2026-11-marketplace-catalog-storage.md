# ADR-006: Future catalog storage split (not built in M0–M10 unless SLO fails)

**Status:** Proposed / deferred  
**Date:** 2026-11-06  
**Context:** Public catalog and search will share the singleton money DO (`AbiApi` / `"abi-api"`). A slow FTS query blocks payments.

## Decision (for now)

- Keep catalog in the same SQLite DO through M1–M10 with hard caps, sanitised FTS, LRU cache, and bounded jobs.
- **Do not** add a second DO class unless local/prod measurements show **p95 > 300 ms** for search on ≥10k published products after M3 mitigations.

## Future design (owner approval required)

1. New Durable Object class `CatalogIndex` with its own SQLite.
2. Money DO writes `marketplace_outbox` rows; catalog DO consumes them.
3. `apps/api-worker/wrangler.toml` needs `[[migrations]]` with `new_sqlite_classes = ["CatalogIndex"]`.
4. Public `/v1/market/search` and feed routes route to the catalog stub; checkout stays on the money DO.

## Consequences

- Config change and dual-write complexity need explicit owner approval.
- Zero-spend: stay on Workers Free; avoid R2 / Vectorize / paid AI unless flagged off-by-default and approved.
