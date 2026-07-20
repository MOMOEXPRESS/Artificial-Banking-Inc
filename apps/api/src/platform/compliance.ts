/**
 * Compliance screening hook.
 *
 * Today: allow-all (plus optional env denylist).
 * Tomorrow: Chainalysis / TRM / OFAC adapters implement `ComplianceScreener`
 * without changing `executeIntent`.
 */
export interface ScreenResult {
  ok: boolean;
  /** Stable code for audit / agent errors — maps to COMPLIANCE_BLOCKED when !ok. */
  code?: string;
  reason?: string;
  /** Provider that produced the hit (e.g. "ofac", "chainalysis"). */
  provider?: string;
}

export interface ComplianceScreener {
  readonly name: string;
  screenDestination(destination: string, ctx: { orgId: string; agentId: string }): Promise<ScreenResult>;
}

class AllowAllScreener implements ComplianceScreener {
  readonly name = "allow-all";
  async screenDestination(): Promise<ScreenResult> {
    return { ok: true };
  }
}

/** Simple env-driven denylist for demos / sanctions dry-runs. */
class EnvDenylistScreener implements ComplianceScreener {
  readonly name = "env-denylist";
  async screenDestination(destination: string): Promise<ScreenResult> {
    const raw = process.env.ABI_COMPLIANCE_DENYLIST ?? "";
    const blocked = raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const dest = destination.trim().toLowerCase();
    const hit = blocked.find((b) => dest === b || dest.includes(b));
    if (hit) {
      return {
        ok: false,
        code: "COMPLIANCE_BLOCKED",
        reason: `Destination matched compliance denylist entry “${hit}”`,
        provider: this.name,
      };
    }
    return { ok: true };
  }
}

let screener: ComplianceScreener =
  process.env.ABI_COMPLIANCE_DENYLIST ? new EnvDenylistScreener() : new AllowAllScreener();

export function setComplianceScreener(next: ComplianceScreener): void {
  screener = next;
}

export function getComplianceScreener(): ComplianceScreener {
  return screener;
}

export async function screenDestination(
  destination: string,
  ctx: { orgId: string; agentId: string },
): Promise<ScreenResult> {
  return screener.screenDestination(destination, ctx);
}
