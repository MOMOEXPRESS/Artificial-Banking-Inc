# ADR: run the API as a persistent service, not embedded in Next.js

- **Date:** 2026-07-26
- **Status:** Accepted, not yet implemented (roadmap **P2-T1**, **P2-T2**)
- **Supersedes:** the embedded `/abi-api` deployment introduced around `cbb1cd5`

## Context

The API is currently embedded into the Next.js app and deployed to Vercel. Since
only `/tmp` is writable on a serverless function, and functions do not share a
filesystem, the SQLite database is synchronised between invocations through
Vercel Runtime Cache.

`apps/web/src/app/abi-api/[...path]/route.ts` therefore performs, on **every
request**:

1. `closeDb()` — release the SQLite handle
2. base64-decode the entire database from a single global cache key and write it
   to `/tmp`
3. reopen SQLite
4. serve the request
5. re-encode the entire database and upload it back to that same key

## Problem

This is a read-modify-write cycle on a shared blob with no compare-and-swap, no
lease, and no version check.

**Writes are lost.** Two concurrent requests each hydrate snapshot *N*, apply
their own mutation, and each persist. The loser's journal entries, payments,
approvals and idempotency reservations disappear — *after* the caller has already
received HTTP 200. Every guarantee the engine establishes (idempotency reserved
before execution, atomic approval claims, escrow CAS) is enforced inside a SQLite
transaction on a file that is about to be silently overwritten.

This is not hypothetical. The console fires four concurrent requests every eight
seconds and nine more every thirty. The system cannot hold ledger integrity with
one user sitting idle on the dashboard.

**The system of record is evictable.** Runtime Cache is a cache. On eviction,
every organization, balance, audit trail and — critically — every vault private
key is gone, and any USDC at those addresses becomes unrecoverable.

**It does not scale.** Payload grows with total platform history, plus 33% for
base64, transferred twice per request.

**Background work does not run.** Every `setInterval` in `apps/api/src/index.ts`
is gated behind `if (!embedded)`. In production that means recurring
subscriptions **never charge**, the reconciliation watchdog never runs, Telegram
polling never starts, webhook retries never fire, and escrow and approval expiry
only happen when a human loads the relevant screen.

**Irreversible side effects can go unrecorded.** `waitForTransactionReceipt`
waits up to 120s; the function's `maxDuration` is 60s. A slow confirmation kills
the function mid-await, and because persistence happens only *after* the
response, every write from that request is discarded. Real USDC leaves the vault
and the ledger contains no record of it.

## Decision

Run `apps/api` as a long-lived process against Postgres, behind the existing
`store.ts` boundary. Vercel keeps the marketing site and the console; `/abi-api`
becomes a thin proxy rather than a host.

Background work moves into `apps/worker` with advisory locking, so it runs
whether or not anyone is looking and does not double-run when the API scales past
one instance.

## Consequences

**Gained:** durable writes, real transactions, working background jobs,
horizontal scale, and — most importantly — the engine's existing correctness
guarantees start meaning what they say.

**Cost:** a host to operate and pay for, a database to run and back up, and a
deployment that is no longer a single `git push`.

**Accepted:** this is a financial ledger. "Deploys in one step" is not a property
worth trading write durability for.

## Alternatives considered

- **Keep serverless, add optimistic concurrency to the cache blob.** Turns lost
  writes into conflict errors, but leaves eviction, scale, and dead background
  work unaddressed. Solves the least important third of the problem.
- **Serverless plus a hosted serverless database.** Fixes durability and
  concurrency, not the dead sweeps or the 60-second ceiling on settlement.
  A worker process is needed regardless, at which point the API may as well be
  one too.
- **Keep SQLite on a single persistent host.** Viable for a private beta and
  strictly better than today. Rejected as the destination only because the
  Postgres migration is cheap behind `store.ts` and doing it once is cheaper
  than doing it twice.

## Notes

`store.ts` was deliberately built as the single place all SQL lives, precisely so
the storage engine could be swapped without touching the domain. That design
decision is what makes this ADR a migration rather than a rewrite. Keep the
SQLite implementation alive as the test store — it forces the boundary to stay
honest.
