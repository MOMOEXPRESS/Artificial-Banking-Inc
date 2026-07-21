import type { MicroUsdc } from "@policyvault/common";

export type LedgerAccountKind =
  | "org_available"
  | "org_held"
  | "agent_available"
  | "agent_held"
  | "escrow"
  | "external"
  /** Nominal income account. Carries a credit (negative) balance by nature. */
  | "revenue"
  /**
   * Department / shared wallet available+held accounts.
   * Account ids: `dept:{id}:available` / `shared:{id}:available`.
   */
  | "dept_available"
  | "dept_held"
  | "shared_available"
  | "shared_held";

/**
 * Asset accounts can never go negative — that would be spending money you do
 * not have. Nominal/contra accounts (income) legitimately carry the opposite
 * sign, so they are exempt from the floor.
 */
const CONTRA_KINDS = new Set<LedgerAccountKind>(["revenue", "external"]);

export interface LedgerAccount {
  id: string;
  orgId: string;
  kind: LedgerAccountKind;
  agentId?: string;
  balanceMicro: MicroUsdc;
}

export interface JournalLine {
  accountId: string;
  /** Positive = debit, negative = credit in our MVP sign convention for asset accounts:
   *  we use signed delta: +increases balance, -decreases */
  deltaMicro: MicroUsdc;
}

export interface JournalEntry {
  id: string;
  orgId: string;
  intentId?: string;
  memo: string;
  lines: JournalLine[];
  createdAt: string;
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

/** Every journal must sum to zero. */
export function assertBalanced(lines: JournalLine[]): void {
  const sum = lines.reduce((a, l) => a + l.deltaMicro, 0n);
  if (sum !== 0n) {
    throw new LedgerError(`UNBALANCED_JOURNAL sum=${sum}`);
  }
}

export function applyJournal(
  accounts: Map<string, LedgerAccount>,
  entry: Omit<JournalEntry, "createdAt"> & { createdAt?: string },
): Map<string, LedgerAccount> {
  assertBalanced(entry.lines);
  const next = new Map(accounts);
  for (const line of entry.lines) {
    const acc = next.get(line.accountId);
    if (!acc) throw new LedgerError(`ACCOUNT_NOT_FOUND ${line.accountId}`);
    if (acc.orgId !== entry.orgId) throw new LedgerError("CROSS_TENANT_LEDGER");
    const balance = acc.balanceMicro + line.deltaMicro;
    if (balance < 0n && !CONTRA_KINDS.has(acc.kind)) {
      throw new LedgerError(`INSUFFICIENT_FUNDS ${line.accountId}`);
    }
    next.set(line.accountId, { ...acc, balanceMicro: balance });
  }
  return next;
}

export function allocateStipend(args: {
  orgId: string;
  journalId: string;
  orgAvailableId: string;
  agentAvailableId: string;
  amountMicro: MicroUsdc;
}): { entry: JournalEntry; apply: (m: Map<string, LedgerAccount>) => Map<string, LedgerAccount> } {
  const entry: JournalEntry = {
    id: args.journalId,
    orgId: args.orgId,
    memo: "allocate_stipend",
    createdAt: new Date().toISOString(),
    lines: [
      { accountId: args.orgAvailableId, deltaMicro: -args.amountMicro },
      { accountId: args.agentAvailableId, deltaMicro: args.amountMicro },
    ],
  };
  return { entry, apply: (m) => applyJournal(m, entry) };
}

/**
 * Generic treasury move between any two available accounts in the same org.
 * Used today for org↔agent; later for dept/shared without new journal shapes.
 */
export function transferAvailable(args: {
  orgId: string;
  journalId: string;
  fromAvailableId: string;
  toAvailableId: string;
  amountMicro: MicroUsdc;
  memo?: string;
}): JournalEntry {
  return {
    id: args.journalId,
    orgId: args.orgId,
    memo: args.memo ?? "transfer_available",
    createdAt: new Date().toISOString(),
    lines: [
      { accountId: args.fromAvailableId, deltaMicro: -args.amountMicro },
      { accountId: args.toAvailableId, deltaMicro: args.amountMicro },
    ],
  };
}

export function holdForPayment(args: {
  orgId: string;
  journalId: string;
  intentId: string;
  agentAvailableId: string;
  agentHeldId: string;
  amountMicro: MicroUsdc;
}): JournalEntry {
  return {
    id: args.journalId,
    orgId: args.orgId,
    intentId: args.intentId,
    memo: "hold_payment",
    createdAt: new Date().toISOString(),
    lines: [
      { accountId: args.agentAvailableId, deltaMicro: -args.amountMicro },
      { accountId: args.agentHeldId, deltaMicro: args.amountMicro },
    ],
  };
}

export function finalizePayment(args: {
  orgId: string;
  journalId: string;
  intentId: string;
  agentHeldId: string;
  externalId: string;
  amountMicro: MicroUsdc;
}): JournalEntry {
  return {
    id: args.journalId,
    orgId: args.orgId,
    intentId: args.intentId,
    memo: "finalize_payment",
    createdAt: new Date().toISOString(),
    lines: [
      { accountId: args.agentHeldId, deltaMicro: -args.amountMicro },
      { accountId: args.externalId, deltaMicro: args.amountMicro },
    ],
  };
}

export function releaseHold(args: {
  orgId: string;
  journalId: string;
  intentId: string;
  agentHeldId: string;
  agentAvailableId: string;
  amountMicro: MicroUsdc;
}): JournalEntry {
  return {
    id: args.journalId,
    orgId: args.orgId,
    intentId: args.intentId,
    memo: "release_hold",
    createdAt: new Date().toISOString(),
    lines: [
      { accountId: args.agentHeldId, deltaMicro: -args.amountMicro },
      { accountId: args.agentAvailableId, deltaMicro: args.amountMicro },
    ],
  };
}

/**
 * Invoice settled by a client: debit the treasury (asset up), credit revenue.
 * This is the income side of the agent-firm P&L.
 */
export function recogniseRevenue(args: {
  orgId: string;
  journalId: string;
  revenueAccountId: string;
  orgAvailableId: string;
  amountMicro: MicroUsdc;
  memo?: string;
}): JournalEntry {
  return {
    id: args.journalId,
    orgId: args.orgId,
    memo: args.memo ?? "invoice_paid",
    createdAt: new Date().toISOString(),
    lines: [
      { accountId: args.revenueAccountId, deltaMicro: -args.amountMicro },
      { accountId: args.orgAvailableId, deltaMicro: args.amountMicro },
    ],
  };
}

/** Payer agent funds an escrow account (agent_available → escrow). */
export function lockEscrow(args: {
  orgId: string;
  journalId: string;
  intentId?: string;
  payerAvailableId: string;
  escrowAccountId: string;
  amountMicro: MicroUsdc;
}): JournalEntry {
  return {
    id: args.journalId,
    orgId: args.orgId,
    intentId: args.intentId,
    memo: "escrow_lock",
    createdAt: new Date().toISOString(),
    lines: [
      { accountId: args.payerAvailableId, deltaMicro: -args.amountMicro },
      { accountId: args.escrowAccountId, deltaMicro: args.amountMicro },
    ],
  };
}

/** Payer accepts delivery: escrow → payee agent_available. */
export function releaseEscrow(args: {
  orgId: string;
  journalId: string;
  escrowAccountId: string;
  payeeAvailableId: string;
  amountMicro: MicroUsdc;
}): JournalEntry {
  return {
    id: args.journalId,
    orgId: args.orgId,
    memo: "escrow_release",
    createdAt: new Date().toISOString(),
    lines: [
      { accountId: args.escrowAccountId, deltaMicro: -args.amountMicro },
      { accountId: args.payeeAvailableId, deltaMicro: args.amountMicro },
    ],
  };
}

/** Refund (decline or timeout): escrow → payer agent_available. */
export function refundEscrow(args: {
  orgId: string;
  journalId: string;
  escrowAccountId: string;
  payerAvailableId: string;
  amountMicro: MicroUsdc;
  reason: "refund" | "timeout_refund";
}): JournalEntry {
  return {
    id: args.journalId,
    orgId: args.orgId,
    memo: `escrow_${args.reason}`,
    createdAt: new Date().toISOString(),
    lines: [
      { accountId: args.escrowAccountId, deltaMicro: -args.amountMicro },
      { accountId: args.payerAvailableId, deltaMicro: args.amountMicro },
    ],
  };
}
