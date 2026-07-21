# Vercel deploy (Console / Next.js)

## Why `404 NOT_FOUND` / red ✕ on Preview & Production

That page is **Vercel’s platform 404**, not our app (`x-vercel-error: DEPLOYMENT_NOT_FOUND`). A red ✕ on GitHub Deployments means the build **failed** or was **blocked**. Until a deploy is **Ready**, Production and Preview URLs will not load the app.

### Common causes

1. **Root Directory blank + Next at `apps/web`** — With only `framework: nextjs` at the repo root, Vercel runs `next build` at `/` and fails (`Couldn't find any pages or app directory`). Repo `vercel.json` now points `@vercel/next` at `apps/web/package.json` so deploys work even if Root Directory is unset. Prefer still setting Root Directory to `apps/web` in the dashboard.
2. **Build failed: `Can't resolve 'zod/v4/core'`** — `@hookform/resolvers@5` needs **Zod ≥ 3.25** (`zod` pinned to `^3.25.76`).
3. **Blocked deploy (Hobby)** — Cursor/agent commits may be blocked. Fix: **Redeploy** as the account owner, or push a small commit yourself.
4. **Wrong Output Directory** — do **not** set Output Directory to `.next` / `apps/web/.next`. Leave it empty for Next.js.
5. **Production vs Preview** — Production only updates from the **Production Branch** (`main`).

## Fix (Vercel dashboard — still recommended)

1. Open **https://vercel.com** → project **artificial-banking-inc** (team `gaia10`).
2. **Settings → Build and Deployment** (or General)
   - **Root Directory** → `apps/web` → Save
   - **Framework Preset** → Next.js
   - **Build Command** → default / empty
   - **Install Command** → default / empty
   - **Output Directory** → **empty**
   - **Production Branch** → `main`
3. **Deployments** → latest → if **Error** / **Blocked**, **⋯ → Redeploy** (as account owner).
4. Wait for **Ready**, then open the Production domain (not an old failed hash URL).

## After agent PRs land

If Hobby blocks agent authors, **Redeploy** from your Vercel account (or push one commit yourself).

## Gaia preview “looks like something went wrong”

That’s Cursor’s `.gaia` preview host, not Vercel. Fix Vercel using the steps above.

## API

Vercel hosts the **web console only**. Point `NEXT_PUBLIC_API_URL` at your API host under **Settings → Environment Variables**, then Redeploy.
