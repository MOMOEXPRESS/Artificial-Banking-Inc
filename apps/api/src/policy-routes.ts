/**
 * Financial Policies HTTP surface — caps, lists, quiet hours, HITL, quorum,
 * automation, versions, templates, history simulator.
 */
import { formatMicroToUsdc, parseUsdcToMicro } from "@policyvault/common";
import {
  listPolicyTemplateCatalog,
  policyTemplateById,
  type PolicyTemplateId,
} from "@policyvault/policy";
import type express from "express";
import { z } from "zod";
import { simulatePolicy } from "./analytics.js";
import { store, type OrgRow } from "./store.js";

type GuardianRoute = (
  handler: (org: OrgRow, req: express.Request, res: express.Response) => unknown,
  opts?: { ownerOnly?: boolean },
) => express.RequestHandler;

const toolEnum = z.enum([
  "pay",
  "pay_api",
  "transfer_internal",
  "escrow_lock",
  "escrow_release",
  "escrow_refund",
  "withdraw",
]);

export function policyView(template: ReturnType<typeof store.getPolicyTemplate>) {
  return {
    perTxMaxUsdc: formatMicroToUsdc(template.perTxMaxMicro),
    dailyMaxUsdc: formatMicroToUsdc(template.dailyMaxMicro),
    hitlAboveUsdc: formatMicroToUsdc(template.hitlAboveMicro),
    maxPaysPerMinute: template.maxPaysPerMinute,
    newCounterpartyCooldownHours: template.newCounterpartyCooldownHours,
    addressAllowlist: template.addressAllowlist,
    domainAllowlist: template.domainAllowlist,
    vendorAllowlist: template.vendorAllowlist,
    blocklist: template.blocklist,
    hitlCategories: template.hitlCategories,
    quietHours: template.quietHours ?? null,
    approvalQuorum: template.approvalQuorum ?? 1,
    automation: (template.automation ?? []).map((rule) => ({
      ...rule,
      when:
        rule.when.kind === "amount_above" || rule.when.kind === "balance_below"
          ? { ...rule.when, micro: rule.when.micro.toString() }
          : rule.when,
    })),
  };
}

function versionSummary(template: ReturnType<typeof store.getPolicyTemplate>) {
  return {
    perTxMaxUsdc: formatMicroToUsdc(template.perTxMaxMicro),
    dailyMaxUsdc: formatMicroToUsdc(template.dailyMaxMicro),
    hitlAboveUsdc: formatMicroToUsdc(template.hitlAboveMicro),
    maxPaysPerMinute: template.maxPaysPerMinute,
    quietHours: Boolean(template.quietHours),
    automationCount: template.automation?.length ?? 0,
    approvalQuorum: template.approvalQuorum ?? 1,
  };
}

export function registerPolicyRoutes(
  app: express.Express,
  deps: { guardianRoute: GuardianRoute },
): void {
  const { guardianRoute } = deps;

  app.get(
    "/v1/guardian/quorum",
    guardianRoute((org, _req, res) => {
      const seats =
        store.listGuardians(org.id).filter((g) => !g.revokedAt && g.role !== "viewer").length + 1;
      res.json({
        approvalQuorum: store.getPolicyTemplate(org.id).approvalQuorum ?? 1,
        seats,
      });
    }),
  );

  app.post(
    "/v1/guardian/quorum",
    guardianRoute((org, req, res) => {
      const body = z.object({ approvalQuorum: z.number().int().min(1).max(5) }).parse(req.body);
      const current = store.getPolicyTemplate(org.id);
      const seats =
        store.listGuardians(org.id).filter((g) => !g.revokedAt && g.role !== "viewer").length + 1;
      if (body.approvalQuorum > seats) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: `Quorum of ${body.approvalQuorum} needs ${body.approvalQuorum} guardians; you have ${seats}. Approvals would be unresolvable.`,
          },
        });
      }
      store.setPolicyTemplate(org.id, { ...current, approvalQuorum: body.approvalQuorum });
      res.json({ ok: true, approvalQuorum: body.approvalQuorum });
    }, { ownerOnly: true }),
  );

  app.post(
    "/v1/guardian/policy/simulate",
    guardianRoute((org, req, res) => {
      const body = z
        .object({
          perTxMaxUsdc: z.string().optional(),
          dailyMaxUsdc: z.string().optional(),
          hitlAboveUsdc: z.string().optional(),
          maxPaysPerMinute: z.number().int().positive().optional(),
          newCounterpartyCooldownHours: z.number().int().min(0).optional(),
          addressAllowlist: z.array(z.string()).optional(),
          domainAllowlist: z.array(z.string()).optional(),
          vendorAllowlist: z.array(z.string()).optional(),
          blocklist: z.array(z.string()).optional(),
          hitlCategories: z.array(toolEnum).optional(),
          quietHours: z
            .object({
              startHour: z.number().int().min(0).max(23),
              endHour: z.number().int().min(0).max(23),
              action: z.enum(["review", "deny"]),
            })
            .nullable()
            .optional(),
          windowHours: z.number().int().positive().max(24 * 90).default(24 * 7),
        })
        .parse(req.body);
      const { windowHours, ...change } = body;
      res.json({ simulation: simulatePolicy(org.id, change, windowHours) });
    }),
  );

  app.get(
    "/v1/guardian/policy/versions",
    guardianRoute((org, _req, res) => {
      res.json({
        current: store.getPolicyVersion(org.id),
        versions: store.listPolicyVersions(org.id).map(({ rules, ...rest }) => ({
          ...rest,
          summary: versionSummary(rules),
        })),
      });
    }),
  );

  app.post(
    "/v1/guardian/policy/versions/:id/restore",
    guardianRoute((org, req, res) => {
      const versions = store.listPolicyVersions(org.id, 100);
      const hit = versions.find((v) => v.id === req.params.id || v.version === req.params.id);
      if (!hit) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "policy version" } });
      }
      store.setPolicyTemplate(org.id, hit.rules, `restore:${hit.version}`);
      res.json({ ok: true, policy: policyView(store.getPolicyTemplate(org.id)) });
    }, { ownerOnly: true }),
  );

  app.get(
    "/v1/guardian/policy/templates",
    guardianRoute((_org, _req, res) => {
      res.json({ templates: listPolicyTemplateCatalog() });
    }),
  );

  app.post(
    "/v1/guardian/policy/apply-template",
    guardianRoute((org, req, res) => {
      const body = z
        .object({
          templateId: z.enum(["solo_swarm", "swarm", "api_seller"]),
          /** Keep current allowlists when applying a starter template. */
          keepAllowlists: z.boolean().optional(),
        })
        .parse(req.body);
      const current = store.getPolicyTemplate(org.id);
      const next = policyTemplateById(body.templateId as PolicyTemplateId);
      if (body.keepAllowlists) {
        next.addressAllowlist = current.addressAllowlist;
        next.domainAllowlist = current.domainAllowlist;
        next.vendorAllowlist = current.vendorAllowlist;
        next.blocklist = current.blocklist;
      }
      // Preserve quorum seats choice unless template sets one.
      if (next.approvalQuorum === undefined) {
        next.approvalQuorum = current.approvalQuorum;
      }
      store.setPolicyTemplate(org.id, next, `template:${body.templateId}`);
      for (const v of [...next.vendorAllowlist, ...next.domainAllowlist, ...next.addressAllowlist]) {
        store.addKnownCounterparty(org.id, v);
      }
      res.json({ ok: true, policy: policyView(store.getPolicyTemplate(org.id)) });
    }, { ownerOnly: true }),
  );

  app.get(
    "/v1/guardian/policy",
    guardianRoute((org, _req, res) => {
      res.json({
        policy: policyView(store.getPolicyTemplate(org.id)),
        version: store.getPolicyVersion(org.id),
      });
    }),
  );

  app.post(
    "/v1/guardian/policy",
    guardianRoute((org, req, res) => {
      const body = z
        .object({
          perTxMaxUsdc: z.string().optional(),
          dailyMaxUsdc: z.string().optional(),
          hitlAboveUsdc: z.string().optional(),
          maxPaysPerMinute: z.number().int().positive().optional(),
          newCounterpartyCooldownHours: z.number().int().min(0).optional(),
          addressAllowlist: z.array(z.string()).optional(),
          domainAllowlist: z.array(z.string()).optional(),
          vendorAllowlist: z.array(z.string()).optional(),
          blocklist: z.array(z.string()).optional(),
          hitlCategories: z.array(toolEnum).optional(),
          quietHours: z
            .object({
              startHour: z.number().int().min(0).max(23),
              endHour: z.number().int().min(0).max(23),
              action: z.enum(["review", "deny"]),
            })
            .nullable()
            .optional(),
          automation: z
            .array(
              z.object({
                id: z.string().min(1),
                name: z.string().min(1),
                when: z.union([
                  z.object({
                    kind: z.literal("amount_above"),
                    micro: z.union([z.string(), z.number()]),
                  }),
                  z.object({
                    kind: z.literal("balance_below"),
                    micro: z.union([z.string(), z.number()]),
                    walletId: z.string().optional(),
                  }),
                  z.object({ kind: z.literal("merchant_unknown") }),
                  z.object({ kind: z.literal("budget_exceeded") }),
                ]),
                then: z.union([
                  z.object({
                    kind: z.literal("notify"),
                    channel: z.enum(["in_app", "telegram", "email", "slack"]).optional(),
                  }),
                  z.object({ kind: z.literal("require_approval") }),
                  z.object({ kind: z.literal("deny") }),
                  z.object({ kind: z.literal("freeze_agent") }),
                ]),
              }),
            )
            .optional(),
        })
        .parse(req.body);
      const current = store.getPolicyTemplate(org.id);
      const parseAutomationMicro = (v: string | number) =>
        typeof v === "number" ? BigInt(Math.trunc(v)) : BigInt(String(v).replace(/^bigint:/, ""));
      const next = {
        ...current,
        ...(body.perTxMaxUsdc !== undefined && { perTxMaxMicro: parseUsdcToMicro(body.perTxMaxUsdc) }),
        ...(body.dailyMaxUsdc !== undefined && { dailyMaxMicro: parseUsdcToMicro(body.dailyMaxUsdc) }),
        ...(body.hitlAboveUsdc !== undefined && {
          hitlAboveMicro: parseUsdcToMicro(body.hitlAboveUsdc),
        }),
        ...(body.maxPaysPerMinute !== undefined && { maxPaysPerMinute: body.maxPaysPerMinute }),
        ...(body.newCounterpartyCooldownHours !== undefined && {
          newCounterpartyCooldownHours: body.newCounterpartyCooldownHours,
        }),
        ...(body.addressAllowlist && { addressAllowlist: body.addressAllowlist }),
        ...(body.domainAllowlist && { domainAllowlist: body.domainAllowlist }),
        ...(body.vendorAllowlist && { vendorAllowlist: body.vendorAllowlist }),
        ...(body.blocklist && { blocklist: body.blocklist }),
        ...(body.hitlCategories && { hitlCategories: body.hitlCategories }),
        ...(body.quietHours !== undefined && { quietHours: body.quietHours ?? undefined }),
        ...(body.automation !== undefined && {
          automation: body.automation.map((rule) => ({
            ...rule,
            when:
              rule.when.kind === "amount_above" || rule.when.kind === "balance_below"
                ? { ...rule.when, micro: parseAutomationMicro(rule.when.micro) }
                : rule.when,
          })),
        }),
      };
      if (next.hitlAboveMicro >= next.perTxMaxMicro) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "hitlAboveUsdc must be below perTxMaxUsdc (allow < review < deny bands)",
          },
        });
      }
      store.setPolicyTemplate(org.id, next);
      for (const v of [...next.vendorAllowlist, ...next.domainAllowlist, ...next.addressAllowlist]) {
        store.addKnownCounterparty(org.id, v);
      }
      res.json({
        ok: true,
        policy: policyView(next),
        version: store.getPolicyVersion(org.id),
      });
    }, { ownerOnly: true }),
  );
}
