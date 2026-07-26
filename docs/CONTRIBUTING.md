# Contributing

## Requirements

- **Node 22.13+** (the repo builds on 20.19+, but the lint toolchain wants 22.13)
- npm 10+
- Git

No Docker is required for the default local stack — the API runs on SQLite.

## Setup

```bash
git clone https://github.com/MOMOEXPRESS/Artificial-Banking-Inc.git
cd Artificial-Banking-Inc
npm install
npm run build
npm test
```

`npm run build` must precede `npm test`: the API imports the compiled workspace
packages, not their sources.

## Running locally

```bash
npm run dev:api     # http://localhost:8787
npm run dev:web     # http://localhost:3000
```

Optional processes:

```bash
npm run dev -w @policyvault/x402-seller   # paid demo API + dev facilitator :9402
npm run dev:mcp                            # MCP server for agent runtimes
npm run demo:agent                         # runnable example agent
```

## Verification — run all four before pushing

```bash
npm run build
npm run typecheck
npm run lint
npm test
```

CI runs exactly these. A red result blocks merge.

## Code style

- **Prettier** is configured (`.prettierrc.json`) but **not yet enforced**. The
  tree predates it and a repo-wide sweep would bury real diffs, so it runs as an
  advisory CI job. Format files you touch (`npx prettier --write <file>`); do not
  reformat files you did not otherwise change.
- **ESLint** is enforced. `npm run lint` must be clean.
- Match the surrounding code. This codebase has an unusually high comment
  density that explains *why*, not *what* — that is deliberate, especially on
  the money path. Keep it.

## The money path needs extra care

Changes under any of these require review by a second person and a test that
demonstrates the behaviour:

```
apps/api/src/engine.ts
apps/api/src/store.ts
packages/policy/
packages/ledger/
packages/custody/
apps/api/src/rails/
apps/api/src/chain/
```

See [`CODEOWNERS`](../.github/CODEOWNERS).

Specific invariants that must not regress — each is explained in
[`SECURITY.md`](./SECURITY.md):

1. Idempotency keys are reserved **before** the rail executes, never after.
2. Approvals re-evaluate the **current** policy at execution time.
3. Approval and escrow settlement claim state by compare-and-swap before the
   ledger is touched.
4. Every journal sums to zero and no asset account goes negative.
5. Quorum counts authenticated guardian identities, not client-supplied labels.
6. The LLM never authorizes spend. It proposes; the policy engine decides.

## Commits

Conventional commits, already the established style in this repository:

```
feat(api): per-agent policy overrides
fix(web): stop console polling while the tab is hidden
chore(repo): consolidate documentation
docs(security): state the actual custody posture
```

One commit per completed task or phase. No micro-commits. The subject line
should say what changed and why it matters, not restate the diff.

## Branching

Work on a branch, open a PR, let CI pass, then merge. `main` should always
build.

```bash
git switch -c feat/short-description
```

## Documentation

If a change alters behaviour a user or integrator can observe, update the docs
in the same commit:

| Change | Update |
|---|---|
| API surface | `docs/ARCHITECTURE.md`, the OpenAPI document |
| Security posture | `docs/SECURITY.md` |
| Deployment | `docs/DEPLOY.md` |
| A decision with lasting consequences | a new `docs/adr/` entry |
| Anything on the roadmap | tick it off in `docs/ROADMAP.md` |

**Do not describe something as built until it is built.** The audit that
produced the current roadmap found marketing copy, a README section, and an API
response all claiming capabilities that did not exist. That cost more
credibility than the missing features themselves.

## Archived material

`archive/` and `docs/archive/` hold code and documents kept for reference. They
are excluded from the build, CI, and linting. Do not import from them, and do
not update them — if the content matters again, move it back and revive it
properly.
