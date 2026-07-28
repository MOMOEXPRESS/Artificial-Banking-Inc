# Decision: migrate to Postgres against an executable contract, not a rewrite

**Status:** Accepted (stage 1 landed)
**Date:** 2026-07-27
**Roadmap:** P2-T2
**Supersedes:** the "A14 deferred" note at the top of `packages/db/prisma/schema.prisma`

---

## Problem

SQLite in a single process is the last structural ceiling in the runtime. It is
durable and transactional and correct — and it is one machine, one writer, and
one disk. Horizontal scale, managed backups, and point-in-time recovery all
need Postgres.

The tempting way to do that is: translate `store.ts` to Prisma, run the test
suite, ship. That is dangerous here for a specific reason.

**The existing 287 tests exercise the engine, not the store.** They would pass
against a backend that quietly broke:

- **Transaction atomicity** — `applyEntries` applies a batch of journals inside
  one SQLite transaction. A translation that commits per statement leaves half
  a settlement written when the second entry violates the ledger.
- **CAS semantics** — `claimEscrow`, `claimApproval` and `claimSubscriptionRun`
  are conditional updates whose return value decides whether money moves. Under
  Postgres READ COMMITTED, a naive `SELECT … then UPDATE` lets two callers both
  believe they won.
- **Idempotency reservation** — `reserveIdempotent` relies on a UNIQUE
  violation, deliberately: the x402 rail awaits network I/O for up to 25s
  inside that window, and a check-then-write leaves it open to double-spend.
- **Numeric precision** — balances are `bigint` micro-USDC. Any column type or
  driver that round-trips through a float corrupts values above 2^53 silently,
  and the corruption is invisible until an audit.

Each of those is a property SQLite gives for free and Postgres gives only if
asked correctly. None is covered by a test that would fail loudly.

## Decision

Write the contract first, as tests, and make every backend pass it.

`apps/api/src/store.conformance.ts` exports `runStoreConformance(name, backend)`
— a suite that exercises exactly the behaviour a second implementation can get
wrong. `store.conformance.test.ts` runs it against SQLite today. A Postgres
implementation gets a sibling file that calls the same function and nothing
else.

If a conformance test fails, the backend is not a drop-in. That is the thing
worth learning before it holds anyone's money, and the reason this stage comes
before any translation work.

## Staging

1. **Contract** *(landed)* — conformance suite, green against SQLite.
2. **Schema** *(landed)* — the schema is now generated from the live one by
   `apps/api/scripts/gen-prisma-schema.mjs`, which boots the store so every
   migration and seed has run. 50 models, 362 fields, validated by `prisma
   validate`. `store.schema-drift.test.ts` fails if a migration lands without a
   regeneration, in either direction — a dropped table leaves a model behind
   that reads as supported.

   Correction to this document as first written: money columns are `BigInt`
   (int8), not `NUMERIC(78,0)`. Prisma maps int8 to a JS BigInt, which is the
   type the ledger already uses; `Decimal` would put a Decimal.js conversion
   between the ledger and its own arithmetic. int8 spans ±9.2e18 micro-USDC,
   or ±$9.2 trillion.

   Drift the generation surfaced immediately: every `*_micro` column defaults
   to the *string* `'0'` in SQLite, because the column is TEXT. As int8 that
   default has to be numeric, and would have failed on the first insert.
3. **Implementation** — a Postgres store behind the same boundary, with:
   - `SERIALIZABLE` or explicit row locks for the CAS operations
   - `int8` for micro amounts, per the correction in stage 2 — never
     `double precision`, and never a driver that hands back a JS number
   - one real transaction around `applyEntries`
4. **Dual-run** — both backends in CI, same suite, until the Postgres column is
   green for a full cycle.
5. **Cutover** — documented, with the SQLite implementation retained as the
   test store. Keeping it alive is what forces the boundary to stay honest.

## Consequences

- The conformance suite is now the definition of "a store". Adding a store
  method that the suite does not cover is how the next backend silently
  diverges, so money-path additions should extend it.
- SQLite stays supported indefinitely for local development and tests. It is
  not deprecated; it is the reference implementation.
- Stage 3 needs a running Postgres, which is an operator action — see
  `docs/OWNER-ACTIONS.md` §5.2. Stages 1 and 2 do not.

## How to reopen

If someone proposes translating `store.ts` directly to Prisma and running the
existing tests, re-read the four failure modes above. They are the reason this
decision exists.
