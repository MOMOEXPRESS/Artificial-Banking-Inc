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
import { simulatePolicy } from "../analytics.js";
import { store, type OrgRow } from "../store.js";
import { resolvedPolicyFor } from "../engine.js";

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
    quietHoursTimezone: template.quietHoursTimezone ?? "UTC",
    orgDailyMaxUsdc:
      template.orgDailyMaxMicro === undefined
        ? null
        : formatMicroToUsdc(template.orgDailyMaxMicro),
    approvalQuorum: template.approvalQuorum ?? 1,
    categoryCaps: Object.fromEntries(
      Object.entries(template.categoryCaps ?? {}).map(([key, cap]) => [
        key,
        {
          perTxMaxUsdc:
            cap.perTxMaxMicro === undefined ? null : formatMicroToUsdc(cap.perTxMaxMicro),
          dailyMaxUsdc:
            cap.dailyMaxMicro === undefined ? null : formatMicroToUsdc(cap.dailyMaxMicro),
          hitlAboveUsdc:
            cap.hitlAboveMicro === undefined ? null : formatMicroToUsdc(cap.hitlAboveMicro),
          blocked: cap.blocked ?? false,
        },
      ]),
    ),
    budgetWindow: template.budgetWindow
      ? {
          startsAt:
            template.budgetWindow.startsAtMs === undefined
              ? null
              : new Date(template.budgetWindow.startsAtMs).toISOString(),
          endsAt:
            template.budgetWindow.endsAtMs === undefined
              ? null
              : new Date(template.budgetWindow.endsAtMs).toISOString(),
          totalMaxUsdc:
            template.budgetWindow.totalMaxMicro === undefined
              ? null
              : formatMicroToUsdc(template.budgetWindow.totalMaxMicro),
          label: template.budgetWindow.label ?? null,
        }
      : null,
    counterpartyRiskReviewAbove: template.counterpartyRiskReviewAbove ?? null,
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

/** Per-category ceilings, keyed by lowercase category (P6-T3). */
const categoryCapsSchema = z
  .record(
    z.string().min(1).max(48),
    z.object({
      perTxMaxUsdc: z.string().optional(),
      dailyMaxUsdc: z.string().optional(),
      hitlAboveUsdc: z.string().optional(),
      blocked: z.boolean().optional(),
    }),
  )
  .nullable()
  .optional();

/** Time-boxed budget (P6-T4). null clears it. */
const budgetWindowSchema = z
  .object({
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
    totalMaxUsdc: z.string().nullable().optional(),
    label: z.string().max(80).optional(),
  })
  .nullable()
  .optional();

type CategoryCapsInput = z.infer<typeof categoryCapsSchema>;
type BudgetWindowInput = z.infer<typeof budgetWindowSchema>;

function toCategoryCaps(input: CategoryCapsInput) {
  if (input === null || input === undefined) return undefined;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [rawKey, cap] of Object.entries(input)) {
    const key = rawKey.trim().toLowerCase();
    if (!key) continue;
    out[key] = {
      ...(cap.perTxMaxUsdc !== undefined && { perTxMaxMicro: parseUsdcToMicro(cap.perTxMaxUsdc) }),
      ...(cap.dailyMaxUsdc !== undefined && { dailyMaxMicro: parseUsdcToMicro(cap.dailyMaxUsdc) }),
      ...(cap.hitlAboveUsdc !== undefined && {
        hitlAboveMicro: parseUsdcToMicro(cap.hitlAboveUsdc),
      }),
      ...(cap.blocked !== undefined && { blocked: cap.blocked }),
    };
  }
  return out;
}

function toBudgetWindow(input: BudgetWindowInput) {
  if (input === null || input === undefined) return undefined;
  return {
    ...(input.startsAt ? { startsAtMs: Date.parse(input.startsAt) } : {}),
    ...(input.endsAt ? { endsAtMs: Date.parse(input.endsAt) } : {}),
    ...(input.totalMaxUsdc ? { totalMaxMicro: parseUsdcToMicro(input.totalMaxUsdc) } : {}),
    ...(input.label ? { label: input.label } : {}),
  };
}

/**
 * A per-agent override. Every field optional: anything omitted inherits the
 * organization default rather than being reset.
 */
const agentOverrideSchema = z.object({
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
  quietHoursTimezone: z.string().max(64).optional(),
  categoryCaps: categoryCapsSchema,
  budgetWindow: budgetWindowSchema,
  counterpartyRiskReviewAbove: z.number().int().min(0).max(100).nullable().optional(),
});

/** Best-effort label for who changed a policy, for the audit trail. */
function guardianLabel(req: express.Request): string {
  const ctx = (req as express.Request & { guardianCtx?: { user?: { email: string } } }).guardianCtx;
  return ctx?.user?.email ?? "guardian-key";
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

  // ---------------------------------------------------------- per-agent

  /**
   * The policy an agent is actually under, and which layer supplied each value.
   *
   * Policy used to be one row per organization, so an operator could not tell
   * (and could not change) what a single agent was permitted to do.
   */
  app.get(
    "/v1/guardian/agents/:id/policy",
    guardianRoute((org, req, res) => {
      const agent = store.getAgent(req.params.id);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
      }
      const { effective, provenance } = resolvedPolicyFor(agent.id, org.id);
      res.json({
        agentId: agent.id,
        effective: policyView(effective),
        // Which fields this agent overrides, so the UI can show inheritance
        // rather than a flat list an operator has to diff by eye.
        provenance,
        hasOverride: store.getAgentPolicyOverride(agent.id) !== null,
        orgDefault: policyView(store.getPolicyTemplate(org.id)),
      });
    }),
  );

  /**
   * Set or update an agent's override. Only the fields sent are overridden;
   * everything else keeps inheriting the organization default.
   */
  app.put(
    "/v1/guardian/agents/:id/policy",
    guardianRoute((org, req, res) => {
      const agent = store.getAgent(req.params.id);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
      }
      const body = agentOverrideSchema.parse(req.body);

      const override: Record<string, unknown> = {};
      if (body.perTxMaxUsdc !== undefined) override.perTxMaxMicro = parseUsdcToMicro(body.perTxMaxUsdc);
      if (body.dailyMaxUsdc !== undefined) override.dailyMaxMicro = parseUsdcToMicro(body.dailyMaxUsdc);
      if (body.hitlAboveUsdc !== undefined) override.hitlAboveMicro = parseUsdcToMicro(body.hitlAboveUsdc);
      if (body.maxPaysPerMinute !== undefined) override.maxPaysPerMinute = body.maxPaysPerMinute;
      if (body.newCounterpartyCooldownHours !== undefined) {
        override.newCounterpartyCooldownHours = body.newCounterpartyCooldownHours;
      }
      if (body.addressAllowlist) override.addressAllowlist = body.addressAllowlist;
      if (body.domainAllowlist) override.domainAllowlist = body.domainAllowlist;
      if (body.vendorAllowlist) override.vendorAllowlist = body.vendorAllowlist;
      if (body.blocklist) override.blocklist = body.blocklist;
      if (body.hitlCategories) override.hitlCategories = body.hitlCategories;
      if (body.quietHours !== undefined) override.quietHours = body.quietHours ?? undefined;
      if (body.quietHoursTimezone !== undefined) override.quietHoursTimezone = body.quietHoursTimezone;
      // null clears the override so the agent inherits the org default again;
      // undefined leaves whatever it already had.
      if (body.categoryCaps !== undefined) override.categoryCaps = toCategoryCaps(body.categoryCaps);
      if (body.budgetWindow !== undefined) override.budgetWindow = toBudgetWindow(body.budgetWindow);
      if (body.counterpartyRiskReviewAbove !== undefined) {
        override.counterpartyRiskReviewAbove = body.counterpartyRiskReviewAbove ?? undefined;
      }

      // Bands must still nest after merging, or an override could invert them
      // and quietly disable the approval step for this agent.
      const merged = { ...store.getPolicyTemplate(org.id), ...override } as ReturnType<
        typeof store.getPolicyTemplate
      >;
      if (merged.hitlAboveMicro >= merged.perTxMaxMicro) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message:
              "hitlAboveUsdc must stay below perTxMaxUsdc once merged with the org default " +
              "(allow < review < deny).",
          },
        });
      }
      if (merged.dailyMaxMicro < merged.perTxMaxMicro) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "dailyMaxUsdc must be at least perTxMaxUsdc once merged with the org default.",
          },
        });
      }

      store.setAgentPolicyOverride(org.id, agent.id, override, guardianLabel(req));
      const { effective, provenance } = resolvedPolicyFor(agent.id, org.id);
      res.json({ ok: true, agentId: agent.id, effective: policyView(effective), provenance });
    }, { ownerOnly: true }),
  );

  /** Drop the override so the agent inherits the organization default again. */
  app.delete(
    "/v1/guardian/agents/:id/policy",
    guardianRoute((org, req, res) => {
      const agent = store.getAgent(req.params.id);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
      }
      const removed = store.clearAgentPolicyOverride(agent.id);
      const { effective } = resolvedPolicyFor(agent.id, org.id);
      res.json({ ok: true, removed, effective: policyView(effective) });
    }, { ownerOnly: true }),
  );

  /** Which agents deviate from the org default — the policy screen's index. */
  app.get(
    "/v1/guardian/policy/overrides",
    guardianRoute((org, _req, res) => {
      res.json({ overrides: store.listAgentPolicyOverrides(org.id) });
    }),
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
          /** Ceiling for the whole org in 24h. null removes it. */
          orgDailyMaxUsdc: z.string().nullable().optional(),
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
          /** IANA zone the quiet-hours window is expressed in. */
          quietHoursTimezone: z.string().max(64).optional(),
          /** Per-category ceilings. null clears every category cap. */
          categoryCaps: categoryCapsSchema,
          /** Time-boxed budget. null clears it. */
          budgetWindow: budgetWindowSchema,
          /** Review above this counterparty risk score (0-100). null disables. */
          counterpartyRiskReviewAbove: z.number().int().min(0).max(100).nullable().optional(),
          automation: z
            .array(
              z.object({
                id: z.string().min(1),
                name: z.string().min(1),
                createdAt: z.string().optional(),
                updatedAt: z.string().optional(),
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
                  z.object({ kind: z.literal("daily_cap_exceeded") }),
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
      const prevById = new Map((current.automation ?? []).map((r) => [r.id, r]));
      const stamp = new Date().toISOString();
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
        ...(body.quietHoursTimezone !== undefined && {
          quietHoursTimezone: body.quietHoursTimezone,
        }),
        ...(body.orgDailyMaxUsdc !== undefined && {
          orgDailyMaxMicro:
            body.orgDailyMaxUsdc === null ? undefined : parseUsdcToMicro(body.orgDailyMaxUsdc),
        }),
        ...(body.categoryCaps !== undefined && { categoryCaps: toCategoryCaps(body.categoryCaps) }),
        ...(body.budgetWindow !== undefined && { budgetWindow: toBudgetWindow(body.budgetWindow) }),
        ...(body.counterpartyRiskReviewAbove !== undefined && {
          counterpartyRiskReviewAbove: body.counterpartyRiskReviewAbove ?? undefined,
        }),
        ...(body.automation !== undefined && {
          automation: body.automation.map((rule) => {
            const prev = prevById.get(rule.id);
            return {
              ...rule,
              createdAt: prev?.createdAt ?? rule.createdAt ?? stamp,
              updatedAt: stamp,
              when:
                rule.when.kind === "amount_above" || rule.when.kind === "balance_below"
                  ? { ...rule.when, micro: parseAutomationMicro(rule.when.micro) }
                  : rule.when,
            };
          }),
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
      if (next.orgDailyMaxMicro !== undefined && next.orgDailyMaxMicro < next.perTxMaxMicro) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message:
              "orgDailyMaxUsdc must be at least perTxMaxUsdc — otherwise no single payment " +
              "could ever clear the organization ceiling.",
          },
        });
      }
      if (next.dailyMaxMicro < next.perTxMaxMicro) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "dailyMaxUsdc must be at least perTxMaxUsdc (daily headroom ≥ per-payment ceiling)",
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
