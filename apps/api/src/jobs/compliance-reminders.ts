/**
 * Remind organizations that have not finished KYC / KYA profile checks.
 *
 * Runs on the background scheduler (and Durable Object alarm). Also callable
 * from a guardian request so the console bell updates as soon as someone opens
 * the org — Workers set ABI_RUN_JOBS=0 for the HTTP isolate, but alarms still
 * run this job via JOBS.
 *
 * Deduped to at most one notification per kind per org per 24 hours so the
 * inbox is not spammed. Email follows IMPORTANT_KINDS in notifications.ts.
 */
import { effectiveKyc } from "../compliance-routes.js";
import { emitEvent } from "../webhooks.js";
import { store } from "../store.js";

const REMINDER_COOLDOWN_MS = 24 * 60 * 60_000;

function alreadyReminded(orgId: string, kind: string): boolean {
  return store.hasRecentNotificationKind(orgId, kind, REMINDER_COOLDOWN_MS);
}

/**
 * Emit KYC / KYA reminder notifications for one org when profiles are incomplete.
 * Returns how many reminders were recorded (0–2).
 */
export function ensureComplianceReminders(orgId: string): number {
  let recorded = 0;
  try {
    const kyc = effectiveKyc(orgId);
    const kycStatus = kyc?.status ?? "unverified";
    if (kycStatus === "unverified" || kycStatus === "pending") {
      const kind = "compliance.kyc_incomplete";
      if (!alreadyReminded(orgId, kind)) {
        emitEvent(orgId, kind, {
          title:
            kycStatus === "pending"
              ? "Finish KYC — verify the owner email"
              : "Complete organization KYC",
          body:
            kycStatus === "pending"
              ? "Your KYC profile is waiting on a verified owner email. Open Settings → Compliance to finish, then verify email if needed."
              : "Organization verification is incomplete. Complete Settings → Compliance (KYC) so spending limits and go-live checks can clear.",
          status: kycStatus,
          linkHint: "settings",
        });
        recorded += 1;
      }
    }

    const agents = store.listAgents(orgId).filter((a) => a.status !== "archived");
    const unattested = agents.filter((a) => {
      const kya = store.getAgentKya(orgId, a.id);
      return !kya || kya.status === "unattested";
    });
    if (unattested.length > 0) {
      const kind = "compliance.kya_incomplete";
      if (!alreadyReminded(orgId, kind)) {
        const names = unattested
          .slice(0, 4)
          .map((a) => a.name)
          .join(", ");
        const more = unattested.length > 4 ? ` (+${unattested.length - 4} more)` : "";
        emitEvent(orgId, kind, {
          title:
            unattested.length === 1
              ? `Attest agent · ${unattested[0]!.name}`
              : `Attest ${unattested.length} agents (KYA)`,
          body: `Know Your Agent is incomplete for ${names}${more}. Open Settings → Compliance and attest each agent before full deployment.`,
          unattestedCount: unattested.length,
          agentIds: unattested.map((a) => a.id),
        });
        recorded += 1;
      }
    }
  } catch (e) {
    console.error(`compliance-reminders org=${orgId} failed:`, e);
  }
  return recorded;
}

/** Sweep every org. Used by the scheduler / DO alarm. */
export function runComplianceReminders(): { orgs: number; reminded: number } {
  const ids = store.listOrgIds();
  let reminded = 0;
  for (const orgId of ids) {
    reminded += ensureComplianceReminders(orgId);
  }
  return { orgs: ids.length, reminded };
}
