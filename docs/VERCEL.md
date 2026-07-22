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

### Dashboard click path (Root Directory is NOT a repo folder)

“Root Directory” does **not** appear in GitHub / your file tree. It is a
**Vercel Project Setting**. The value you type is the real monorepo path
`apps/web` (that folder exists in the repo).

Exact path in the Vercel UI:

1. Open https://vercel.com and switch the team picker (top-left) to **gaia10**
2. Click the project **artificial-banking-inc**
3. Left sidebar → **Settings**
4. Under Settings, open **Build and Deployment**  
   (sometimes listed under **General** → scroll to *Build and Development Settings*)
5. Scroll to **Root Directory** → **Edit**
6. Enter: `apps/web`
7. Leave **Include source files outside of the Root Directory in the Build Step** **checked** (on)
8. **Save**
9. Still under Settings → **Deployment Protection** → turn **off** Vercel Authentication
10. **Deployments** → ⋯ on latest → **Redeploy**
11. Open **https://artificial-banking-inc-gaia10.vercel.app**

If you do not see **Root Directory**:

- You may be on the **team** settings page, not the **project** settings page — go into the project first.
- Or an old root `vercel.json` `"builds"` block is still on `main` (ignored Project Settings warning). Merge PR #21 / the branch that deleted root `vercel.json`, then refresh Settings.

Optional CI: add repo secret `VERCEL_TOKEN`, then
**Actions → Vercel harden → Run workflow** (also runs on pushes that touch the
harden script). That API call sets Root Directory without using the UI.

## Why builds used to 404 / red ✕ / “unused-build-settings”

A red ✕ on GitHub Deployments means the build **failed** or was **blocked**.
Until a deploy is **Ready**, no URL serves the app.

**Do not put a legacy `"builds"` array in a root `vercel.json`.** That forces
the old builder path and Vercel prints:

> Due to `builds` existing in your configuration file, the Build and
> Development Settings defined in your Project Settings will not apply.

Current setup (Project Settings **do** apply):

1. **No root `vercel.json`** — removed so dashboard settings are not ignored.
2. **Root Directory** = `apps/web` (Vercel setting → real path `apps/web/` in the repo).
3. **Include source files outside Root Directory** = on (monorepo `packages/*`).
4. **`apps/web/vercel.json`** — `framework: nextjs` + workspace install/build.
5. **Output Directory** empty (never `.next`).
6. **Zod ≥ 3.25** for `@hookform/resolvers`.
7. Production Branch = `main`. Hobby may **block** agent commits — Redeploy as owner.

## Why Production shows an “old” build

Vercel **Production** only deploys the **Production Branch** (almost always `main`).

| What you did | What Vercel did |
| --- | --- |
| Pushed / opened PRs on `cursor/…` branches | Preview deploys only (not Production) |
| Clicked **Redeploy** on an old Production row | Rebuilt that **same old commit** |
| Env vars changed, then Redeploy | Still the commit that row points at |

**Fix:** merge the branch you want into `main` (or change Production Branch under **Settings → Git**). Then wait for a new Production deployment whose commit message matches the tip you expect (e.g. go-live / CDP Settings).

Check: **Deployments** → filter **Production** → open the newest Ready row → confirm the **commit SHA / message** is today’s tip, not last week’s.

## API on Vercel (Bootstrap works)

Vercel can run the **money API in-process** behind same-origin `/abi-api`
(Next route embeds `@policyvault/api`, SQLite under `/tmp`). **Launch demo org /
Bootstrap** works without a separate API host.

Optional: still set `ABI_API_ORIGIN` to point at a long-lived API (Docker / VPS)
if you do not want the ephemeral `/tmp` demo database.

| Name | When |
| --- | --- |
| *(none)* | Default on Vercel — embedded API, bootstrap enabled |
| `ABI_API_ORIGIN` | Proxy to an external API instead of embedding |
| `POLICYVAULT_ALLOW_BOOTSTRAP=0` | Disable demo bootstrap on the embedded API |
| `ABI_KEY_PEPPER` | Recommended for any shared/prod deploy |

Local / Cursor still uses `npm run dev:api` + proxy to `:8787` when not on Vercel.

## Local / Cursor preview

```bash
npm run dev:api
npm run dev:web
```

Open the web port → **Bootstrap demo**.

## Gaia preview “looks like something went wrong”

That’s Cursor’s `.gaia` preview host, not Vercel. Use the canonical Vercel URL
or local `dev:web` after fixing deploy settings above.
