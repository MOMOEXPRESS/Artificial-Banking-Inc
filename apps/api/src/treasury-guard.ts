/**
 * Guardian-side policy for money that leaves the organization.
 *
 * Every agent spend path (direct intents, approvals, subscriptions) runs the
 * policy engine before anything executes. The guardian treasury withdraw did
 * not: it sent real USDC from the vault after only a balance check, ignoring
 * the org freeze switch and the blocklist. "The guard is decorative" if a
 * human path can skip it, so this module is the guardian equivalent of
 * `evaluatePolicy` for outbound treasury money.
 *
 * Rules, in order (first failure wins, deny is the default for anything odd):
 *   1. org_frozen                  — a frozen org moves no money out, full stop.
 *   2. blocklist                   — the org blocklist applies to humans too.
 *   3. treasury_withdraw_allowlist — when configured, the destination must be on it.
 *   4. treasury_withdraw_max       — per-withdrawal ceiling (USDC only).
 *   5. treasury_withdraw_daily_max — rolling 24h ceiling (USDC only), counting
 *                                    settled withdrawals AND ones in flight.
 *   6. treasury_withdraw_reserved  — the org balance left after every other
 *                                    in-flight withdrawal must cover this one.
 *
 * In-flight withdrawals are reserved in the shared database (a `pending`
 * `settlement_attempts` row, tool `treasury_withdraw`) inside one IMMEDIATE
 * transaction with the cap check, so the reservation holds across processes
 * and survives a restart. It used to be an in-memory map, which a second API
 * instance could not see.
 *
 * Every outcome is written to the decisions table (tool `treasury_withdraw`,
 * agentId `guardian:<identity>`) so a refused or allowed withdrawal is
 * auditable by intent id, exactly like an agent decision.
 */
import { formatMicroToUsdc, parseUsdcToMicro } from "@policyvault/common";
import type { LimitsView } from "./decision-receipts.js";
import { frozenLimits, id, recordDecision } from "./engine.js";
import { store, type OrgRow } from "./store.js";

/** Defaults when an org has not configured its own treasury withdrawal caps. */
export const DEFAULT_TREASURY_WITHDRAW_MAX_MICRO = 1_000_000_000n; // $1,000 per withdrawal
export const DEFAULT_TREASURY_WITHDRAW_DAILY_MAX_MICRO = 5_000_000_000n; // $5,000 rolling 24h

export const TREASURY_WITHDRAW_TOOL = "treasury_withdraw";

export interface TreasuryWithdrawLimits {
  maxMicro: bigint;
  dailyMaxMicro: bigint;
  allowlist: string[];
  blocklist: string[];
}

export function treasuryWithdrawLimits(orgId: string): TreasuryWithdrawLimits {
  const t = store.getPolicyTemplate(orgId);
  return {
    maxMicro: t.treasuryWithdrawMaxMicro ?? DEFAULT_TREASURY_WITHDRAW_MAX_MICRO,
    dailyMaxMicro: t.treasuryWithdrawDailyMaxMicro ?? DEFAULT_TREASURY_WITHDRAW_DAILY_MAX_MICRO,
    allowlist: t.treasuryWithdrawAllowlist ?? [],
    blocklist: t.blocklist ?? [],
  };
}

/** Withdrawals reserved but not yet booked, read from the shared database. */
function inFlightMicro(orgId: string): bigint {
  return store.treasuryWithdrawInFlightMicro(orgId);
}

/** Settled (allowed + booked) guardian withdrawals in the last 24h, in micro-USDC. */
export function treasuryWithdrawnLast24h(orgId: string, nowMs = Date.now()): bigint {
  const sinceIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  let sum = 0n;
  for (const d of store.listDecisionsByTool(orgId, TREASURY_WITHDRAW_TOOL, sinceIso)) {
    if (d.outcome !== "allow") continue;
    try {
      sum += parseUsdcToMicro(d.amountUsdc);
    } catch {
      /* malformed historical row — ignore rather than block every withdrawal */
    }
  }
  return sum;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export type TreasuryGuardDenial = {
  ok: false;
  intentId: string;
  status: number;
  code: "FROZEN" | "POLICY_DENIED";
  ruleIds: string[];
  reasons: string[];
  /** Structured numbers for cap and freeze denials (decimal USDC strings). */
  limits?: LimitsView;
  receipt: unknown;
};

export type TreasuryGuardAllow = {
  ok: true;
  intentId: string;
  /** Book the outflow as allowed. Call exactly once after the money moved. */
  commit: () => void;
  /** Release the reservation and record why it did not complete. */
  fail: (reason: string, code?: string) => void;
};

/**
 * Evaluate and reserve a guardian withdrawal. Records a deny decision on
 * refusal. On allow the caller MUST call `commit()` after the transfer
 * succeeds or `fail()` if it does not.
 */
export function guardTreasuryWithdraw(input: {
  org: OrgRow;
  actor: string;
  assetId: string;
  /** Amount in the asset's base units. Caps only apply to USDC. */
  amountMicro: bigint;
  amountDisplay: string;
  destination?: string;
  nowMs?: number;
  /**
   * The org's booked available balance. When given, the balance left after
   * every other in-flight withdrawal must cover this one (rule 6).
   */
  availableMicro?: bigint;
  /**
   * Evaluate only: refusals are still recorded, but an allow reserves no
   * headroom and records nothing. Used before parking a withdrawal for
   * guardian review; the real check runs again when it executes.
   */
  dryRun?: boolean;
}): TreasuryGuardAllow | TreasuryGuardDenial {
  const org = store.getOrg(input.org.id) ?? input.org;
  const intentId = id("twd");
  const destination = input.destination?.trim() ?? "";
  const isUsdc = input.assetId === "asset_usdc";
  const limits = treasuryWithdrawLimits(org.id);
  const base = {
    intentId,
    orgId: org.id,
    agentId: `guardian:${input.actor}`,
    tool: TREASURY_WITHDRAW_TOOL,
    amountUsdc: input.amountDisplay,
    destination: destination || "external",
  };

  const deny = (
    ruleId: string,
    reason: string,
    code: TreasuryGuardDenial["code"] = "POLICY_DENIED",
    numbers?: Parameters<typeof recordDecision>[0]["limits"],
  ): TreasuryGuardDenial => {
    const recorded = recordDecision({
      ...base,
      outcome: "deny",
      ruleIds: [ruleId],
      reasons: [reason],
      limits: numbers,
    });
    return {
      ok: false,
      intentId,
      status: 403,
      code,
      ruleIds: [ruleId],
      reasons: [reason],
      ...(recorded.limits && { limits: recorded.limits }),
      receipt: recorded.receipt,
    };
  };

  if (org.status === "frozen") {
    return deny(
      "org_frozen",
      "Organization is frozen — unfreeze it before withdrawing",
      "FROZEN",
      isUsdc ? frozenLimits("org_frozen", input.amountMicro) : undefined,
    );
  }

  if (destination) {
    const d = norm(destination);
    if (limits.blocklist.some((b) => norm(b) === d)) {
      return deny("blocklist", `Destination is blocklisted: ${destination}`);
    }
  }

  if (limits.allowlist.length > 0) {
    const allowed = limits.allowlist.map(norm);
    if (!destination || !allowed.includes(norm(destination))) {
      return deny(
        "treasury_withdraw_allowlist",
        "Destination is not on the treasury withdrawal allowlist",
      );
    }
  }

  if (isUsdc) {
    if (input.amountMicro > limits.maxMicro) {
      return deny(
        "treasury_withdraw_max",
        `Exceeds the per-withdrawal cap of ${formatMicroToUsdc(limits.maxMicro)} USDC`,
        "POLICY_DENIED",
        {
          ruleId: "treasury_withdraw_max",
          unit: "usdc",
          attempted: input.amountMicro,
          cap: limits.maxMicro,
          remaining: limits.maxMicro,
          window: "per_withdrawal",
        },
      );
    }
  }

  // Rules 5 and 6 depend on what other withdrawals have reserved. Evaluated
  // inside the reservation transaction (or read-only for a dry run).
  const settled24h = isUsdc ? treasuryWithdrawnLast24h(org.id, input.nowMs) : 0n;
  type CapRefusal = { rule: string; used: bigint };
  const capCheck = (inFlight: bigint, open: bigint): CapRefusal | null => {
    if (!isUsdc) return null;
    const used = settled24h + inFlight;
    if (used + input.amountMicro > limits.dailyMaxMicro) {
      return { rule: "treasury_withdraw_daily_max", used };
    }
    if (input.availableMicro !== undefined && input.availableMicro - open < input.amountMicro) {
      return { rule: "treasury_withdraw_reserved", used: open };
    }
    return null;
  };
  const refuseCap = (r: CapRefusal): TreasuryGuardDenial => {
    if (r.rule === "treasury_withdraw_reserved") {
      const free = (input.availableMicro ?? 0n) - r.used;
      return deny(
        "treasury_withdraw_reserved",
        `Only ${formatMicroToUsdc(free > 0n ? free : 0n)} USDC is free: ${formatMicroToUsdc(r.used)} USDC is reserved by withdrawals in flight or with an unknown outcome`,
      );
    }
    const remaining = limits.dailyMaxMicro > r.used ? limits.dailyMaxMicro - r.used : 0n;
    return deny(
      "treasury_withdraw_daily_max",
      `Exceeds the 24h treasury withdrawal cap of ${formatMicroToUsdc(limits.dailyMaxMicro)} USDC`,
      "POLICY_DENIED",
      {
        ruleId: "treasury_withdraw_daily_max",
        unit: "usdc",
        attempted: input.amountMicro,
        cap: limits.dailyMaxMicro,
        used: r.used,
        remaining,
        window: "24h",
      },
    );
  };

  if (input.dryRun) {
    const refused = capCheck(inFlightMicro(org.id), store.treasuryWithdrawOpenMicro(org.id));
    if (refused) return refuseCap(refused);
    return { ok: true, intentId, commit: () => {}, fail: () => {} };
  }

  // Check and reserve in one IMMEDIATE transaction in the shared database.
  if (isUsdc) {
    let refused: CapRefusal | null = null;
    const reserved = store.reserveTreasuryWithdraw({
      intentId,
      orgId: org.id,
      agentId: `guardian:${input.actor}`,
      destination: destination || "external",
      amountMicro: input.amountMicro,
      check: (inFlight, open) => {
        refused = capCheck(inFlight, open);
        return refused ? refused.rule : null;
      },
    });
    if (!reserved.ok) return refuseCap(refused!);
  }
  let settled = false;

  return {
    ok: true,
    intentId,
    commit: () => {
      if (settled) return;
      settled = true;
      recordDecision({
        ...base,
        outcome: "allow",
        ruleIds: ["treasury_withdraw_allowed"],
        reasons: [`Treasury withdrawal by ${input.actor} passed guardian policy`],
      });
    },
    fail: (reason, code) => {
      if (settled) return;
      settled = true;
      recordDecision({
        ...base,
        outcome: "deny",
        ruleIds: ["execution_failed"],
        reasons: [`Treasury withdrawal did not complete${code ? ` (${code})` : ""}: ${reason}`],
      });
      // Free the reservation: nothing was broadcast.
      if (isUsdc) {
        store.finishSettlement(intentId, {
          state: "failed",
          error: `${code ? `${code}: ` : ""}${reason}`,
        });
      }
    },
  };
}

/** Test hook: clear in-flight reservations. */
export function __resetTreasuryGuardForTests(): void {
  /* reservations live in the database now; tests reset it with the DB */
}
