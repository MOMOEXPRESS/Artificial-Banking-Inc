# Vercel deploy (Console / Next.js)

## Production URL

**https://artificial-banking-inc-web.vercel.app** is the current production
domain. Older `gaia10` and short aliases are stale and must not be used in
launch material. Confirm the current domain under the Vercel project's
**Settings → Domains** if the project is moved or renamed.

## Release checks

1. Open the project that owns the current production domain under Vercel
   **Settings → Domains**. This repository has used more than one Vercel project
   name, so verify the actual owner in the dashboard rather than assuming an old
   team or project slug.
2. Confirm the newest Production deployment points to the expected `main`
   commit and has status **Ready**.
3. If the app shows a Vercel sign-in wall, check Deployment Protection and
   confirm the intended audience before changing it. Turning protection off is
   an access-control change, not a routine 404 fix.
4. The Next.js project root is `apps/web`; workspace packages outside that
   directory must be included in the build.
5. The API is a separate persistent service; use the `/abi-api` proxy and set
   `ABI_API_ORIGIN` on the correct Vercel project.

The legacy `scripts/vercel-harden.mjs` defaults refer to an older project and
can disable Deployment Protection. Do not run it as a release step. Confirm the
current domain and project in the dashboard first.

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

| What you did                                  | What Vercel did                       |
| --------------------------------------------- | ------------------------------------- |
| Pushed / opened PRs on `cursor/…` branches    | Preview deploys only (not Production) |
| Clicked **Redeploy** on an old Production row | Rebuilt that **same old commit**      |
| Env vars changed, then Redeploy               | Still the commit that row points at   |

**Fix:** merge the branch you want into `main` (or change Production Branch under **Settings → Git**). Then wait for a new Production deployment whose commit message matches the tip you expect (e.g. go-live / CDP Settings).

Check: **Deployments** → filter **Production** → open the newest Ready row → confirm the **commit SHA / message** is today’s tip, not last week’s.

## API proxy

Vercel hosts the console; it proxies `/abi-api/*` to a separate long-lived API.
The API needs persistent storage. Without the upstream origin, the console
returns `API_NOT_CONFIGURED` and account, demo, and payment workflows are not
available.

| Name                            | When                                                                      |
| ------------------------------- | ------------------------------------------------------------------------- |
| `ABI_API_ORIGIN`                | Required on Vercel; URL of the persistent API service                     |
| `ABI_SIGNUP_TOKEN`              | Optional private registration gate; keep consistent across API and Vercel |
| `POLICYVAULT_ALLOW_BOOTSTRAP=1` | Enable isolated demo-org creation; `0` disables it                        |
| `ABI_KEY_PEPPER`                | Required on the API service for hashed credentials                        |
| `ABI_KEK`                       | Required on the API service to encrypt vault keys at rest                 |

The console calls `GET /abi-api/v1/demo/status` and hides the demo action when
the deployment or registration gate disables it. Check API health, email
delivery, persistent disk, and backups in the service dashboard; Vercel Ready
alone does not verify those systems.

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
