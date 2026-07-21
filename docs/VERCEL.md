# Vercel deploy (Console / Next.js)

## Why `404 NOT_FOUND` on `*.vercel.app`

That page is **Vercel’s platform 404**, not our app. It means Production has **no Ready deployment** to serve (`x-vercel-error: DEPLOYMENT_NOT_FOUND`).

GitHub Deployments with a **red ✕** means the Vercel build **failed** (or was blocked). Until a deploy is **Ready**, Production and Preview URLs will not load the app.

### Common causes

1. **Build failed: `Can't resolve 'zod/v4/core'`** — `@hookform/resolvers@5` imports `zod/v4/core`, which only exists in **Zod ≥ 3.25**. The web app must pin `zod` to `^3.25.76` (not `3.24.x`).
2. **Blocked deploy (Hobby)** — commits from Cursor/cloud agents often aren’t on your Vercel team, so Vercel blocks them. GitHub shows the push; Vercel never publishes. Fix: Redeploy from your account (or push a commit yourself).
3. **Wrong Output Directory** — do **not** set Output Directory to `.next` / `apps/web/.next`. Leave it empty for Next.js.
4. **Wrong Root Directory** — Next.js lives in `apps/web`. If Root Directory is blank, Vercel runs `next build` at the repo root and fails (`Couldn't find any pages or app directory`).
5. **Production vs Preview** — Production domain only updates from the **Production Branch** (`main`). Pushes on `cursor/*` do not change Production until merged.

## Fix (do this in the Vercel dashboard)

1. Open **https://vercel.com** → project **artificial-banking-inc** (team `gaia10`).
2. **Settings → General**
   - **Root Directory** → `apps/web` → Save
   - **Framework Preset** → Next.js
   - **Build Command** → leave default (`next build`) or empty
   - **Install Command** → leave default (`npm install`)
   - **Output Directory** → **empty** (clear any `.next` value)
   - **Production Branch** → `main`
3. **Deployments** → open the latest → if **Blocked** / **Error**, click **⋯ → Redeploy** (as the account owner).  
   Or: **Deployments → Create Deployment** → branch `main`.
4. Wait for **Ready**, then open the **Domains** tab Production URL (not an old failed hash URL).

## After agent PRs land

Merge the UI PRs into `main`, then **Redeploy** from your Vercel account (or push a small commit yourself) so Hobby doesn’t block the agent author.

## Gaia preview “looks like something went wrong”

That’s Cursor’s `.gaia` preview host, not Vercel. It only works while the cloud agent’s Next server is running. Fix Vercel using the steps above; ignore Gaia for public links.

## API

Vercel hosts the **web console only**. Point `NEXT_PUBLIC_API_URL` at your API host (Railway/Fly/VPS) under **Settings → Environment Variables**, then Redeploy.
