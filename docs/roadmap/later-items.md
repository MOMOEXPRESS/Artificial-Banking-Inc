# Later items (not implemented)

These three items came out of the October 2026 review. They are deliberately
**not** built yet; this note records the intended shape so the work can be
picked up without re-deriving the reasoning. Nothing here is a commitment to a
date.

## 1. A `suspended` escrow state

Today an escrow is `locked` until it is `released` to the payee or `refunded`
to the payer, and either verb can be called by the agent that locked it (within
policy) or resolved by a guardian. That leaves no clean way to say "stop — nobody
moves this money until we have looked at it" during a dispute or an incident.
Freezing the org or agent is too blunt (it stops all spend), and refunding
early destroys the evidence that the counterparty was owed something.

The proposal is a fourth state, `suspended`, reachable from `locked` by a
guardian (or by an automation rule such as "counterparty risk score jumped" or
"payee appeared on the blocklist"). While suspended, release and refund both
return a structured refusal (`ruleIds: ["escrow_suspended"]`, with the
suspension reason and who set it), the held balance stays on the escrow's held
account, and any expiry timer is paused rather than allowed to auto-refund.
Leaving the state requires a guardian decision, recorded and signed like every
other decision, that resumes the escrow to `locked` or resolves it directly.

Open questions: whether suspension should need quorum when the escrow is above
the HITL band; how a suspended escrow is shown to the payee agent (it should
see "suspended", not "pending"); and whether the Worker deployment needs a
durable timer change so paused expiry survives restarts.

## 2. Agent identity standard: Visa TAP vs ERC-8004

ABI identifies agents with its own `pv_agent_` keys and session keys. That is
enough inside one org, but merchants and other agents increasingly want to
verify _who_ is paying without calling ABI. Two candidate standards:

- **Visa Trusted Agent Protocol (TAP)** — agents sign HTTP requests with keys
  registered to a known agent provider, so merchants (and card networks) can
  tell a sanctioned shopping agent from a scraper. Strong fit for card and
  commerce rails, merchant tooling already exists, and it maps directly onto
  our HTTP `pay_api` path. It is centralised around the network's registry.
- **ERC-8004 (Trustless Agents)** — on-chain identity, reputation and
  validation registries for agents. Strong fit for x402 / USDC rails and
  agent-to-agent payments where there is no card network in the loop, and it
  composes with the signed decision receipts we now emit (a receipt hash could
  be posted as validation evidence). The standard is still young and registries
  cost gas to write.

Current leaning: do not pick one exclusively. Keep ABI's own key as the
authority for _policy_ (only a guardian-controlled key can move money), and
add an optional, verifiable identity binding per agent: a TAP key for HTTP
commerce and an ERC-8004 identity for on-chain counterparties. The first step
is a read-only `identity` block on the agent profile and in decision receipts,
with no change to authorisation, so we can see what merchants actually ask for
before committing.

## 3. Approval-fatigue metrics

Human-in-the-loop only works if humans still read what they approve. If a
guardian approves 200 parked payments a day in under three seconds each, the
review band has become a rubber stamp and the policy is giving false comfort.

We already record every approval with its timestamps and resolver, so the
metrics are cheap to derive: time from park to decision (median and p10, since
very fast approvals matter most), approvals per guardian per day, approve rate
by rule that triggered review, the share of approvals later followed by a
refund, dispute or freeze, and how often the post-approval re-check refused
something a human had approved. Shown on the console insights page and sent in
the weekly digest, these let an operator see when a threshold is set too low
(lots of trivial reviews) or when one person is carrying the whole queue.

Later, the same signals can drive suggestions rather than just charts: "92% of
reviews for `merchant_unknown` on api.openai.com were approved in under five
seconds — allowlist it?" Any such suggestion must stay a guardian action;
the engine should never loosen its own policy on the strength of these metrics.
