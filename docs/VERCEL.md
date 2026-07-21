# Vercel deploy (Console / Next.js)

## Canonical URL (bookmark this)

**https://artificial-banking-inc-gaia10.vercel.app**

Team projects always get `{project}-{team}.vercel.app`. These short names are
**not** assigned to this project and will keep returning Vercel platform 404
forever unless you claim them (usually impossible on a team) or add a **custom
domain**:

| URL | Result |
| --- | --- |
| `https://artificial-banking-inc-gaia10.vercel.app` | Production alias — **use this** |
| `https://artificial-banking-inc-git-main-gaia10.vercel.app` | `main` branch alias |
| `https://artificial-banking-inc.vercel.app` | Platform `NOT_FOUND` (unassigned) |
| `https://artificialbankinginc.vercel.app` | Platform `DEPLOYMENT_NOT_FOUND` (unassigned) |

## Fix “404 NOT_FOUND” / login wall once

There are **two** different failures people mix up:

1. **Wrong hostname** → `x-vercel-error: NOT_FOUND` / `DEPLOYMENT_NOT_FOUND`  
   You opened a short `*.vercel.app` that is not on the project. Open the
   canonical URL above (or add your own domain under **Settings → Domains**).

2. **Right hostname, Vercel login / “looks broken”** → Deployment Protection SSO  
   The deploy is fine; anonymous visitors are sent to `vercel.com/login`.

### One command (owner)

```bash
# https://vercel.com/account/tokens — scope: full account or the gaia10 team
VERCEL_TOKEN=… npm run vercel:harden
```

That script:

- Disables **Vercel Authentication** (`ssoProtection: null`) on project
  `artificial-banking-inc` (team `gaia10`)
- Lists assigned domains
- Attempts to claim short aliases (usually rejected for team projects — OK)
- Prints the canonical production URL

Or in the dashboard (same effect):

1. https://vercel.com → team **gaia10** → **artificial-banking-inc**
2. **Settings → Deployment Protection** → turn **off** Vercel Authentication
   for Production (and Preview if you want public previews)
3. Open **https://artificial-banking-inc-gaia10.vercel.app**

Optional CI: add repo secret `VERCEL_TOKEN`, then
**Actions → Vercel harden → Run workflow** (also runs on pushes that touch the
harden script).

## Why builds used to 404 / red ✕ / “unused-build-settings”

A red ✕ on GitHub Deployments means the build **failed** or was **blocked**.
Until a deploy is **Ready**, no URL serves the app.

**Do not put a legacy `"builds"` array in a root `vercel.json`.** That forces
the old builder path and Vercel prints:

> Due to `builds` existing in your configuration file, the Build and
> Development Settings defined in your Project Settings will not apply.

Current setup (Project Settings **do** apply):

1. **No root `vercel.json`** — removed so dashboard settings are not ignored.
2. **Root Directory** = `apps/web` (set via dashboard or `npm run vercel:harden`).
3. **Include source files outside Root Directory** = on (monorepo `packages/*`).
4. **`apps/web/vercel.json`** — `framework: nextjs` + workspace install/build.
5. **Output Directory** empty (never `.next`).
6. **Zod ≥ 3.25** for `@hookform/resolvers`.
7. Production Branch = `main`. Hobby may **block** agent commits — Redeploy as owner.

## API on Vercel (no more opaque `/abi-api` 404)

Vercel hosts the **web console only**. The money API is a separate Node
process (see [`DEPLOY.md`](./DEPLOY.md)).

The console calls same-origin `/abi-api/*`. That path is a Next route handler
(`apps/web/src/app/abi-api/[...path]/route.ts`) which:

- **Local / Cursor** — proxies to `http://127.0.0.1:8787` (or `ABI_API_ORIGIN`)
- **Vercel with `ABI_API_ORIGIN` set** — proxies to your API host
- **Vercel without API origin** — returns **503 JSON** `API_NOT_CONFIGURED`
  (not a blank Next 404)

Set under **Project → Settings → Environment Variables** (Production + Preview),
then Redeploy:

| Name | Example |
| --- | --- |
| `ABI_API_ORIGIN` | `https://api.yourdomain.com` |
| `NEXT_PUBLIC_API_URL` | `/abi-api` (default) or the absolute API URL |

## Local / Cursor preview

```bash
npm run dev:api
npm run dev:web
```

Open the web port → **Bootstrap demo**.

## Gaia preview “looks like something went wrong”

That’s Cursor’s `.gaia` preview host, not Vercel. Use the canonical Vercel URL
or local `dev:web` after fixing deploy settings above.
