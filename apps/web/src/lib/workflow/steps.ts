/**
 * Production workflow steps. Each one calls a real flow with the acting
 * agent's key — budget, simulate, pay, x402, escrow, activity — and turns the
 * response into a short operator-facing summary. Nothing here creates demo
 * data or changes org configuration; that lives in `lib/playground/training`.
 */
import * as A from "../flows/agent";
import { errCode, errMsg } from "../flows/client";
import type { RunState, StepDef } from "./types";

/** Fallback explorer link when the API omits one (the playground runs on Base Sepolia). */
export const baseSepoliaTxUrl = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;

export const idem = (tag: string) => `mis_${tag}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
export const pretty = (o: unknown) => JSON.stringify(o, null, 2);

export const checkBudget: StepDef = {
  id: "budget",
  title: "Check available budget",
  detail: "Asks ABI what it can spend before planning any paid work.",
  async run(ctx, state) {
    const { data } = await A.getBudget(ctx.agent);
    state.finalBudget = String(data.availableUsdc);
    ctx.log(`budget → $${data.availableUsdc} available, $${data.dailyRemainingUsdc} left today`);
    if (data.frozen) {
      return {
        summary: "Agent is frozen — it cannot spend anything. Mission aborted.",
        output: pretty(data),
        abort: true,
        softFail: true,
      };
    }
    return {
      summary: `$${data.availableUsdc} available, $${data.dailyRemainingUsdc} left under today's cap.`,
      output: pretty(data),
    };
  },
};

export const dryRun = (amount: string, dest: string): StepDef => ({
  id: `sim_${amount}_${dest}`,
  title: `Dry-run $${amount} to ${dest}`,
  detail: "Free simulation — asks the policy engine what would happen, without moving money.",
  async run(ctx) {
    const { data } = await A.simulatePay(ctx.agent, {
      tool: "pay_api",
      amountUsdc: amount,
      destination: dest,
    });
    const rules = (data.ruleIds as string[])?.join(", ") ?? "";
    ctx.log(`simulate → ${data.outcome} (${rules})`);
    return {
      summary: `Policy would ${data.outcome} this — rule: ${rules}.`,
      output: pretty(data),
    };
  },
});

export const buyViaX402 = (authorize: string): StepDef => ({
  id: "x402",
  title: `Buy the pricing report (authorize up to $${authorize})`,
  detail: "Real x402 dance: seller answers 402, ABI signs an EIP-712 payment, data comes back.",
  async run(ctx, state) {
    if (!ctx.sellerUrl) {
      return {
        summary:
          "x402 seller URL is not configured. Set NEXT_PUBLIC_SELLER_URL on the console host " +
          "to your public seller endpoint (the bundled seller defaults to localhost:9402, which " +
          "is unreachable from a hosted console).",
        output: "NEXT_PUBLIC_SELLER_URL unset",
        softFail: true,
      };
    }
    const { status, data } = await A.payApi(ctx.agent, {
      amountUsdc: authorize,
      destination: ctx.sellerUrl,
      idempotencyKey: idem("x402"),
      jobId: ctx.runId,
      memo: "competitor pricing data",
    });
    if (status === 202 && data.approvalId) {
      return {
        summary: `Parked — $${authorize} needs your approval before the seller can be paid.`,
        output: pretty(data),
        approvalId: String(data.approvalId),
      };
    }
    if (status >= 400) {
      state.denials.push({
        amount: authorize,
        destination: ctx.sellerUrl,
        code: errCode(data),
        reason: errMsg(data),
      });
      ctx.log(`x402 purchase refused → ${errCode(data)}`);
      return {
        summary: `Refused: ${errMsg(data) || errCode(data)}.`,
        output: pretty(data),
        softFail: true,
      };
    }
    state.report = data.resource as RunState["report"];
    state.spentUsd += Number(data.amountUsdc);
    state.purchases.push({
      amount: String(data.amountUsdc),
      destination: "x402 seller",
      rail: String(data.rail),
      txHash: data.txHash as string | undefined,
    });
    ctx.log(
      `x402 settled → charged $${data.amountUsdc}, tx ${String(data.txHash ?? "").slice(0, 14)}…`,
    );
    const rows = (data.resource as RunState["report"])?.rows?.length ?? 0;
    return {
      summary: `Paid $${data.amountUsdc} of the $${authorize} authorized and received ${rows} pricing rows. Unspent balance returned.`,
      output: pretty(data),
    };
  },
});

export const payVendor = (amount: string, vendor: string, memo: string): StepDef => ({
  id: `pay_${vendor}_${amount}_${memo
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 36)}`,
  title: `Pay $${amount} to ${vendor}`,
  detail: memo,
  async run(ctx, state) {
    const { status, data } = await A.payApi(ctx.agent, {
      amountUsdc: amount,
      destination: vendor,
      idempotencyKey: idem("pay"),
      jobId: ctx.runId,
      memo,
    });
    if (status === 202 && data.approvalId) {
      state.blocks.push({ amount, destination: vendor, outcome: "pending" });
      return {
        summary: `Parked — $${amount} is above your approval threshold, so the agent is blocked.`,
        output: pretty(data),
        approvalId: String(data.approvalId),
      };
    }
    if (status >= 400) {
      state.denials.push({
        amount,
        destination: vendor,
        code: errCode(data),
        reason: errMsg(data),
      });
      ctx.log(`payment refused → ${errCode(data)}`);
      return {
        summary: `Refused: ${errMsg(data) || errCode(data)}.`,
        output: pretty(data),
        softFail: true,
      };
    }
    state.spentUsd += Number(data.amountUsdc);
    state.purchases.push({
      amount: String(data.amountUsdc),
      destination: vendor,
      rail: String(data.rail),
    });
    ctx.log(`paid $${data.amountUsdc} to ${vendor}`);
    return { summary: `Settled $${data.amountUsdc} to ${vendor}.`, output: pretty(data) };
  },
});

/** Real Base USDC ERC-20 transfer from org vault → allowlisted wallet. */
export const payToWallet = (amount: string, address: string): StepDef => ({
  id: `pay_wallet_${address.slice(0, 10)}`,
  title: `On-chain pay $${amount} USDC → ${address.slice(0, 10)}…`,
  detail:
    "Broadcasts vault USDC.transfer to your allowlisted Base Sepolia wallet. Needs vault USDC + ETH gas + address allowlist.",
  async run(ctx, state) {
    const dest = address.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(dest)) {
      return {
        summary: "Set a valid 0x receive address (Base Sepolia wallet — not Coinbase exchange).",
        output: dest,
        softFail: true,
        abort: true,
      };
    }
    const { status, data } = await A.payAddress(ctx.agent, {
      amountUsdc: amount,
      destination: dest,
      idempotencyKey: idem("wallet"),
      jobId: ctx.runId,
      memo: "e2e sepolia wallet proof",
    });
    if (status === 202 && data.approvalId) {
      state.blocks.push({ amount, destination: dest, outcome: "pending" });
      return {
        summary: `Parked for HITL — approve in Approvals, then the vault will broadcast USDC to ${dest.slice(0, 10)}…`,
        output: pretty(data),
        approvalId: String(data.approvalId),
      };
    }
    if (
      status === 409 &&
      (data.outcome === "pending_reconciliation" || errCode(data) === "SETTLEMENT_UNCERTAIN")
    ) {
      // A transaction may already be on-chain. This is NOT a failure and must
      // not be retried: the hold stays until the payment is reconciled.
      const settlement = (data.settlement ?? {}) as { txHash?: string };
      const hash = typeof settlement.txHash === "string" ? settlement.txHash : undefined;
      state.blocks.push({ amount, destination: dest, outcome: "pending" });
      ctx.log(`on-chain $${amount} → ${dest} unconfirmed${hash ? ` tx ${hash}` : ""}`);
      return {
        summary: `Sent but not yet confirmed — held for reconciliation. Do not re-run this payment.${
          hash ? ` Check the transaction: ${baseSepoliaTxUrl(hash)}` : ""
        }`,
        output: pretty(data),
        softFail: true,
        abort: true,
      };
    }
    if (status >= 400) {
      state.denials.push({ amount, destination: dest, code: errCode(data), reason: errMsg(data) });
      return {
        summary: `On-chain pay failed: ${errMsg(data) || errCode(data)}. Check allowlist, stipend, vault USDC + ETH.`,
        output: pretty(data),
        softFail: true,
      };
    }
    state.spentUsd += Number(data.amountUsdc);
    state.purchases.push({
      amount: String(data.amountUsdc),
      destination: dest,
      rail: String(data.rail ?? "evm-usdc-transfer"),
      txHash: typeof data.txHash === "string" ? data.txHash : undefined,
    });
    const explorer =
      (data.resource as { explorerUrl?: string } | undefined)?.explorerUrl ??
      (typeof data.txHash === "string" ? baseSepoliaTxUrl(data.txHash) : undefined);
    ctx.log(`on-chain $${data.amountUsdc} → ${dest}${data.txHash ? ` tx ${data.txHash}` : ""}`);
    return {
      summary: explorer
        ? `Settled $${data.amountUsdc} on-chain. Basescan: ${explorer}`
        : `Settled $${data.amountUsdc} on-chain to ${dest.slice(0, 10)}…`,
      output: pretty(data),
    };
  },
});

export const hirePeer = (amount: string): StepDef => ({
  id: "escrow_lock",
  title: `Hire the peer agent under $${amount} escrow`,
  detail: "Funds lock in escrow — the peer only gets paid when the deliverable is accepted.",
  async run(ctx, state) {
    if (!ctx.payeeAgentId)
      return { summary: "No peer agent available — skipped.", output: "no peer", softFail: true };
    const { status, data } = await A.lockEscrow(ctx.agent, {
      amountUsdc: amount,
      payeeAgentId: ctx.payeeAgentId,
      idempotencyKey: idem("esc"),
      jobId: ctx.runId,
      memo: "draft the written brief",
    });
    if (status === 202 && data.approvalId)
      return {
        summary: `Parked — hiring for $${amount} needs your approval.`,
        output: pretty(data),
        approvalId: String(data.approvalId),
      };
    if (status >= 400)
      return {
        summary: `Could not lock escrow: ${errMsg(data) || errCode(data)}.`,
        output: pretty(data),
        softFail: true,
      };
    state.escrowId = data.escrowId as string;
    ctx.log(`escrow ${data.escrowId} locked with $${data.amountUsdc}`);
    return {
      summary: `$${data.amountUsdc} locked in escrow — the peer is hired but not yet paid.`,
      output: pretty(data),
    };
  },
});

export const acceptDelivery: StepDef = {
  id: "escrow_release",
  title: "Accept the deliverable and release escrow",
  detail: "The peer delivered; the agent releases the locked funds to it.",
  async run(ctx, state) {
    if (!state.escrowId)
      return { summary: "No escrow to release — skipped.", output: "no escrow", softFail: true };
    const { status, data } = await A.releaseEscrow(ctx.agent, state.escrowId);
    if (status >= 400)
      return {
        summary: `Release failed: ${errMsg(data) || errCode(data)}.`,
        output: pretty(data),
        softFail: true,
      };
    ctx.log(`escrow ${state.escrowId} released to the peer`);
    return {
      summary: "Work accepted — escrowed funds released to the peer agent.",
      output: pretty(data),
    };
  },
};

export const refundEscrow: StepDef = {
  id: "escrow_refund",
  title: "Reject delivery and refund escrow",
  detail: "Work was not acceptable — funds return to the hiring agent.",
  async run(ctx, state) {
    if (!state.escrowId)
      return { summary: "No escrow to refund — skipped.", output: "no escrow", softFail: true };
    const { status, data } = await A.refundEscrow(ctx.agent, state.escrowId);
    if (status >= 400)
      return {
        summary: `Refund failed: ${errMsg(data) || errCode(data)}.`,
        output: pretty(data),
        softFail: true,
      };
    ctx.log(`escrow ${state.escrowId} refunded`);
    return { summary: "Escrow refunded to the payer — peer was not paid.", output: pretty(data) };
  },
};

export const listActivity: StepDef = {
  id: "activity",
  title: "Pull own decision activity",
  detail: "Agent audits what policy already decided about its intents.",
  async run(ctx) {
    const { data } = await A.listActivity(ctx.agent, 10);
    const n = Array.isArray(data.decisions) ? data.decisions.length : 0;
    return {
      summary: `Fetched ${n} recent decision(s) from the activity log.`,
      output: pretty(data),
    };
  },
};

export const summarize: StepDef = {
  id: "summary",
  title: "Compile the deliverable and report cost",
  detail: "The agent finishes its task using the data it paid for.",
  async run(ctx, state) {
    const { data } = await A.getBudget(ctx.agent);
    state.finalBudget = String(data.availableUsdc);
    ctx.log("mission complete");
    return {
      summary: `Done. Spent $${state.spentUsd.toFixed(2)} this run; $${data.availableUsdc} left in the agent's budget.`,
      output: pretty(data),
    };
  },
};

export const costTable = (state: RunState) =>
  state.purchases.length
    ? [
        "| Item | Rail | Cost |",
        "| --- | --- | --- |",
        ...state.purchases.map((p) => `| ${p.destination} | ${p.rail} | $${p.amount} |`),
        `| **Total** | | **$${state.spentUsd.toFixed(2)}** |`,
      ].join("\n")
    : "_No purchases were settled in this run._";
