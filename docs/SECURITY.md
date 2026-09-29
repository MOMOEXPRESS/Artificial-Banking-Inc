# Security overview

ABI applies organization-scoped access, authenticated user sessions, second
factor checks for sensitive approvals, and policy evaluation to agent payment
requests. Budgets define spending authority, while the ledger and activity
records provide an audit trail for decisions and settlements.

## Current posture

- Local vault keys are encrypted at rest by the API. Managed custody is a
  separate roadmap item and should not be represented as enabled in this
  release.
- Authentication and budget controls have automated test coverage. Review the
  release checks before changing payment or identity behavior.
- Base Sepolia is the intended development network. A successful test-network
  run does not establish production readiness.
- ABI is software infrastructure, not a bank or a compliance certification.
  Operators remain responsible for their own legal and operational review.

## Operating guidance

Keep credentials in the hosting provider's secret manager. Limit production
access to the people who operate the service, maintain recoverable backups, and
review consequential payment activity. Do not commit secret values, customer
data, or private security assessment material to the public repository.

Use the deployment checklist to validate the running services and complete a
controlled end-to-end payment test before describing a settlement path as
verified.
