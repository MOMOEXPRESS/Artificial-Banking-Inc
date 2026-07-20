/**
 * Compliance screening hook.
 *
 * Default: EnvDenylistScreener (always on; empty denylist = allow-all behavior).
 * Optional: ABI_COMPLIANCE_WEBHOOK_URL HTTP vendor via CompositeScreener.
 * Full Chainalysis / TRM adapters implement `ComplianceScreener` without changing executeIntent.
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

/** Run multiple screeners in order — first failure wins. */
export class CompositeScreener implements ComplianceScreener {
  readonly name: string;
  constructor(private readonly screeners: ComplianceScreener[]) {
    this.name = `composite(${screeners.map((s) => s.name).join("+")})`;
  }

  async screenDestination(
    destination: string,
    ctx: { orgId: string; agentId: string },
  ): Promise<ScreenResult> {
    for (const s of this.screeners) {
      const result = await s.screenDestination(destination, ctx);
      if (!result.ok) return result;
    }
    return { ok: true };
  }
}

/** Simple env-driven denylist for demos / sanctions dry-runs. */
export class EnvDenylistScreener implements ComplianceScreener {
  readonly name = "env-denylist";
  async screenDestination(destination: string): Promise<ScreenResult> {
    const raw = process.env.ABI_COMPLIANCE_DENYLIST ?? "";
    const blocked = raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    let dest = destination.trim().toLowerCase();
    try {
      if (dest.startsWith("http")) dest = new URL(dest).hostname;
    } catch {
      /* keep raw */
    }
    const hit = blocked.find((b) => dest === b || (b.includes(".") && dest.endsWith(`.${b}`)));
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

/**
 * Optional HTTP vendor screener — POST destination to ABI_COMPLIANCE_WEBHOOK_URL.
 * Expects `{ "ok": true|false, "reason"?: string }` JSON. Fail-open on network errors
 * unless ABI_COMPLIANCE_FAIL_CLOSED=1.
 */
export class HttpVendorScreener implements ComplianceScreener {
  readonly name = "http-vendor";
  constructor(private readonly url: string) {}

  async screenDestination(
    destination: string,
    ctx: { orgId: string; agentId: string },
  ): Promise<ScreenResult> {
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destination, orgId: ctx.orgId, agentId: ctx.agentId }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        if (process.env.ABI_COMPLIANCE_FAIL_CLOSED === "1") {
          return {
            ok: false,
            code: "COMPLIANCE_UNAVAILABLE",
            reason: `Compliance vendor HTTP ${res.status}`,
            provider: this.name,
          };
        }
        return { ok: true };
      }
      const body = (await res.json()) as { ok?: boolean; reason?: string; code?: string };
      if (body.ok === false) {
        return {
          ok: false,
          code: body.code ?? "COMPLIANCE_BLOCKED",
          reason: body.reason ?? "Blocked by compliance vendor",
          provider: this.name,
        };
      }
      return { ok: true };
    } catch (e) {
      if (process.env.ABI_COMPLIANCE_FAIL_CLOSED === "1") {
        return {
          ok: false,
          code: "COMPLIANCE_UNAVAILABLE",
          reason: `Compliance vendor error: ${String(e)}`,
          provider: this.name,
        };
      }
      return { ok: true };
    }
  }
}

/** Build the default composite screener from env. */
export function defaultComplianceScreener(): ComplianceScreener {
  const parts: ComplianceScreener[] = [new EnvDenylistScreener()];
  const webhook = process.env.ABI_COMPLIANCE_WEBHOOK_URL?.trim();
  if (webhook) parts.push(new HttpVendorScreener(webhook));
  return parts.length === 1 ? parts[0]! : new CompositeScreener(parts);
}

let screener: ComplianceScreener = defaultComplianceScreener();

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
