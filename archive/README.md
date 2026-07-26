# Archive

Code kept for reference that is **not** part of the build, not a workspace, and
not covered by CI or linting. Nothing here is wired into the running product.

Anything in this directory is either waiting on a roadmap decision or preserved
because deleting it would lose the only work of its kind in the repository.

| Path | Status | Decision owed |
|------|--------|---------------|
| `mobile-expo/` | Expo companion app for approve-on-the-go. Never added to `workspaces`, absent from the lockfile, excluded from `npm run build`. Push notifications are unimplemented, so with a 10-minute default approval TTL it cannot serve its purpose as written. | Roadmap **P9-T6** — ship it properly with push, or delete it and keep the `/approvals` web route as the mobile surface. |

To revive something from here, move it back to `apps/` or `packages/`, add it to
the root `workspaces` array, and remove its ignore entry from `eslint.config.mjs`.
