# ABI console and system review — 12 October 2026

## Scope

Inspected the live sandbox console: Overview, Treasury/Vault/Budgets, Agents/Groups, Transactions, Approvals, Policies, Ledger, Work, Insights, Webhooks, Playground and Settings. Navigation and displayed state were inspected without submitting payments, modifying customer policies, generating credentials or deleting customer data. API, ledger, funding, MCP, sessions and deployment source were reviewed; money/stress tests ran in disposable local databases.

This is an engineering review, not an independent security audit or a production-capacity guarantee. No real-fund or external-merchant payment was performed.

## Reproduced findings and fixes

| Finding                         | Evidence and correction                                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate Overview guidance     | A rotating tip plus a large five-step First success card; replaced with one compact contextual guide and Previous/Pause/Next controls                 |
| Wrong funding summary           | Treasury/Agents showed $40 shared authority while Overview showed $0 allocated; Overview now counts shared budget accounts once                       |
| False no-funds alerts           | Alert used deprecated personal balances; org response now exposes assigned-budget authority and alerts use it, including positive sub-dollar balances |
| Incomplete demo setup           | Seeded Research budget and agents had no ops group; new demos now have a linked group and memberships, without modifying existing orgs                |
| Wrong bootstrap metadata        | Returned $100 org-available after moving $40 to budget; corrected to remaining $60                                                                    |
| Sandbox labeled live            | Account chip follows actual ledger environment                                                                                                        |
| Failed chain read shown as zero | Unknown RPC results remain unknown; sandbox book balance is clearly distinguished from chain balance                                                  |
| Invented webhook success rate   | Zero deliveries showed 100% and an ungrounded trend; rate now requires completed deliveries and excludes pending events                               |
| False deletion success          | Webhook DELETE HTTP status is checked before a success message                                                                                        |
| Duplicate main landmark         | Settings main inside console main replaced with a labeled section                                                                                     |
| Tip progress inconsistency      | 7s progress bar vs 12s rotation corrected; manual controls and reduced-motion styles added                                                            |
| Stale setup copy                | Personal-wallet/CDP language replaced with actual shared authority and signer/network setup                                                           |

## Validation

Baseline suite passed: 25 web, 262 API, 7 ledger and 56 policy tests. New checks cover coherent guardian/shared-budget data; 600 local API reads/dry runs in batches of 20, with no ledger mutation; and twelve concurrent mock $5 purchases against $40 shared authority. Eight were allowed, remaining requests were blocked, funds were not overspent and reconciliation was clean.

Final local validation passed: 353 tests (25 web, 265 API, 7 ledger, 56 policy), typecheck, lint and the full production build. The five targeted funding/stress/bootstrap tests also passed after the final API edits. Hosted CI and deployment verification are checked before release; their final status is recorded in the pull request. Local timings describe only this fixture/machine and are not a production SLA.

## Remaining limits

- The observed sandbox's chain-read failed. Actual RPC configuration/availability must be checked before claiming funded settlement; the display fix does not repair the provider.
- Hosted MCP remains sandbox-only and session-bound. Persistent OAuth and dedicated framework adapters are absent.
- Signing is application-managed in this repository. Coinbase CDP configuration is not a managed-custody integration.
- (Historical, 2026-10-12) The former Render blueprint requested persistent /data storage. Render has since been retired; the API runs on Cloudflare Workers (Durable Object SQLite) and the demo seller on a Cloudflare Worker.
- SQLite and background-job ownership require a single-instance deployment assumption; local tests do not establish horizontal scaling safety.
- Real merchant payments, disputes, delivery, gas funding and network outages need a separate funded end-to-end test.
- CSS responsiveness was reviewed, but the available browser viewport is desktop; no physical-device or screen-reader certification was performed.
- Older owner/strategy documents predate current code. Prefer current routes, tests and implementation for capability claims.

See AGENT-CONNECTIONS.md for the sourced provider-neutral connection matrix.
