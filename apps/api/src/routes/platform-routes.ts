/**
 * Cross-cutting platform surfaces for Observability, Security, Enterprise,
 * Ecosystem, Notifications, Compliance — keeps index.ts from growing further.
 */
import { parseUsdcToMicro } from "@policyvault/common";
import type express from "express";
import { z } from "zod";
import { getComplianceScreener } from "../platform/compliance.js";
import { getObservabilitySink, recordObs } from "../platform/observability.js";
import { isTestnetChain } from "../chain/asset-adapters.js";
import { activeChain } from "../chain/network.js";
import { store, type OrgRow } from "../store.js";

type GuardianRoute = (
  handler: (org: OrgRow, req: express.Request, res: express.Response) => unknown,
  opts?: { ownerOnly?: boolean },
) => express.RequestHandler;

export function registerPlatformRoutes(
  app: express.Express,
  deps: { guardianRoute: GuardianRoute },
): void {
  const { guardianRoute } = deps;

  const profileSchema = z.object({
    displayName: z.string().trim().min(1).max(80),
    legalName: z.string().trim().max(160).default(""),
    website: z
      .union([
        z.literal(""),
        z
          .string()
          .url()
          .max(300)
          .refine((url) => /^https:\/\//i.test(url), "Use an HTTPS website"),
      ])
      .default(""),
    description: z.string().trim().max(1000).default(""),
    country: z.string().trim().max(80).default(""),
    timezone: z.string().trim().max(100).default("UTC"),
    organizationType: z.enum(["company", "individual", "nonprofit", "other"]).default("other"),
    defaultCurrencyDisplay: z.enum(["USD", "EUR"]).default("USD"),
    intendedUse: z.string().trim().max(500).default(""),
    workspace: z.enum(["buyer", "seller", "both"]).default("buyer"),
  });

  app.get(
    "/v1/guardian/organization-profile",
    guardianRoute((org, _req, res) => {
      res.json({
        orgId: org.id,
        status: org.status,
        environment: isTestnetChain(activeChain().id) ? "testnet" : "mainnet",
        profile: {
          displayName: org.name,
          ...(org.settings.profile &&
          typeof org.settings.profile === "object" &&
          !Array.isArray(org.settings.profile)
            ? org.settings.profile
            : {}),
        },
      });
    }),
  );

  app.patch(
    "/v1/guardian/organization-profile",
    guardianRoute(
      (org, req, res) => {
        const profile = profileSchema.parse(req.body);
        // Seller operations require a dedicated seller org — workspace is not a
        // security boundary and cannot flip a buyer float into a seller catalog.
        if (
          org.kind !== "seller" &&
          (profile.workspace === "seller" || profile.workspace === "both")
        ) {
          return res.status(400).json({
            error: {
              code: "SELLER_ORG_REQUIRED",
              message:
                "Selling uses a separate partner account and seller organization. Start at /partnerships to create one.",
            },
          });
        }
        if (org.kind === "seller" && profile.workspace === "buyer") {
          return res.status(400).json({
            error: {
              code: "BUYER_ORG_REQUIRED",
              message:
                "This organization is a seller org. Switch to a buyer organization for buying workflows.",
            },
          });
        }
        const nextProfile =
          org.kind === "seller" ? { ...profile, workspace: "seller" as const } : profile;
        store.setOrgProfile(org.id, nextProfile.displayName, {
          ...org.settings,
          profile: nextProfile,
        });
        recordObs({ name: "org.profile_updated", orgId: org.id });
        res.json({ ok: true, orgId: org.id, profile: nextProfile });
      },
      { ownerOnly: true },
    ),
  );

  // ----------------------------------------------------------- Enterprise
  app.get(
    "/v1/guardian/settings",
    guardianRoute((org, _req, res) => {
      res.json({
        orgId: org.id,
        name: org.name,
        status: org.status,
        settings: org.settings ?? {},
      });
    }),
  );

  app.patch(
    "/v1/guardian/settings",
    guardianRoute(
      (org, req, res) => {
        const body = z.object({ settings: z.record(z.unknown()) }).parse(req.body);
        // The treasury approval threshold decides when guardian money waits
        // for review. A malformed value would silently fall back to the
        // default, so refuse it here where the operator can see why.
        if ("treasuryHitlUsdc" in body.settings) {
          const raw = body.settings.treasuryHitlUsdc;
          let ok = typeof raw === "string" || typeof raw === "number";
          if (ok) {
            try {
              ok = parseUsdcToMicro(String(raw).trim()) >= 0n;
            } catch {
              ok = false;
            }
          }
          if (!ok) {
            return res.status(400).json({
              error: {
                code: "VALIDATION_ERROR",
                message: "treasuryHitlUsdc must be a non-negative USDC amount",
              },
            });
          }
          body.settings.treasuryHitlUsdc = String(raw).trim();
        }
        const next = { ...org.settings, ...body.settings };
        store.setOrgSettings(org.id, next);
        recordObs({ name: "org.settings_updated", orgId: org.id });
        res.json({ ok: true, settings: next });
      },
      { ownerOnly: true },
    ),
  );

  // ------------------------------------------------------------- Security
  /** Append-only decision audit export (JSON). CSV via Accept header. */
  app.get(
    "/v1/guardian/audit/export",
    guardianRoute((org, req, res) => {
      const limit = Math.min(Number(req.query.limit ?? 500), 5000);
      const decisions = store.listDecisions(org.id, limit);
      const freezes = store.listFreezes(org.id, 200);
      const wantCsv = String(req.headers.accept ?? "").includes("text/csv");
      const wantHtml =
        String(req.headers.accept ?? "").includes("text/html") || req.query.format === "html";
      const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
      const escapeHtml = (value: unknown) =>
        String(value ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (wantCsv) {
        const header = "at,agentId,tool,outcome,amountUsdc,destination,ruleIds,reasons\n";
        const lines = decisions.map((d) =>
          [
            d.at,
            d.agentId,
            d.tool,
            d.outcome,
            d.amountUsdc,
            d.destination,
            d.ruleIds.join("|"),
            d.reasons.join("|"),
          ]
            .map(csvCell)
            .join(","),
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="abi-audit-${org.id.slice(0, 12)}.csv"`,
        );
        return res.send(`\uFEFF${header}${lines.join("\n")}`);
      }
      if (wantHtml) {
        const exportedAt = new Date().toISOString();
        const allowed = decisions.filter((d) => d.outcome === "allow");
        const denied = decisions.filter((d) => d.outcome === "deny");
        const reviewed = decisions.filter((d) => d.outcome === "review");
        const settledUsdc = allowed.reduce((sum, d) => sum + Number(d.amountUsdc), 0);
        const rows = decisions
          .map(
            (d) => `<tr>
              <td>${escapeHtml(new Date(d.at).toLocaleString("en-US", { timeZone: "UTC" }))} UTC</td>
              <td>${escapeHtml(d.agentId)}</td><td>${escapeHtml(d.tool)}</td>
              <td><span class="status ${escapeHtml(d.outcome)}">${escapeHtml(d.outcome)}</span></td>
              <td class="money">$${escapeHtml(d.amountUsdc)}</td><td>${escapeHtml(d.destination)}</td>
              <td>${escapeHtml(d.ruleIds.join(", ") || "—")}</td>
              <td>${escapeHtml(d.reasons.join("; ") || "—")}</td>
            </tr>`,
          )
          .join("");
        const year = new Date().getUTCFullYear();
        const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
          <title>ABI Decision Trail · ${escapeHtml(org.name)}</title>
          <style>
            :root{color-scheme:light;--ink:#111827;--muted:#667085;--line:#e4e7ec;--paper:#fff;--navy:#101828;--green:#067647;--green-bg:#ecfdf3;--red:#b42318;--red-bg:#fef3f2;--amber:#b54708;--amber-bg:#fffaeb}*{box-sizing:border-box}body{margin:0;background:#f2f4f7;color:var(--ink);font:13px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.report{width:min(1420px,calc(100% - 48px));margin:32px auto;background:var(--paper);box-shadow:0 18px 50px #1018281a;border:1px solid var(--line)}header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;padding:34px 38px 28px;border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:12px}.mark{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:var(--navy);color:#fff;font-weight:800;letter-spacing:-1px}.brand b{display:block;font-size:19px;letter-spacing:-.3px}.brand span,.meta,.caption{color:var(--muted)}h1{font-size:25px;line-height:1.15;margin:0 0 8px;letter-spacing:-.6px}.meta{text-align:right}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:24px 38px}.metric{padding:16px;border:1px solid var(--line);border-radius:12px}.metric span{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}.metric b{display:block;font-size:22px;margin-top:5px}.table-wrap{padding:0 38px 34px;overflow:auto}table{width:100%;border-collapse:collapse}th{padding:11px 10px;border-block:1px solid var(--line);background:#f9fafb;text-align:left;color:#475467;font-size:10px;text-transform:uppercase;letter-spacing:.06em}td{padding:12px 10px;border-bottom:1px solid #eef0f3;vertical-align:top;max-width:300px;overflow-wrap:anywhere}.money{text-align:right;font-variant-numeric:tabular-nums}.status{display:inline-flex;padding:3px 8px;border-radius:999px;font-weight:700;text-transform:capitalize}.status.allow{color:var(--green);background:var(--green-bg)}.status.deny{color:var(--red);background:var(--red-bg)}.status.review{color:var(--amber);background:var(--amber-bg)}footer{display:flex;justify-content:space-between;gap:20px;padding:18px 38px;border-top:1px solid var(--line);color:var(--muted);font-size:11px}@media print{body{background:#fff}.report{width:100%;margin:0;border:0;box-shadow:none}.table-wrap{overflow:visible}tr{break-inside:avoid}footer{position:running(footer)}}@media(max-width:800px){.summary{grid-template-columns:1fr 1fr}header,footer{flex-direction:column}.meta{text-align:left}.report{width:100%;margin:0}.summary,.table-wrap,header,footer{padding-inline:20px}}
          </style></head><body><main class="report"><header><div class="brand"><div class="mark">ABI</div><div><b>Artificial Banking Incorporated</b><span>Financial control infrastructure for AI agents</span></div></div><div class="meta"><h1>Decision Trail</h1><div>${escapeHtml(org.name)}</div><div>Generated ${escapeHtml(exportedAt)}</div></div></header>
          <section class="summary"><div class="metric"><span>Decisions</span><b>${decisions.length}</b></div><div class="metric"><span>Allowed</span><b>${allowed.length}</b></div><div class="metric"><span>Reviewed / denied</span><b>${reviewed.length} / ${denied.length}</b></div><div class="metric"><span>Allowed value</span><b>$${settledUsdc.toFixed(2)}</b></div></section>
          <div class="table-wrap"><p class="caption">Append-only policy decision record. Amounts are denominated in USDC.</p><table><thead><tr><th>Time</th><th>Agent</th><th>Tool</th><th>Outcome</th><th class="money">Amount</th><th>Destination</th><th>Rules</th><th>Reason</th></tr></thead><tbody>${rows || '<tr><td colspan="8">No decisions recorded.</td></tr>'}</tbody></table></div>
          <footer><span>Confidential · ABI operational record</span><span>© ${year} Artificial Banking Incorporated. All rights reserved.</span></footer></main></body></html>`;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="abi-decision-trail-${org.id.slice(0, 12)}.html"`,
        );
        return res.send(html);
      }
      res.json({
        orgId: org.id,
        exportedAt: new Date().toISOString(),
        decisions,
        freezes,
        counts: {
          decisions: decisions.length,
          freezes: freezes.length,
        },
      });
    }),
  );

  // ---------------------------------------------------------- Compliance
  app.get(
    "/v1/guardian/compliance",
    guardianRoute((org, _req, res) => {
      const screener = getComplianceScreener();
      const denylist = (process.env.ABI_COMPLIANCE_DENYLIST ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      res.json({
        orgId: org.id,
        screener: screener.name,
        denylistConfigured: denylist.length > 0,
        denylistCount: denylist.length,
        /** Destinations never returned — only counts, so exports stay safe. */
        note: "Screening runs on pay + escrow_lock. Default EnvDenylistScreener; set ABI_COMPLIANCE_WEBHOOK_URL for HTTP vendor via CompositeScreener.",
      });
    }),
  );

  // -------------------------------------------------------- Observability
  app.get(
    "/v1/guardian/observability",
    guardianRoute((org, _req, res) => {
      const sink = getObservabilitySink();
      res.json({
        orgId: org.id,
        sink: sink.constructor.name,
        note: "recordObs() fans into ObservabilitySink — PrometheusSink at boot; scrape GET /metrics.",
      });
    }),
  );

  // ----------------------------------------------------------- Ecosystem
  app.delete(
    "/v1/guardian/merchants/:id",
    guardianRoute(
      (org, req, res) => {
        const ok = store.deleteMerchant(org.id, req.params.id);
        if (!ok) {
          return res.status(404).json({ error: { code: "NOT_FOUND", message: "merchant" } });
        }
        res.json({ ok: true });
      },
      { ownerOnly: true },
    ),
  );
}
