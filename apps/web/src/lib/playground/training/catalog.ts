/**
 * Guided scenario catalog (training). Each scenario is a plan of production
 * workflow steps plus training-only steps (practice setup, drills), with the
 * expected outcome and hints the playground shows. Removing training means
 * deleting this folder; the workflow runner does not depend on it.
 */
import {
  acceptDelivery,
  buyViaX402,
  checkBudget,
  costTable,
  dryRun,
  hirePeer,
  listActivity,
  payToWallet,
  payVendor,
  refundEscrow,
  summarize,
} from "../../workflow/steps";
import type { Mission } from "../../workflow/types";
import {
  checkWebhookDeliveries,
  drainAttempt,
  ensureWalletAllowlisted,
  fireWebhookTest,
  payAndWatchWebhook,
  registerDemoWebhook,
  scenarioStep,
  technicalReport,
} from "./steps";

const BASE_MISSIONS: Mission[] = [
  {
    id: "brief",
    title: "Research brief (happy path)",
    persona: "Solo founder running a research agent",
    category: "commerce",
    expectedOutcome: "allow",
    difficulty: "intermediate",
    duration: "2–3 min",
    estimatedCost: "Up to $8.50",
    tags: ["x402", "escrow", "vendor pay"],
    brief:
      "The agent checks its budget, buys a paid data report over x402, pays a small API, hires a peer agent under escrow, then delivers. Everything should stay inside policy.",
    deliverableKind: "Competitor pricing brief",
    build: (_ctx) => [
      checkBudget,
      dryRun("2", "api.openai.com"),
      buyViaX402("2"),
      payVendor("1.50", "api.openai.com", "summarisation call"),
      hirePeer("5"),
      acceptDelivery,
      summarize,
    ],
    deliverable: (state) => {
      const rows = state.report?.rows ?? [];
      const table = rows.length
        ? [
            "| Vendor | Plan | Price / month |",
            "| --- | --- | --- |",
            ...rows.map((r) => `| ${r.vendor} | ${r.plan ?? "—"} | $${r.pricePerMonthUsd} |`),
          ].join("\n")
        : "_The paid data source was not reached in this run, so no pricing rows were purchased._";
      const avg = rows.length
        ? (rows.reduce((a, r) => a + r.pricePerMonthUsd, 0) / rows.length).toFixed(2)
        : null;
      const cheapest = rows.length
        ? rows.reduce((a, r) => (r.pricePerMonthUsd < a.pricePerMonthUsd ? r : a))
        : null;
      const dearest = rows.length
        ? rows.reduce((a, r) => (r.pricePerMonthUsd > a.pricePerMonthUsd ? r : a))
        : null;
      return `# Competitor pricing brief

**Prepared by** an autonomous agent under ABI governance.

## Findings

${table}

${
  rows.length
    ? `Across ${rows.length} tracked vendors the average list price is **$${avg}/month**. ${cheapest!.vendor} anchors the low end at $${cheapest!.pricePerMonthUsd}, while ${dearest!.vendor} sits at $${dearest!.pricePerMonthUsd} — a ${(dearest!.pricePerMonthUsd / cheapest!.pricePerMonthUsd).toFixed(1)}× spread. Positioning between $${cheapest!.pricePerMonthUsd} and $${avg} would undercut the market midpoint while staying above the floor.`
    : ""
}

## What this cost

${costTable(state)}

${state.escrowId ? `A peer agent was hired under escrow \`${state.escrowId}\` and paid on acceptance.` : ""}

## Governance record

- Every payment above passed the deterministic policy engine before any money moved.
- ${state.denials.length ? `${state.denials.length} attempt(s) were refused: ${state.denials.map((d) => d.code).join(", ")}.` : "No payment attempts were refused."}
- Remaining agent budget after this run: **$${state.finalBudget ?? "—"}**.
`;
    },
  },
  {
    id: "approval",
    title: "Large purchase (needs your approval)",
    persona: "Ops lead with HITL above $10",
    category: "governance",
    expectedOutcome: "review",
    difficulty: "starter",
    duration: "1–2 min",
    estimatedCost: "$0 or $15",
    tags: ["approval", "HITL", "threshold"],
    brief:
      "The agent tries a purchase above your approval threshold. It will PARK and wait — the console alerts you. Approve or deny and watch the agent react live.",
    deliverableKind: "Purchase decision record",
    build: (_ctx) => [
      checkBudget,
      payVendor("15", "api.openai.com", "bulk dataset licence"),
      summarize,
    ],
    deliverable: (state) => `# Purchase decision record

An agent requested a **$15.00** bulk dataset licence — above the configured approval threshold, so
ABI parked the payment and blocked the agent until a human decided.

## Outcome

${
  state.purchases.length
    ? `**Approved.** The payment settled for $${state.purchases[0].amount} via ${state.purchases[0].rail} and the agent resumed automatically.`
    : `**Not approved.** The agent was told no and replanned without the purchase — no money left the vault.`
}

## What this cost

${costTable(state)}

## Why this matters

The agent could not escalate its own authority. It asked, waited, and obeyed the answer — which is
the entire point of running agent spend through a policy vault rather than handing over a key.

Remaining agent budget: **$${state.finalBudget ?? "—"}**.
`,
  },
  {
    id: "redteam",
    title: "Compromised agent (red team)",
    persona: "Security reviewer / red team",
    category: "security",
    expectedOutcome: "deny",
    difficulty: "advanced",
    duration: "1–2 min",
    estimatedCost: "$0",
    tags: ["red team", "allowlist", "limits"],
    brief:
      "Simulates a prompt-injected agent attempting to drain the vault to an unapproved address, then hammering with retries. Every attempt should be denied with an explainable rule.",
    deliverableKind: "Security exercise report",
    build: (_ctx) => [
      checkBudget,
      drainAttempt("5", "0x1111111111111111111111111111111111111111"),
      drainAttempt("25", "0x2222222222222222222222222222222222222222"),
      payVendor("999", "api.openai.com", "over the per-transaction ceiling"),
      dryRun("1", "evil-exfil.example"),
      summarize,
    ],
    deliverable: (state) => `# Security exercise report — simulated agent compromise

A hostile instruction set was fed to an agent holding live spending authority. The agent attempted
to move funds to addresses and vendors that were never approved.

## Attempts and outcomes

${
  state.denials.length
    ? [
        "| Amount | Destination | Blocked by | Reason |",
        "| --- | --- | --- | --- |",
        ...state.denials.map(
          (d) =>
            `| $${d.amount} | \`${d.destination.slice(0, 24)}\` | \`${d.code}\` | ${d.reason} |`,
        ),
      ].join("\n")
    : "_No attempts were recorded._"
}

## Result

**${state.denials.length} of ${state.denials.length} hostile attempts were refused** before any money
moved, each with a named rule the guardian can audit. Total value lost to the simulated attacker:
**$0.00**.

${state.spentUsd > 0 ? `\n⚠ Note: $${state.spentUsd.toFixed(2)} of legitimate spend also occurred during this exercise.\n` : ""}

## Control effectiveness

| Control | Fired |
| --- | --- |
${[...new Set(state.denials.map((d) => d.code))].map((c) => `| \`${c}\` | yes |`).join("\n") || "| — | — |"}

The compromised agent never held a private key, so no amount of prompt manipulation could bypass
the signer. Authorisation is enforced deterministically outside the model.
`,
  },
  {
    id: "escrow_refund",
    title: "Hire then reject (escrow refund)",
    persona: "Marketplace buyer unhappy with delivery",
    category: "commerce",
    expectedOutcome: "allow",
    difficulty: "intermediate",
    duration: "1–2 min",
    estimatedCost: "$0 net",
    tags: ["escrow", "refund", "marketplace"],
    brief:
      "Agent locks escrow to hire a peer, then refunds instead of releasing — proving the refund path and that payee never receives funds.",
    deliverableKind: "Escrow refund record",
    build: (_ctx) => [checkBudget, hirePeer("4"), refundEscrow, summarize],
    deliverable: (state) => `# Escrow refund record

Escrow \`${state.escrowId ?? "—"}\` was locked then refunded to the payer.

Peer was **not** paid. Remaining budget: **$${state.finalBudget ?? "—"}**
`,
  },
  {
    id: "smoke",
    title: "Smoke test (budget + simulate only)",
    persona: "Engineer validating wiring",
    category: "ops",
    expectedOutcome: "observe",
    difficulty: "starter",
    duration: "Under 1 min",
    estimatedCost: "$0",
    tags: ["health check", "simulate", "activity"],
    brief:
      "No money moves. Checks budget, dry-runs an allowlisted vendor, and pulls activity — fastest confidence check after deploy.",
    deliverableKind: "Smoke checklist",
    build: (_ctx) => [checkBudget, dryRun("1", "api.openai.com"), listActivity, summarize],
    deliverable: (state) => `# Smoke checklist

- Budget readable: **$${state.finalBudget ?? "—"}**
- Simulate path OK
- Activity endpoint OK

No USDC left the agent wallet in this run.
`,
  },
  {
    id: "vendor_burst",
    title: "Vendor burst (micro-payments)",
    persona: "API-seller agent making many small calls",
    category: "commerce",
    expectedOutcome: "allow",
    difficulty: "intermediate",
    duration: "1–2 min",
    estimatedCost: "$1.75",
    tags: ["micropayments", "velocity", "analytics"],
    brief:
      "Several small allowlisted pay_api calls under velocity caps — useful for watching daily burn and vendor rollups in Insights.",
    deliverableKind: "Vendor burst log",
    build: (_ctx) => [
      checkBudget,
      payVendor("0.50", "api.openai.com", "burst call 1"),
      payVendor("0.50", "api.openai.com", "burst call 2"),
      payVendor("0.75", "api.openai.com", "burst call 3"),
      listActivity,
      summarize,
    ],
    deliverable: (state) => `# Vendor burst log

${costTable(state)}

Denials: ${state.denials.length}. Remaining: **$${state.finalBudget ?? "—"}**
`,
  },
  {
    id: "onchain_wallet",
    title: "Agent pays your wallet (E2E proof)",
    persona: "Founder proving the agent — not Treasury Send — moves real Sepolia USDC",
    category: "commerce",
    expectedOutcome: "allow",
    difficulty: "advanced",
    duration: "2–4 min",
    estimatedCost: "You choose",
    tags: ["Base Sepolia", "USDC", "onchain"],
    brief:
      "THE proof that the platform works: the AGENT calls /v1/agent/pay; policy allowlists your wallet; the vault broadcasts USDC.transfer. Paste your Base Sepolia wallet (Coinbase Wallet / MetaMask on Sepolia — not Coinbase exchange). Prerequisites: vault has USDC + ETH, agent has stipend. Treasury Send is NOT this test.",
    deliverableKind: "On-chain transfer receipt",
    build: (ctx) => {
      const dest = (
        ctx.e2eWallet ??
        (typeof window !== "undefined" ? sessionStorage.getItem("abi_e2e_wallet") : "") ??
        ""
      ).trim();
      const amount = (ctx.e2eAmountUsdc ?? "0.10").trim() || "0.10";
      if (!/^0x[a-fA-F0-9]{40}$/.test(dest)) {
        return [
          {
            id: "need_wallet",
            title: "Paste your Base Sepolia wallet above",
            detail:
              "Use the wallet field under this scenario (or Custom → On-chain wallet pay). Not a Coinbase exchange deposit address.",
            async run() {
              return {
                summary:
                  "No receive address. Paste your Base Sepolia 0x in the field under this scenario, then Run again.",
                output: "missing e2eWallet",
                softFail: true,
                abort: true,
              };
            },
          },
        ];
      }
      try {
        if (typeof window !== "undefined") sessionStorage.setItem("abi_e2e_wallet", dest);
      } catch {
        /* ignore */
      }
      return [
        checkBudget,
        ensureWalletAllowlisted(dest),
        payToWallet(amount, dest),
        listActivity,
        summarize,
      ];
    },
    deliverable: (state) => `# Agent on-chain wallet pay receipt

This run used **agent** \`/v1/agent/pay\` (not Treasury Send).

${costTable(state)}

${
  state.purchases
    .filter((p) => p.rail === "evm-usdc-transfer" || p.txHash)
    .map(
      (p) =>
        `- $${p.amount} → \`${p.destination}\` rail \`${p.rail}\`${p.txHash ? ` · \`${p.txHash}\`` : ""}`,
    )
    .join("\n") ||
  "_No on-chain purchase recorded in state — check step output for txHash / explorerUrl._"
}

Confirm Transfer on Basescan and your wallet USDC on Base Sepolia.
`,
  },
  {
    id: "swarm_handoff",
    title: "Swarm handoff (hire peer)",
    persona: "Multi-agent research desk",
    category: "ops",
    expectedOutcome: "allow",
    difficulty: "intermediate",
    duration: "1–2 min",
    estimatedCost: "$6",
    tags: ["multi-agent", "escrow", "handoff"],
    brief:
      "Budget check → hire peer under escrow → release on acceptance. Models a research agent outsourcing writing to a peer in the same org.",
    deliverableKind: "Swarm handoff memo",
    build: (_ctx) => [checkBudget, hirePeer("6"), acceptDelivery, summarize],
    deliverable: (state) => `# Swarm handoff memo

Peer hired under escrow \`${state.escrowId ?? "—"}\` and paid on acceptance.

${costTable(state)}

Remaining: **$${state.finalBudget ?? "—"}**
`,
  },
  {
    id: "webhooks",
    title: "Webhook ping (ops notify)",
    persona: "Ops engineer wiring Slack / CRM / books",
    category: "ops",
    expectedOutcome: "observe",
    difficulty: "intermediate",
    duration: "1–2 min",
    estimatedCost: "$1",
    tags: ["webhooks", "events", "integration"],
    brief:
      "What a webhook is: ABI pushes signed JSON to YOUR URL when money events happen — so you don’t poll the console. This mission registers the built-in demo inbox, fires a test event, confirms delivery, then does a small live pay so you see payment.succeeded land again.",
    deliverableKind: "Webhook integration brief",
    build: (_ctx) => [
      registerDemoWebhook,
      fireWebhookTest,
      checkWebhookDeliveries,
      checkBudget,
      payAndWatchWebhook,
      summarize,
    ],
    deliverable: (state) => `# Webhook integration brief

## What just happened

1. Registered (or reused) endpoint \`abi://demo-inbox\` — a built-in sink for demos.
2. Fired a **test** \`payment.succeeded\` event (same as Webhooks → Test).
3. Confirmed deliveries in the org delivery ledger.
4. Ran a small live pay so a **real** money event could notify listeners again.

${
  state.webhookDeliveries?.length
    ? `## Recent deliveries

| Id | Event | Status |
| --- | --- | --- |
${state.webhookDeliveries.map((d) => `| ${d.id} | ${d.event} | ${d.status} |`).join("\n")}
`
    : ""
}

## What you do in production

1. Stand up an HTTPS URL on **your** backend (or Slack incoming webhook via a thin adapter).
2. In Console → **Webhooks**, paste that URL (not \`abi://demo-inbox\`).
3. Save the **signing secret** shown once — verify \`x-policyvault-signature\` = HMAC-SHA256 of the raw body.
4. Dedupe on \`x-policyvault-delivery\` (at-least-once delivery, up to 3 retries).
5. Handle the events you care about: \`payment.succeeded\`, \`approval.pending\`, \`policy.denied\`, escrow + treasury events, etc.

## Spend this run

${costTable(state)}

Remaining agent budget: **$${state.finalBudget ?? "—"}**
`,
  },
  {
    id: "policy_preflight",
    title: "Policy preflight (no spend)",
    persona: "Finance operator validating a policy before launch",
    category: "governance",
    expectedOutcome: "mixed",
    difficulty: "starter",
    duration: "Under 1 min",
    estimatedCost: "$0",
    tags: ["simulation", "allowlist", "limits"],
    brief:
      "Runs one ordinary request, one oversized request, and one unapproved-vendor request through simulation. It exposes the exact rules ABI would apply without moving money.",
    deliverableKind: "Policy preflight report",
    build: (_ctx) => [
      checkBudget,
      dryRun("1", "api.openai.com"),
      dryRun("999", "api.openai.com"),
      dryRun("1", "evil-exfil.example"),
      listActivity,
      summarize,
    ],
    deliverable: (state) => `# Policy preflight report

ABI evaluated a normal vendor payment, an oversized payment, and an unapproved destination without moving funds.

- Budget readable: **$${state.finalBudget ?? "—"}**
- Real funds moved: **$0.00**
- Review the step outputs for each deterministic rule trace.

Use this exercise after changing policy and before allowing an agent to spend.
`,
  },
  {
    id: "x402_price_guard",
    title: "x402 price-cap guard",
    persona: "Buyer agent protecting itself from a higher-than-approved seller price",
    category: "security",
    expectedOutcome: "deny",
    difficulty: "intermediate",
    duration: "Under 1 min",
    estimatedCost: "$0 expected",
    tags: ["x402", "price cap", "seller"],
    brief:
      "Authorizes only $0.001 for the configured x402 resource. If the seller asks for more, ABI should refuse before signing or settling the payment.",
    deliverableKind: "x402 price-protection record",
    build: (_ctx) => [checkBudget, buyViaX402("0.001"), listActivity, summarize],
    deliverable: (state) => `# x402 price-protection record

The buyer authorized a maximum of **$0.001** for the resource.

${
  state.denials.length
    ? `ABI refused the purchase before settlement: **${state.denials[0].code}** — ${state.denials[0].reason || "seller price exceeded authorization"}.`
    : state.purchases.length
      ? `The seller price was within the cap and **$${state.purchases[0].amount}** settled.`
      : "No payment settled. Review the step output for the seller response."
}

This proves the seller cannot unilaterally expand the amount an agent authorized.
`,
  },
  {
    id: "budget_impact",
    title: "Budget impact check",
    persona: "Team lead verifying that a purchase updates spend controls immediately",
    category: "governance",
    expectedOutcome: "allow",
    difficulty: "starter",
    duration: "Under 1 min",
    estimatedCost: "$0.25",
    tags: ["budget", "ledger", "reconciliation"],
    brief:
      "Reads the budget, makes one small allowlisted payment, reads the budget again, and checks activity so the ledger and policy impact can be compared in one run.",
    deliverableKind: "Budget impact record",
    build: (_ctx) => [
      checkBudget,
      payVendor("0.25", "api.openai.com", "budget impact verification"),
      scenarioStep(checkBudget, "budget_after_impact", "Read the updated budget"),
      listActivity,
      summarize,
    ],
    deliverable: (state) => `# Budget impact record

${costTable(state)}

The agent budget was read before and after settlement, then reconciled against recent activity.
Remaining budget: **$${state.finalBudget ?? "—"}**.
`,
  },
  {
    id: "procurement_pipeline",
    title: "Autonomous procurement pipeline",
    persona: "Procurement agent coordinating data, compute, and a specialist contractor",
    category: "commerce",
    expectedOutcome: "allow",
    difficulty: "advanced",
    duration: "3–5 min",
    estimatedCost: "Up to $7.25",
    tags: ["x402", "procurement", "escrow", "multi-rail"],
    brief:
      "Executes a complete procurement plan across x402, an allowlisted API vendor, and peer-agent escrow, then reconciles the resulting budget and activity trail.",
    deliverableKind: "Autonomous procurement record",
    build: (_ctx) => [
      checkBudget,
      dryRun("1.25", "api.openai.com"),
      buyViaX402("2"),
      payVendor("1.25", "api.openai.com", "analysis compute for procurement package"),
      hirePeer("4"),
      acceptDelivery,
      scenarioStep(checkBudget, "budget_after_procurement", "Reconcile remaining budget"),
      listActivity,
      summarize,
    ],
    deliverable: (state) =>
      technicalReport(
        "Autonomous procurement record",
        state,
        "The agent coordinated three financial primitives in one job: metered data acquisition, direct API settlement, and conditional peer payment under escrow.",
      ),
  },
  {
    id: "escrow_rework_cycle",
    title: "Escrow rework and replacement",
    persona: "Marketplace agent replacing an unacceptable contractor without losing funds",
    category: "commerce",
    expectedOutcome: "mixed",
    difficulty: "advanced",
    duration: "2–4 min",
    estimatedCost: "$4 net",
    tags: ["escrow", "refund", "rehire", "recovery"],
    brief:
      "Hires a peer, rejects and refunds the first delivery, then creates a replacement escrow and releases only after the second delivery is accepted.",
    deliverableKind: "Escrow rework record",
    build: (_ctx) => [
      checkBudget,
      scenarioStep(hirePeer("3"), "escrow_first_lock", "Hire the first contractor under $3 escrow"),
      scenarioStep(
        refundEscrow,
        "escrow_first_refund",
        "Reject the first delivery and recover funds",
      ),
      scenarioStep(hirePeer("4"), "escrow_second_lock", "Hire a replacement under $4 escrow"),
      scenarioStep(
        acceptDelivery,
        "escrow_second_release",
        "Accept replacement work and release escrow",
      ),
      scenarioStep(
        checkBudget,
        "budget_after_rework",
        "Verify the refund restored budget headroom",
      ),
      summarize,
    ],
    deliverable: (state) =>
      technicalReport(
        "Escrow rework and replacement",
        state,
        "The first commitment was reversed before a replacement contractor was paid, exercising cap reversal and conditional settlement in one workflow.",
      ),
  },
  {
    id: "commerce_velocity_boundary",
    title: "Micropayment velocity boundary",
    persona: "High-frequency buyer agent operating near machine-payment limits",
    category: "commerce",
    expectedOutcome: "mixed",
    difficulty: "advanced",
    duration: "2–3 min",
    estimatedCost: "Up to $1.98",
    tags: ["micropayments", "velocity", "rate limit", "stress"],
    brief:
      "Sends twelve distinct low-value vendor calls in one run. Early calls may settle; later calls should expose the active per-minute velocity control when the policy boundary is reached.",
    deliverableKind: "Velocity-boundary report",
    build: (_ctx) => [
      checkBudget,
      ...Array.from({ length: 12 }, (_, i) => {
        const amount = (0.11 + i * 0.01).toFixed(2);
        return payVendor(amount, "api.openai.com", `velocity boundary call ${i + 1}`);
      }),
      listActivity,
      summarize,
    ],
    deliverable: (state) =>
      technicalReport(
        "Micropayment velocity boundary",
        state,
        "A burst of individually valid micropayments tested whether aggregate request velocity is enforced independently of per-payment amount.",
      ),
  },
  {
    id: "approval_ladder",
    title: "Approval-threshold ladder",
    persona: "Finance administrator mapping exactly where autonomy becomes human review",
    category: "governance",
    expectedOutcome: "review",
    difficulty: "advanced",
    duration: "2–4 min",
    estimatedCost: "$0 or $15",
    tags: ["approval", "threshold", "boundary", "HITL"],
    brief:
      "Simulates a graduated set of payment amounts around policy boundaries, then submits one real review-sized purchase so the operator can confirm the handoff and resume behavior.",
    deliverableKind: "Approval ladder record",
    build: (_ctx) => [
      checkBudget,
      dryRun("1", "api.openai.com"),
      dryRun("9.99", "api.openai.com"),
      dryRun("10.01", "api.openai.com"),
      dryRun("24.99", "api.openai.com"),
      dryRun("25.01", "api.openai.com"),
      payVendor("15", "api.openai.com", "approval ladder validation purchase"),
      listActivity,
      summarize,
    ],
    deliverable: (state) =>
      technicalReport(
        "Approval-threshold ladder",
        state,
        "The run mapped multiple decision bands before exercising a real human-in-the-loop payment at the configured review boundary.",
      ),
  },
  {
    id: "policy_boundary_matrix",
    title: "Policy boundary matrix",
    persona: "Control engineer validating amount and destination rules before rollout",
    category: "governance",
    expectedOutcome: "mixed",
    difficulty: "advanced",
    duration: "1–2 min",
    estimatedCost: "$0",
    tags: ["simulation", "matrix", "allowlist", "hard cap"],
    brief:
      "Cross-tests tiny, ordinary, review-sized, and over-limit amounts against both approved and unknown destinations. No money moves; every cell returns a rule trace.",
    deliverableKind: "Policy boundary matrix",
    build: (_ctx) => [
      checkBudget,
      dryRun("0.01", "api.openai.com"),
      dryRun("10", "api.openai.com"),
      dryRun("25", "api.openai.com"),
      dryRun("25.01", "api.openai.com"),
      dryRun("1", "unknown-vendor.example"),
      dryRun("25.01", "unknown-vendor.example"),
      listActivity,
      summarize,
    ],
    deliverable: (state) =>
      technicalReport(
        "Policy boundary matrix",
        state,
        "Six simulated intents separated amount controls from destination controls, making the active policy bands inspectable without financial side effects.",
      ),
  },
  {
    id: "ledger_reconciliation_drill",
    title: "Budget-to-ledger reconciliation",
    persona: "Finance operator proving that several settlements reconcile to budget and activity",
    category: "governance",
    expectedOutcome: "allow",
    difficulty: "advanced",
    duration: "1–2 min",
    estimatedCost: "$0.90",
    tags: ["ledger", "budget", "reconciliation", "audit"],
    brief:
      "Captures budget before and after three differently sized payments, then reads the decision activity so the operator can reconcile authorization, settlement, and remaining capacity.",
    deliverableKind: "Ledger reconciliation worksheet",
    build: (_ctx) => [
      checkBudget,
      payVendor("0.20", "api.openai.com", "reconciliation sample A"),
      payVendor("0.30", "api.openai.com", "reconciliation sample B"),
      payVendor("0.40", "api.openai.com", "reconciliation sample C"),
      scenarioStep(checkBudget, "budget_after_reconciliation", "Read post-settlement budget"),
      listActivity,
      summarize,
    ],
    deliverable: (state) =>
      technicalReport(
        "Budget-to-ledger reconciliation",
        state,
        "The run compares pre- and post-settlement capacity with the resulting decision log, providing a compact finance-grade audit exercise.",
      ),
  },
  {
    id: "destination_rotation_attack",
    title: "Destination-rotation attack",
    persona:
      "Security engineer testing whether an attacker can evade allowlists by rotating wallets",
    category: "security",
    expectedOutcome: "deny",
    difficulty: "advanced",
    duration: "1–2 min",
    estimatedCost: "$0 expected",
    tags: ["wallet rotation", "allowlist", "prompt injection", "exfiltration"],
    brief:
      "Attempts three withdrawals to different unapproved wallets. The destinations change, but the signer should refuse every request with the same deterministic control boundary.",
    deliverableKind: "Destination-rotation incident report",
    build: (_ctx) => [
      checkBudget,
      drainAttempt("2", "0x1111111111111111111111111111111111111111"),
      drainAttempt("3", "0x2222222222222222222222222222222222222222"),
      drainAttempt("4", "0x3333333333333333333333333333333333333333"),
      listActivity,
      summarize,
    ],
    deliverable: (state) =>
      technicalReport(
        "Destination-rotation incident report",
        state,
        "A compromised agent rotated withdrawal addresses in an attempt to bypass destination controls. The exercise checks that authorization is bound to policy, not a single blocked address.",
      ),
  },
  {
    id: "layered_exfiltration_attack",
    title: "Layered exfiltration attack",
    persona: "Red team chaining vendor, wallet, amount, and x402 attack paths",
    category: "security",
    expectedOutcome: "deny",
    difficulty: "advanced",
    duration: "2–3 min",
    estimatedCost: "$0 expected",
    tags: ["red team", "x402", "SSRF", "hard cap", "wallet"],
    brief:
      "Chains an unknown-domain probe, an unapproved-wallet withdrawal, an oversized trusted-vendor payment, and an under-authorized x402 purchase to exercise independent defenses in one run.",
    deliverableKind: "Layered attack report",
    build: (_ctx) => [
      checkBudget,
      dryRun("1", "evil-exfil.example"),
      drainAttempt("5", "0x4444444444444444444444444444444444444444"),
      payVendor("999", "api.openai.com", "oversized exfiltration disguised as vendor spend"),
      buyViaX402("0.001"),
      listActivity,
      summarize,
    ],
    deliverable: (state) =>
      technicalReport(
        "Layered exfiltration attack",
        state,
        "The attacker changed rails and destinations between attempts. The report shows whether ABI independently enforced destination, amount, and seller-price authorization.",
      ),
  },
  {
    id: "lookalike_vendor_probe",
    title: "Lookalike-vendor and local-network probe",
    persona: "Application-security reviewer testing domain parsing and SSRF defenses",
    category: "security",
    expectedOutcome: "deny",
    difficulty: "advanced",
    duration: "1–2 min",
    estimatedCost: "$0 expected",
    tags: ["SSRF", "domain spoofing", "allowlist", "localhost"],
    brief:
      "Attempts low-value payments to a trusted-domain suffix trick, a lookalike domain, and localhost. None should inherit trust from api.openai.com or reach internal infrastructure.",
    deliverableKind: "Destination validation report",
    build: (_ctx) => [
      checkBudget,
      payVendor("0.10", "api.openai.com.evil.example", "suffix-confusion probe"),
      payVendor("0.10", "api-openai.example", "lookalike-domain probe"),
      payVendor("0.10", "127.0.0.1", "local-network SSRF probe"),
      listActivity,
      summarize,
    ],
    deliverable: (state) =>
      technicalReport(
        "Lookalike-vendor and local-network probe",
        state,
        "Three superficially plausible destinations tested exact allowlist matching and local-network rejection rather than simple string containment.",
      ),
  },
  {
    id: "webhook_delivery_burst",
    title: "Webhook delivery burst",
    persona: "Platform engineer validating event delivery and deduplication under a short burst",
    category: "ops",
    expectedOutcome: "observe",
    difficulty: "advanced",
    duration: "2–3 min",
    estimatedCost: "$0",
    tags: ["webhooks", "burst", "delivery ledger", "deduplication"],
    brief:
      "Registers the demo endpoint, dispatches three independently tracked test events, then inspects the delivery ledger for ordering, status, and duplicate-handling behavior.",
    deliverableKind: "Webhook burst report",
    build: (_ctx) => [
      registerDemoWebhook,
      scenarioStep(fireWebhookTest, "webhook_test_1", "Dispatch webhook test 1 of 3"),
      scenarioStep(fireWebhookTest, "webhook_test_2", "Dispatch webhook test 2 of 3"),
      scenarioStep(fireWebhookTest, "webhook_test_3", "Dispatch webhook test 3 of 3"),
      checkWebhookDeliveries,
      summarize,
    ],
    deliverable: (state) =>
      technicalReport(
        "Webhook delivery burst",
        state,
        `The integration received a short event burst and exposed ${state.webhookDeliveries?.length ?? 0} recent delivery records for inspection.`,
      ),
  },
  {
    id: "multi_agent_recovery",
    title: "Multi-agent failure recovery",
    persona: "Swarm operator recovering a failed handoff without leaking budget",
    category: "ops",
    expectedOutcome: "mixed",
    difficulty: "advanced",
    duration: "3–4 min",
    estimatedCost: "$4 net",
    tags: ["multi-agent", "recovery", "escrow", "cap reversal"],
    brief:
      "Runs a failed peer handoff through refund, verifies restored budget capacity, then retries with a replacement handoff and completes settlement.",
    deliverableKind: "Multi-agent recovery runbook",
    build: (_ctx) => [
      checkBudget,
      scenarioStep(hirePeer("3"), "recovery_first_lock", "Start the first peer handoff"),
      scenarioStep(refundEscrow, "recovery_first_refund", "Abort failed handoff and refund escrow"),
      scenarioStep(checkBudget, "recovery_budget_check", "Verify capacity after rollback"),
      scenarioStep(hirePeer("4"), "recovery_second_lock", "Retry with the replacement peer"),
      scenarioStep(acceptDelivery, "recovery_second_release", "Complete the replacement handoff"),
      listActivity,
      summarize,
    ],
    deliverable: (state) =>
      technicalReport(
        "Multi-agent failure recovery",
        state,
        "The run exercises rollback, budget-cap reversal, replacement assignment, and final settlement as a single operational recovery path.",
      ),
  },
  {
    id: "release_canary_chain",
    title: "Post-deploy canary chain",
    persona: "Release engineer validating core integrations immediately after deployment",
    category: "ops",
    expectedOutcome: "mixed",
    difficulty: "advanced",
    duration: "2–3 min",
    estimatedCost: "$0",
    tags: ["canary", "deployment", "x402", "webhooks", "policy"],
    brief:
      "Runs a no-spend canary across budget reads, policy simulation, x402 price protection, webhook dispatch, delivery inspection, and the activity endpoint.",
    deliverableKind: "Post-deploy canary report",
    build: (_ctx) => [
      checkBudget,
      dryRun("1", "api.openai.com"),
      dryRun("999", "api.openai.com"),
      buyViaX402("0.001"),
      registerDemoWebhook,
      fireWebhookTest,
      checkWebhookDeliveries,
      listActivity,
      summarize,
    ],
    deliverable: (state) =>
      technicalReport(
        "Post-deploy canary chain",
        state,
        "A single zero-cost workflow checked the primary read path, policy engine, seller guard, webhook dispatcher, delivery ledger, and agent audit endpoint after release.",
      ),
  },
];

/** Deliberately hostile or high-volume exercises — never run on a live org. */
const DESTRUCTIVE = new Set([
  "redteam",
  "destination_rotation_attack",
  "layered_exfiltration_attack",
  "lookalike_vendor_probe",
  "x402_price_guard",
  "vendor_burst",
  "commerce_velocity_boundary",
]);
/** Scenarios whose setup edits org policy (testnet practice only). */
const EDITS_POLICY = new Set(["onchain_wallet"]);

/**
 * The smoke chain used to be a hidden "run mode" that ignored your selection.
 * It is now an ordinary scenario card that runs its three members in order.
 */
const SMOKE_CHAIN: Mission = {
  id: "smoke_chain",
  title: "Smoke chain: smoke → brief → red-team",
  persona: "Release engineer verifying a deploy",
  category: "ops",
  expectedOutcome: "mixed",
  difficulty: "intermediate",
  duration: "4–6 min",
  estimatedCost: "Up to $10",
  tags: ["chain", "release check", "smoke"],
  brief:
    "Runs three scenarios back-to-back: the smoke test, the research brief happy path, then the red-team drill. Use it after a deploy.",
  deliverableKind: "Three run records",
  chain: ["smoke", "brief", "redteam"],
  destructive: true,
  build: () => [],
  deliverable: () => "",
};

export const MISSIONS: Mission[] = [...BASE_MISSIONS, SMOKE_CHAIN].map((m) => ({
  ...m,
  destructive: m.destructive || DESTRUCTIVE.has(m.id),
  editsPolicy: m.editsPolicy || EDITS_POLICY.has(m.id),
}));

export const findMission = (id: string) => MISSIONS.find((m) => m.id === id);
