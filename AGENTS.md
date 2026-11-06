# AGENTS.md

## Cursor Cloud specific instructions

PolicyVault is an npm workspaces monorepo (Node >= 20; the VM runs Node 22). The startup update
script already runs `npm install`, builds the internal library packages
(`@policyvault/common`, `@policyvault/policy`, `@policyvault/ledger`, `@policyvault/sdk`) into
their `dist/` folders, and runs `npm run db:generate` (Prisma client). Standard commands live in
the root `package.json` scripts and `README.md`; prefer those over reinventing them.

### Services and how to run them

- `apps/api` — Guardian + agent HTTP API, Express, SQLite-backed (`better-sqlite3`, WAL) at
  `apps/api/data/policyvault.db`. Run with `npm run dev:api` (listens on `http://localhost:8787`).
  Health check: `GET /v1/... ` and `GET /health`. No external DB/Docker needed — SQLite is created
  on first run. Postgres/Prisma (`packages/db`) is not yet wired into the API runtime.
- `apps/web` — Next.js 15 Guardian console. Run with `npm run dev:web` (`http://localhost:3000`).
  It talks to the API over HTTP via `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:8787`).
  From the landing page click **Launch console → Launch demo org with $100 float** to bootstrap a
  demo org with Researcher/Writer agents (there is no separate "Bootstrap demo org" button in the
  current UI, despite older README wording).
- `apps/x402-seller` — demo paid API + dev x402 facilitator on `http://localhost:9402`
  (`npm run dev -w @policyvault/x402-seller`). Only the **Agent Playground → "Research brief"**
  mission needs it; without it the mission's x402 purchase step soft-fails but the run continues.
- `apps/mcp-server`, `apps/worker`, `apps/demo-agent` — optional; not needed to exercise the core
  console/API flows.

### Non-obvious notes

- The internal `packages/*` libraries resolve to `dist/index.js` via their `main`/`exports`, so the
  apps will fail to import them until those packages are built. The update script handles this, but
  if you edit a library, rebuild it (e.g. `npm run build -w @policyvault/<pkg>`) — the apps' `tsx
  watch` / `next dev` do not recompile sibling workspace packages for you.
- `npm run test` only runs the `policy` and `ledger` unit suites. `npm run lint` is currently a
  placeholder (`echo`), not a real linter.
- `.env` is optional for local dev; the API defaults to port 8787 and the console to 8787/3000. The
  values in `.env.example` (e.g. the Postgres `DATABASE_URL`) are for the not-yet-wired Postgres
  path and are not required to run the SQLite-backed API.
