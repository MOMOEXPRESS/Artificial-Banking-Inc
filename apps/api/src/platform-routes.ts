/**
 * Cross-cutting platform surfaces for Observability, Security, Enterprise,
 * Ecosystem, Notifications, Compliance — keeps index.ts from growing further.
 */
import type express from "express";
import { z } from "zod";
import { getComplianceScreener } from "./platform/compliance.js";
import { getObservabilitySink, recordObs } from "./platform/observability.js";
import { store, type OrgRow } from "./store.js";

type GuardianRoute = (
  handler: (org: OrgRow, req: express.Request, res: express.Response) => unknown,
  opts?: { ownerOnly?: boolean },
) => express.RequestHandler;

export function registerPlatformRoutes(
  app: express.Express,
  deps: { guardianRoute: GuardianRoute },
): void {
  const { guardianRoute } = deps;

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
    guardianRoute((org, req, res) => {
      const body = z.object({ settings: z.record(z.unknown()) }).parse(req.body);
      const next = { ...org.settings, ...body.settings };
      store.setOrgSettings(org.id, next);
      recordObs({ name: "org.settings_updated", orgId: org.id });
      res.json({ ok: true, settings: next });
    }, { ownerOnly: true }),
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
      if (wantCsv) {
        const header = "at,agentId,tool,outcome,amountUsdc,destination,ruleIds,reasons\n";
        const lines = decisions.map((d) =>
          [
            d.at,
            d.agentId,
            d.tool,
            d.outcome,
            d.amountUsdc,
            JSON.stringify(d.destination),
            JSON.stringify(d.ruleIds.join("|")),
            JSON.stringify(d.reasons.join("|")),
          ].join(","),
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="abi-audit-${org.id.slice(0, 12)}.csv"`,
        );
        return res.send(header + lines.join("\n"));
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
    guardianRoute((org, req, res) => {
      const ok = store.deleteMerchant(org.id, req.params.id);
      if (!ok) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "merchant" } });
      }
      res.json({ ok: true });
    }, { ownerOnly: true }),
  );
}
