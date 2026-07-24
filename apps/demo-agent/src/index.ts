/**
 * Demo agent: how any agent connects to PolicyVault.
 *
 * The agent never sees keys or the vault — it only calls money "verbs"
 * (pay_api, escrow_lock, ...) with its Bearer API key. Every verb passes the
 * policy engine; denials come back as recoverable errors the agent can plan
 * around, and big spends park in the guardian's approval inbox.
 *
 * Env:
 *   POLICYVAULT_API_URL   default http://localhost:8787
 *   POLICYVAULT_API_KEY   agent API key (from POST /v1/guardian/agents or bootstrap)
 *   PAYEE_AGENT_ID        optional — same-org agent to hire via escrow
 */
import { PolicyVaultApiError, PolicyVaultClient } from "@policyvault/sdk";

const baseUrl = process.env.POLICYVAULT_API_URL ?? "http://localhost:8787";
const apiKey = process.env.POLICYVAULT_API_KEY ?? "";
const payeeAgentId = process.env.PAYEE_AGENT_ID;

if (!apiKey) {
  console.error("Set POLICYVAULT_API_KEY (create an agent via POST /v1/guardian/agents).");
  process.exit(1);
}

const vault = new PolicyVaultClient({ baseUrl, apiKey });
const idem = (tag: string) => `demo_${tag}_${Date.now()}`;
const log = (step: string, data: unknown) =>
  console.log(`\n== ${step} ==\n${JSON.stringify(data, null, 2)}`);

// 1. Know your budget before planning paid work.
const budget = await vault.getBudget();
log("budget", budget);
if (parseFloat(budget.availableUsdc) < 5) {
  console.error(
    "\nAgent has less than $5 allocated. Ask the guardian to allocate a stipend first\n" +
      "(web console 'Allocate to Researcher' or POST /v1/guardian/allocate).",
  );
  process.exit(1);
}

// 2. Dry-run the spend — free, and tells you whether to bother.
const sim = await vault.simulatePayment({
  tool: "pay_api",
  amountUsdc: "1.20",
  destination: "api.openai.com",
});
log("simulate $1.20 pay_api", sim);

// 3. Small pay inside policy: succeeds, budget ticks down.
const paid = await vault.payApi({
  amountUsdc: "1.20",
  destination: "api.openai.com",
  idempotencyKey: idem("pay"),
  jobId: "demo_job_001",
  memo: "pull pricing table",
});
log("pay $1.20 (allowed)", paid);

// 4. A drain attempt is a recoverable error, not a crash — the agent replans.
try {
  await vault.pay({
    amountUsdc: "5",
    destination: "0x1111111111111111111111111111111111111111",
    idempotencyKey: idem("drain"),
  });
} catch (e) {
  if (e instanceof PolicyVaultApiError) {
    log("drain attempt (denied as designed)", { code: e.code, message: e.message });
  } else {
    throw e;
  }
}

// 5. Big spend: parks in the guardian's approval inbox; agent polls, then moves on.
const big = await vault.payApi({
  amountUsdc: "15",
  destination: "api.openai.com",
  idempotencyKey: idem("big"),
  memo: "bulk dataset purchase",
});
log("pay $15 (needs approval)", big);
if (big.outcome === "review" && (big as { approvalId?: string }).approvalId) {
  const approvalId = (big as { approvalId: string }).approvalId;
  console.log("\nWaiting up to 30s for a guardian to approve/deny in the console...");
  const approval = await vault.waitForApproval(approvalId, { pollMs: 2_000, maxWaitMs: 30_000 });
  log("approval outcome", approval);
}

// 6. Hire a peer agent under escrow: funds lock now, release on acceptance.
if (payeeAgentId) {
  const esc = await vault.escrowLock({
    amountUsdc: "2",
    payeeAgentId,
    idempotencyKey: idem("esc"),
    jobId: "demo_job_001",
    memo: "hire peer for review pass",
  });
  log("escrow lock $2", esc);
  if (esc.escrowId) {
    // ...peer does the work, we accept the deliverable...
    const rel = await vault.escrowRelease(esc.escrowId);
    log("escrow release (peer paid)", rel);
  }
} else {
  console.log("\n(Skip escrow demo — set PAYEE_AGENT_ID to a same-org agent id to enable.)");
}

log("final budget", await vault.getBudget());

// 7. Optional: real on-chain USDC pay to your Base Sepolia wallet (E2E proof).
// Requires: vault USDC+ETH, stipend, address on policy allowlist. See docs/E2E-ONCHAIN-AGENT-PAY.md
const payTo = process.env.PAY_TO_ADDRESS?.trim();
const payAmount = process.env.PAY_TO_AMOUNT?.trim() || "0.10";
if (payTo) {
  const onchain = await vault.pay({
    amountUsdc: payAmount,
    destination: payTo,
    idempotencyKey: idem("onchain_wallet"),
    memo: "e2e sepolia wallet proof",
  });
  log(`on-chain pay $${payAmount} → ${payTo}`, onchain);
  if (onchain.outcome === "review" && (onchain as { approvalId?: string }).approvalId) {
    const approvalId = (onchain as { approvalId: string }).approvalId;
    console.log("\nWaiting up to 120s for guardian approval of on-chain pay...");
    const approval = await vault.waitForApproval(approvalId, { pollMs: 2_000, maxWaitMs: 120_000 });
    log("on-chain pay approval", approval);
  }
  const tx = (onchain as { txHash?: string; resource?: { explorerUrl?: string } }).txHash;
  const explorer = (onchain as { resource?: { explorerUrl?: string } }).resource?.explorerUrl;
  if (tx || explorer) {
    console.log(`\nBasescan: ${explorer ?? tx}`);
  }
} else {
  console.log(
    "\n(Skip on-chain wallet pay — set PAY_TO_ADDRESS=0x… and optionally PAY_TO_AMOUNT=0.10)",
  );
}

console.log("\nDemo agent done. Every step above is in the guardian's decision trace.");
