# ABI Product Roadmap

This roadmap summarizes the product's development direction. For current
implementation status, see [`NEXT-BUILD-PLAN.md`](NEXT-BUILD-PLAN.md) and
[`DEPLOY.md`](DEPLOY.md).

## Product goal

Artificial Banking Incorporated (ABI) gives AI agents controlled access to
funds. Organizations set budgets, merchant restrictions, approval rules, and
spending limits; ABI evaluates proposed payments and records decisions for
review.

## Recently delivered

- Organization accounts, signup email verification, and authenticated access.
- Agent budgets with organization-level authority limits.
- Payment policy checks, approvals, and activity records.
- Console improvements and operational documentation.

## Next priorities

1. **Validate custody and settlement.** Complete controlled test-network checks
   for wallet creation, signing, payment submission, and confirmation.
2. **Prove end-to-end settlement.** Run controlled Base Sepolia payment tests,
   confirm settlement records, and document the supported payment flow.
3. **Strengthen production operations.** Finish persistent data-store work,
   tenant isolation, monitoring, recovery procedures, and deployment checks.
4. **Improve agent controls.** Complete lifecycle management, policy overrides,
   and integrations for connecting external agents.
5. **Prepare developer distribution.** Publish SDK documentation, sample
   integrations, and a clear sandbox onboarding flow.
6. **Prepare for broader launch.** Review accessibility, compliance needs,
   support processes, reliability, and billing before expanding availability.

## Release principles

- Keep product and documentation claims aligned with shipped behavior.
- Require explicit authorization for consequential spending actions.
- Preserve clear, reviewable records of policy decisions and payment outcomes.
- Validate changes with automated tests and controlled environment checks.
- Treat test-network results as development evidence, not proof of production
  readiness.

This document is a high-level planning aid. Detailed internal security reviews
and operational findings belong in restricted engineering channels, not in
public product documentation.
