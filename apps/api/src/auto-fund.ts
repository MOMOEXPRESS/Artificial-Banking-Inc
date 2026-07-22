/**
 * Proactive top-ups for ops labels with auto-fund enabled.
 * Extracted so request-path sweeps (Vercel embed) and the long-lived
 * interval (local API) share one implementation.
 */
import {
  accountId,
  formatMicroToUsdc,
  parseUsdcToMicro,
} from "@policyvault/common";
import { transferAvailable } from "@policyvault/ledger";
import { id } from "./engine.js";
import { store } from "./store.js";
import { emitEvent } from "./webhooks.js";

/** Coalesce request-path sweeps so every /abi-api hit isn't a full ledger walk. */
let lastSweepAt = 0;
const SWEEP_MIN_GAP_MS = 5_000;

export function runAutoFundSweep(opts?: { force?: boolean }): { toppedUp: number } {
  const now = Date.now();
  if (!opts?.force && now - lastSweepAt < SWEEP_MIN_GAP_MS) {
    return { toppedUp: 0 };
  }
  lastSweepAt = now;

  let toppedUp = 0;
  for (const group of store.listAutoFundEnabledGroups()) {
    const cfg = group.autoFund;
    if (!cfg?.enabled || !group.budgetId) continue;
    let threshold: bigint;
    let topUp: bigint;
    try {
      threshold = parseUsdcToMicro(cfg.thresholdUsdc);
      topUp = parseUsdcToMicro(cfg.topUpUsdc);
    } catch {
      continue;
    }
    if (topUp <= 0n) continue;
    const dept = store.getDepartment(group.budgetId);
    if (!dept || dept.orgId !== group.orgId) continue;
    const fromAvailableId = accountId("department", dept.id);
    const memberIds = store.listGroupMemberIds(group.id);
    const minMs = Math.max(1, cfg.minIntervalMinutes) * 60_000;
    const now = Date.now();
    for (const agentId of memberIds) {
      const agent = store.getAgent(agentId);
      if (!agent || agent.orgId !== group.orgId || agent.status !== "active") continue;
      const last = store.lastAutoFundAt(group.id, agentId);
      if (last && now - new Date(last).getTime() < minMs) continue;
      const bal =
        store.getAccountMap(group.orgId).get(accountId("agent", agentId))?.balanceMicro ?? 0n;
      if (bal >= threshold) continue;
      const sourceAvail =
        store.getAccountMap(group.orgId).get(fromAvailableId)?.balanceMicro ?? 0n;
      if (sourceAvail < topUp) continue;
      store.applyEntries(group.orgId, [
        transferAvailable({
          orgId: group.orgId,
          journalId: id("j"),
          fromAvailableId,
          toAvailableId: accountId("agent", agentId),
          amountMicro: topUp,
          memo: `auto_fund:${group.id}`,
        }),
      ]);
      store.recordAutoFundRun({
        orgId: group.orgId,
        groupId: group.id,
        agentId,
        amountMicro: topUp,
      });
      emitEvent(group.orgId, "payment.succeeded", {
        kind: "auto_fund",
        groupId: group.id,
        agentId,
        amountUsdc: formatMicroToUsdc(topUp),
        budgetId: group.budgetId,
      });
      toppedUp += 1;
    }
  }
  return { toppedUp };
}
