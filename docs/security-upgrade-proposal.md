# Security dependency migration proposal

Automatic approval review blocked the original broad upgrade because it included major versions and workspace graph changes without compatibility evidence. This proposal is for an explicit, tested compatibility migration, not a forced audit fix.

1. Upgrade Next.js 15.5.29 to 16.4.5 and its ESLint plugin together. Adapt removed Next configuration or route APIs if required; run production build, typecheck and a browser sign-in/console smoke check before release.
2. Upgrade Zod 3.25.76 to 4.6.7 across API, shared schemas, MCP and web. Adapt record schemas, error/type assumptions and validation defaults. Verify invalid and oversized inputs still fail closed and run the complete API/payment/schema suite.
3. Upgrade x402 packages together from 2.28 to 2.30. Verify challenge validation, facilitator and signing tests; do not change networks, custody keys or facilitator configuration.
4. Apply patched transitive dependencies only after checking their parent compatibility. Do not silently change payment behavior to clear an audit report.
5. Remove unused Prisma tooling from the active root workspace dependency graph while preserving its future-Postgres schema and files. Current runtime is SQLite; no data is migrated or deleted. Update the optional generate command and architecture documentation.

Release gate: successful full build, typecheck, regression suite, credential scan, npm audit and desktop/mobile checks. Failed compatibility changes stay off production. No secret rotation, Git history rewrite, real payment, destructive database migration or custody change is part of this proposal.
