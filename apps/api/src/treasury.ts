/**
 * Pure treasury analytics — cash-flow buckets and org-level forecasting.
 * Keeps Insights / Treasury views free of SQL.
 */
import { formatMicroToUsdc, type MicroUsdc } from "@policyvault/common";

export interface JournalLineView {
  accountId: string;
  deltaMicro: string | bigint;
}

export interface JournalView {
  id: string;
  memo: string;
  createdAt: string;
  lines: JournalLineView[];
}

export interface CashflowDay {
  day: string; // YYYY-MM-DD UTC
  inflowUsdc: string;
  outflowUsdc: string;
  netUsdc: string;
  journals: number;
}

/**
 * Classify journal memos into cash-flow direction relative to the org treasury
 * perimeter (org + dept + shared + agent available). External/revenue outflows
 * from agents count as spend; deposits into org count as inflow.
 */
export function buildCashflow(journals: JournalView[], days = 30): CashflowDay[] {
  const cutoff = Date.now() - days * 86_400_000;
  const buckets = new Map<string, { in: bigint; out: bigint; n: number }>();

  for (const j of journals) {
    const t = Date.parse(j.createdAt);
    if (Number.isNaN(t) || t < cutoff) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    const bucket = buckets.get(day) ?? { in: 0n, out: 0n, n: 0 };
    bucket.n += 1;

    const memo = j.memo.toLowerCase();
    // Net change on external/revenue accounts is the cleanest signal for
    // money leaving/entering the org perimeter.
    for (const line of j.lines) {
      const delta =
        typeof line.deltaMicro === "bigint" ? line.deltaMicro : BigInt(line.deltaMicro);
      if (line.accountId.includes(":external")) {
        // +external = money left the org (spend settled); -external = deposit/mock credit
        if (delta > 0n) bucket.out += delta;
        else if (delta < 0n) bucket.in += -delta;
      } else if (line.accountId.includes(":revenue") && delta < 0n) {
        // Revenue credit (negative balance by convention) = inflow
        bucket.in += -delta;
      } else if (
        (memo.includes("deposit") || memo.includes("seed")) &&
        line.accountId.includes(":available") &&
        delta > 0n &&
        line.accountId.startsWith("org:")
      ) {
        bucket.in += delta;
      }
    }
    buckets.set(day, bucket);
  }

  const daysOut: CashflowDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const b = buckets.get(d) ?? { in: 0n, out: 0n, n: 0 };
    const net = b.in - b.out;
    daysOut.push({
      day: d,
      inflowUsdc: formatMicroToUsdc(b.in),
      outflowUsdc: formatMicroToUsdc(b.out),
      netUsdc: formatMicroToUsdc(net),
      journals: b.n,
    });
  }
  return daysOut;
}

export interface TreasuryForecastInput {
  orgAvailableMicro: MicroUsdc;
  deptAvailableMicro: MicroUsdc;
  sharedAvailableMicro: MicroUsdc;
  agentAvailableMicro: MicroUsdc;
  /** Average daily agent spend over the lookback window. */
  avgDailySpendMicro: MicroUsdc;
  /** Expected invoice collections still open. */
  openInvoicesMicro: MicroUsdc;
}

export interface TreasuryForecast {
  totalLiquidUsdc: string;
  orgAvailableUsdc: string;
  deptAvailableUsdc: string;
  sharedAvailableUsdc: string;
  agentAvailableUsdc: string;
  avgDailySpendUsdc: string;
  openInvoicesUsdc: string;
  /** Days until liquid treasury is exhausted at avg spend (null if no burn). */
  runwayDays: number | null;
  projectedLiquidIn30dUsdc: string;
  note: string;
}

export function buildTreasuryForecast(input: TreasuryForecastInput): TreasuryForecast {
  const liquid =
    input.orgAvailableMicro +
    input.deptAvailableMicro +
    input.sharedAvailableMicro +
    input.agentAvailableMicro;
  const spend = input.avgDailySpendMicro;
  const runwayDays =
    spend > 0n ? Number(liquid / spend) : liquid > 0n ? null : 0;
  const projected = liquid + input.openInvoicesMicro - spend * 30n;
  return {
    totalLiquidUsdc: formatMicroToUsdc(liquid),
    orgAvailableUsdc: formatMicroToUsdc(input.orgAvailableMicro),
    deptAvailableUsdc: formatMicroToUsdc(input.deptAvailableMicro),
    sharedAvailableUsdc: formatMicroToUsdc(input.sharedAvailableMicro),
    agentAvailableUsdc: formatMicroToUsdc(input.agentAvailableMicro),
    avgDailySpendUsdc: formatMicroToUsdc(spend),
    openInvoicesUsdc: formatMicroToUsdc(input.openInvoicesMicro),
    runwayDays: runwayDays === null ? null : Math.min(runwayDays, 9999),
    projectedLiquidIn30dUsdc: formatMicroToUsdc(projected < 0n ? 0n : projected),
    note:
      spend <= 0n
        ? "No recent spend — runway is open-ended while balances stay flat."
        : `At current burn, liquid treasury covers ~${runwayDays} day(s).`,
  };
}

/** Map WalletScope → ledger account kind for available balances. */
export function availableKind(
  scope: "org" | "department" | "agent" | "shared",
): "org_available" | "dept_available" | "agent_available" | "shared_available" {
  switch (scope) {
    case "org":
      return "org_available";
    case "department":
      return "dept_available";
    case "agent":
      return "agent_available";
    case "shared":
      return "shared_available";
  }
}

export function heldKind(
  scope: "org" | "department" | "agent" | "shared",
): "org_held" | "dept_held" | "agent_held" | "shared_held" {
  switch (scope) {
    case "org":
      return "org_held";
    case "department":
      return "dept_held";
    case "agent":
      return "agent_held";
    case "shared":
      return "shared_held";
  }
}
