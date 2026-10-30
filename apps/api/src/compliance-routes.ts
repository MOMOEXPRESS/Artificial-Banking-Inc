/**
 * KYC / KYA routes (in-house checks; see kyc-kya.ts for what they are and are not).
 *
 *   GET  /v1/guardian/compliance/kyc                 status, risk, limits, history
 *   PUT  /v1/guardian/compliance/kyc                 owner submits / updates the profile
 *   GET  /v1/guardian/compliance/agents              KYA for every agent in the org
 *   PUT  /v1/guardian/compliance/agents/:id          owner declares + attests one agent
 *   POST /v1/guardian/compliance/agents/:id/suspend  owner suspends spending
 *   POST /v1/guardian/compliance/agents/:id/reinstate
 */
import type express from "express";
import { z } from "zod";
import { scopedStore, store, type OrgRow } from "./store.js";
import {
  EMBARGOED_COUNTRIES,
  HIGH_RISK_COUNTRIES,
  KYC_TERMS_VERSION,
  SANCTIONS_LIST_VERSION,
  agentRiskTier,
  anomalyFlags,
  baselineCaps,
  complianceCapsEnforced,
  complianceGate,
  evaluateKyc,
  formatUsdc,
  highRiskCaps,
  keyFingerprint,
  kycInputProblem,
  normalizeCountry,
  type KycRecord,
} from "./kyc-kya.js";

type GuardianRoute = (
  handler: (org: OrgRow, req: express.Request, res: express.Response) => unknown,
  opts?: { ownerOnly?: boolean },
) => express.RequestHandler;

type CtxLike = { role: string; via: string; user?: { id: string; email: string; name: string } };

function ctxOf(req: express.Request): CtxLike | undefined {
  return (req as express.Request & { guardianCtx?: CtxLike }).guardianCtx;
}

function actorOf(req: express.Request): { id?: string; name: string } {
  const ctx = ctxOf(req);
  if (ctx?.user) return { id: ctx.user.id, name: ctx.user.name || ctx.user.email };
  return { name: "Owner guardian key" };
}

/**
 * The org's KYC with "pending" re-evaluated: once an owner verifies their
 * email, a pending profile becomes verified without resubmitting.
 */
export function effectiveKyc(orgId: string): KycRecord | undefined {
  const kyc = store.getOrgKyc(orgId);
  if (!kyc || kyc.status !== "pending") return kyc;
  const ownerEmailVerified = store.orgVerifiedOwnerEmails(orgId).length > 0;
  if (!ownerEmailVerified) return kyc;
  const ev = evaluateKyc({ ...kyc, termsAccepted: true }, { ownerEmailVerified });
  if (ev.status === "pending") return kyc;
  const next = store.upsertOrgKyc({
    ...kyc,
    status: ev.status,
    riskTier: ev.riskTier,
    statusReasons: ev.reasons,
    verifiedAt: ev.status === "verified" ? new Date().toISOString() : kyc.verifiedAt,
  });
  store.addComplianceEvent({
    orgId,
    subjectKind: "org",
    subjectId: orgId,
    action: `kyc.${ev.status}`,
    actor: "system",
    detail: { riskTier: ev.riskTier, reason: "owner email verified" },
  });
  return next;
}

const capsView = (c: { perTxMaxMicro: bigint; dailyMaxMicro: bigint }) => ({
  perPaymentUsdc: formatUsdc(c.perTxMaxMicro),
  dailyUsdc: formatUsdc(c.dailyMaxMicro),
});

/** One agent's KYA as the console shows it. */
export function agentKyaView(orgId: string, agentId: string) {
  const agent = scopedStore(orgId).getAgent(agentId);
  if (!agent) return undefined;
  const kya = store.getAgentKya(orgId, agentId);
  const kyc = effectiveKyc(orgId);
  const flags = anomalyFlags(store.agentActivityStats(orgId, agentId));
  const gate = complianceGate({ grandfathered: store.isComplianceGrandfathered(orgId), kyc, kya });
  return {
    agentId,
    name: agent.name,
    agentStatus: agent.status,
    ownerOrgId: orgId,
    keyFingerprint: keyFingerprint(agent.apiKey),
    status: kya?.status ?? "unattested",
    purpose: kya?.purpose ?? "",
    operator: kya?.operator ?? "",
    model: kya?.model ?? "",
    provider: kya?.provider ?? "",
    allowedCategories: kya?.allowedCategories ?? [],
    allowedCounterparties: kya?.allowedCounterparties ?? [],
    attestedBy: kya?.attestedByName ?? null,
    attestedAt: kya?.attestedAt ?? null,
    suspendedReason: kya?.suspendedReason ?? null,
    riskTier: agentRiskTier({ kya, orgTier: kyc?.riskTier, flags }),
    anomalyFlags: flags,
    spending:
      gate.kind === "block"
        ? { state: "blocked", reason: gate.reason }
        : gate.kind === "cap"
          ? { state: "capped", reason: gate.reason, ...capsView(gate.caps) }
          : { state: "policy", reason: "Only the agent's spending policy applies." },
  };
}

const kycBody = z.object({
  entityType: z.enum(["individual", "business"]),
  legalName: z.string().trim().max(120),
  businessName: z.string().trim().max(160).optional(),
  registrationNumber: z.string().trim().max(80).optional(),
  country: z.string().trim().min(2).max(2),
  ageAttested: z.boolean(),
  sanctionsAttested: z.boolean(),
  pepDeclared: z.boolean().default(false),
  intendedUse: z.string().trim().max(500),
  expectedMonthlyVolume: z.enum(["under_1k", "1k_10k", "10k_100k", "over_100k"]),
  termsAccepted: z.boolean(),
});

const listOf = (max: number) =>
  z
    .array(z.string().trim().max(200))
    .max(max)
    .default([])
    .transform((xs) => [...new Set(xs.map((x) => x.toLowerCase()).filter(Boolean))]);

const kyaBody = z.object({
  purpose: z.string().trim().max(300),
  operator: z.string().trim().max(120),
  model: z.string().trim().max(80).optional(),
  provider: z.string().trim().max(80).optional(),
  allowedCategories: listOf(20),
  allowedCounterparties: listOf(50),
  attest: z.boolean(),
});

export function registerComplianceRoutes(
  app: express.Express,
  deps: { guardianRoute: GuardianRoute },
): void {
  const { guardianRoute } = deps;

  app.get(
    "/v1/guardian/compliance/kyc",
    guardianRoute((org, _req, res) => {
      const kyc = effectiveKyc(org.id);
      const grandfathered = store.isComplianceGrandfathered(org.id);
      const enforced = complianceCapsEnforced();
      const gate = complianceGate({
        grandfathered,
        kyc,
        kya: { status: "attested", allowedCategories: [], allowedCounterparties: [] },
        enforceCaps: enforced,
      });
      res.json({
        orgId: org.id,
        status: kyc?.status ?? "unverified",
        riskTier: kyc?.riskTier ?? null,
        reasons: kyc?.statusReasons ?? [],
        profile: kyc
          ? {
              entityType: kyc.entityType,
              legalName: kyc.legalName,
              businessName: kyc.businessName ?? "",
              registrationNumber: kyc.registrationNumber ?? "",
              country: kyc.country,
              ageAttested: kyc.ageAttested,
              sanctionsAttested: kyc.sanctionsAttested,
              pepDeclared: kyc.pepDeclared,
              intendedUse: kyc.intendedUse,
              expectedMonthlyVolume: kyc.expectedMonthlyVolume,
              termsVersion: kyc.termsVersion ?? null,
              termsAcceptedAt: kyc.termsAcceptedAt ?? null,
              submittedAt: kyc.submittedAt ?? null,
              verifiedAt: kyc.verifiedAt ?? null,
            }
          : null,
        ownerEmailVerified: store.orgVerifiedOwnerEmails(org.id).length > 0,
        grandfathered,
        capsEnforced: enforced,
        orgLimits:
          gate.kind === "block"
            ? { state: "blocked", reason: gate.reason }
            : gate.kind === "cap"
              ? { state: "capped", reason: gate.reason, ...capsView(gate.caps) }
              : { state: "policy", reason: "Only your spending policies apply." },
        starterLimits: capsView(baselineCaps()),
        highRiskLimits: capsView(highRiskCaps()),
        termsVersion: KYC_TERMS_VERSION,
        sanctionsListVersion: SANCTIONS_LIST_VERSION,
        embargoedCountries: EMBARGOED_COUNTRIES,
        highRiskCountries: HIGH_RISK_COUNTRIES,
        events: store.listComplianceEvents(org.id, 30),
        disclaimer:
          "Internal, self-attested checks run by ABI. Not regulated identity verification, not a sanctions-screening service, and not a compliance certification.",
      });
    }),
  );

  app.put(
    "/v1/guardian/compliance/kyc",
    guardianRoute(
      (org, req, res) => {
        const body = kycBody.parse(req.body);
        const input = { ...body, country: normalizeCountry(body.country) };
        const problem = kycInputProblem(input);
        if (problem) {
          return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: problem } });
        }
        const prev = store.getOrgKyc(org.id);
        const ev = evaluateKyc(input, {
          ownerEmailVerified: store.orgVerifiedOwnerEmails(org.id).length > 0,
        });
        const actor = actorOf(req);
        const now = new Date().toISOString();
        const rec = store.upsertOrgKyc({
          orgId: org.id,
          subjectUserId: actor.id ?? prev?.subjectUserId,
          entityType: input.entityType,
          legalName: input.legalName,
          businessName: input.entityType === "business" ? input.businessName : undefined,
          registrationNumber:
            input.entityType === "business" ? input.registrationNumber || undefined : undefined,
          country: input.country,
          ageAttested: input.ageAttested,
          sanctionsAttested: input.sanctionsAttested,
          pepDeclared: input.pepDeclared,
          intendedUse: input.intendedUse,
          expectedMonthlyVolume: input.expectedMonthlyVolume,
          status: ev.status,
          riskTier: ev.riskTier,
          statusReasons: ev.reasons,
          termsVersion: KYC_TERMS_VERSION,
          termsAcceptedAt: now,
          submittedAt: now,
          verifiedAt: ev.status === "verified" ? now : undefined,
        });
        if (actor.id) store.recordTermsAcceptance(actor.id, KYC_TERMS_VERSION);
        store.addComplianceEvent({
          orgId: org.id,
          subjectKind: "org",
          subjectId: org.id,
          action: `kyc.${ev.status}`,
          actor: actor.name,
          detail: { riskTier: ev.riskTier, country: input.country, entityType: input.entityType },
        });
        res.json({
          ok: true,
          status: rec.status,
          riskTier: rec.riskTier,
          reasons: rec.statusReasons,
        });
      },
      { ownerOnly: true },
    ),
  );

  app.get(
    "/v1/guardian/compliance/agents",
    guardianRoute((org, _req, res) => {
      const agents = store
        .listAgents(org.id)
        .filter((a) => a.status !== "archived")
        .map((a) => agentKyaView(org.id, a.id))
        .filter(Boolean);
      res.json({ orgId: org.id, agents });
    }),
  );

  app.put(
    "/v1/guardian/compliance/agents/:id",
    guardianRoute(
      (org, req, res) => {
        const agent = scopedStore(org.id).getAgent(req.params.id);
        if (!agent) return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
        const body = kyaBody.parse(req.body);
        if (body.attest && (body.purpose.length < 4 || body.operator.length < 2)) {
          return res.status(400).json({
            error: {
              code: "VALIDATION_ERROR",
              message: "To attest, describe the agent's purpose and who operates it.",
            },
          });
        }
        const prev = store.getAgentKya(org.id, agent.id);
        if (prev?.status === "suspended") {
          return res.status(409).json({
            error: { code: "AGENT_SUSPENDED", message: "Reinstate the agent before editing it." },
          });
        }
        const actor = actorOf(req);
        const now = new Date().toISOString();
        store.upsertAgentKya({
          agentId: agent.id,
          orgId: org.id,
          purpose: body.purpose,
          operator: body.operator,
          model: body.model || undefined,
          provider: body.provider || undefined,
          allowedCategories: body.allowedCategories,
          allowedCounterparties: body.allowedCounterparties,
          status: body.attest ? "attested" : "unattested",
          attestedByUserId: body.attest ? actor.id : undefined,
          attestedByName: body.attest ? actor.name : undefined,
          attestedAt: body.attest ? now : undefined,
        });
        store.addComplianceEvent({
          orgId: org.id,
          subjectKind: "agent",
          subjectId: agent.id,
          action: body.attest ? "kya.attested" : "kya.updated",
          actor: actor.name,
          detail: {
            categories: body.allowedCategories.length,
            counterparties: body.allowedCounterparties.length,
          },
        });
        res.json({ ok: true, agent: agentKyaView(org.id, agent.id) });
      },
      { ownerOnly: true },
    ),
  );

  app.post(
    "/v1/guardian/compliance/agents/:id/suspend",
    guardianRoute(
      (org, req, res) => {
        const agent = scopedStore(org.id).getAgent(req.params.id);
        if (!agent) return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
        const { reason } = z
          .object({ reason: z.string().trim().min(3).max(300) })
          .parse(req.body ?? {});
        const prev = store.getAgentKya(org.id, agent.id);
        const actor = actorOf(req);
        store.upsertAgentKya({
          agentId: agent.id,
          orgId: org.id,
          purpose: prev?.purpose ?? "",
          operator: prev?.operator ?? "",
          model: prev?.model,
          provider: prev?.provider,
          allowedCategories: prev?.allowedCategories ?? [],
          allowedCounterparties: prev?.allowedCounterparties ?? [],
          status: "suspended",
          attestedByUserId: prev?.attestedByUserId,
          attestedByName: prev?.attestedByName,
          attestedAt: prev?.attestedAt,
          suspendedReason: reason,
        });
        store.addComplianceEvent({
          orgId: org.id,
          subjectKind: "agent",
          subjectId: agent.id,
          action: "kya.suspended",
          actor: actor.name,
          detail: { reason },
        });
        res.json({ ok: true, agent: agentKyaView(org.id, agent.id) });
      },
      { ownerOnly: true },
    ),
  );

  app.post(
    "/v1/guardian/compliance/agents/:id/reinstate",
    guardianRoute(
      (org, req, res) => {
        const agent = scopedStore(org.id).getAgent(req.params.id);
        if (!agent) return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
        const prev = store.getAgentKya(org.id, agent.id);
        if (prev?.status !== "suspended") {
          return res.status(409).json({
            error: { code: "NOT_SUSPENDED", message: "This agent is not suspended." },
          });
        }
        const actor = actorOf(req);
        store.upsertAgentKya({
          ...prev,
          status: prev.attestedAt ? "attested" : "unattested",
          suspendedReason: undefined,
        });
        store.addComplianceEvent({
          orgId: org.id,
          subjectKind: "agent",
          subjectId: agent.id,
          action: "kya.reinstated",
          actor: actor.name,
        });
        res.json({ ok: true, agent: agentKyaView(org.id, agent.id) });
      },
      { ownerOnly: true },
    ),
  );
}
