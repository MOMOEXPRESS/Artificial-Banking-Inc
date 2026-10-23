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
 *
 * Every outcome is written to the decisions table (tool `treasury_withdraw`,
 * agentId `guardian:<identity>`) so a refused or allowed withdrawal is
 * auditable by intent id, exactly like an agent decision.
 */
import { formatMicroToUsdc, parseUsdcToMicro } from "@policyvault/common";
import { id, recordDecision } from "./engine.js";
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

/**
 * Withdrawals authorized but not yet booked, per org. Reserved synchronously
 * (no await between check and reserve) so two concurrent withdrawals cannot
 * both fit under the same daily headroom. Single-process only — the same
 * caveat as the rest of the in-memory rate state; a multi-instance deployment
 * needs this in the shared store.
 */
const inFlight = new Map<string, Map<string, bigint>>();

function inFlightMicro(orgId: string): bigint {
  let sum = 0n;
  for (const v of inFlight.get(orgId)?.values() ?? []) sum += v;
  return sum;
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
  /** Structured numbers for cap denials (micro-USDC as decimal USDC strings). */
  limits?: {
    amountUsdc: string;
    capUsdc: string;
    usedUsdc?: string;
    remainingUsdc: string;
  };
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
    numbers?: TreasuryGuardDenial["limits"],
  ): TreasuryGuardDenial => {
    recordDecision({ ...base, outcome: "deny", ruleIds: [ruleId], reasons: [reason] });
    return {
      ok: false,
      intentId,
      status: 403,
      code,
      ruleIds: [ruleId],
      reasons: [reason],
      ...(numbers && { limits: numbers }),
    };
  };

  if (org.status === "frozen") {
    return deny("org_frozen", "Organization is frozen — unfreeze it before withdrawing", "FROZEN");
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
          amountUsdc: formatMicroToUsdc(input.amountMicro),
          capUsdc: formatMicroToUsdc(limits.maxMicro),
          remainingUsdc: formatMicroToUsdc(limits.maxMicro),
        },
      );
    }
    const used = treasuryWithdrawnLast24h(org.id, input.nowMs) + inFlightMicro(org.id);
    if (used + input.amountMicro > limits.dailyMaxMicro) {
      const remaining = limits.dailyMaxMicro > used ? limits.dailyMaxMicro - used : 0n;
      return deny(
        "treasury_withdraw_daily_max",
        `Exceeds the 24h treasury withdrawal cap of ${formatMicroToUsdc(limits.dailyMaxMicro)} USDC`,
        "POLICY_DENIED",
        {
          amountUsdc: formatMicroToUsdc(input.amountMicro),
          capUsdc: formatMicroToUsdc(limits.dailyMaxMicro),
          usedUsdc: formatMicroToUsdc(used),
          remainingUsdc: formatMicroToUsdc(remaining),
        },
      );
    }
  }

  // Reserve before the caller awaits anything.
  let orgMap = inFlight.get(org.id);
  if (!orgMap) {
    orgMap = new Map();
    inFlight.set(org.id, orgMap);
  }
  orgMap.set(intentId, isUsdc ? input.amountMicro : 0n);
  let settled = false;
  const release = () => {
    const m = inFlight.get(org.id);
    m?.delete(intentId);
    if (m && m.size === 0) inFlight.delete(org.id);
  };

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
      release();
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
      release();
    },
  };
}

/** Test hook: clear in-flight reservations. */
export function __resetTreasuryGuardForTests(): void {
  inFlight.clear();
}
