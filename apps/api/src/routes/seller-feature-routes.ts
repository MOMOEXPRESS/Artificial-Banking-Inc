/**
 * Seller features beyond the catalog: analytics, access policies, invoices and
 * payouts, versioning + deprecation, usage alerts, seller webhooks, and the
 * public pre-pay sandbox.
 */
import type express from "express";
import { z } from "zod";
import { formatMicroToUsdc } from "@policyvault/common";
import { webhookUrlProblem } from "../outbound-url.js";
import { recordObs } from "../platform/observability.js";
import { evaluateSellerAccess } from "../seller-ingest.js";
import { sellerStore, store, type SellerAccessPolicyRow } from "../store.js";
import { emitEvent } from "../webhooks.js";
import { partnerRoute, route } from "./partner-auth-routes.js";

const MIN_DEPRECATION_NOTICE_MS = 7 * 24 * 60 * 60 * 1000;

const policySchema = z
  .object({
    offerId: z.string().trim().min(1).optional(),
    buyerOrgId: z.string().trim().min(1).optional(),
    agentId: z.string().trim().min(1).optional(),
    effect: z.enum(["allow", "deny"]).default("allow"),
    ratePerMinute: z.number().int().positive().max(100_000).optional(),
    ratePerDay: z.number().int().positive().max(10_000_000).optional(),
    note: z.string().trim().max(300).default(""),
  })
  .refine(
    (p) => p.effect === "deny" || p.ratePerMinute !== undefined || p.ratePerDay !== undefined,
    "An allow policy needs ratePerMinute or ratePerDay",
  );

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Must be an ISO date");

const invoiceSchema = z.object({
  periodStart: isoDate.optional(),
  periodEnd: isoDate.optional(),
});

const versionSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case"),
  version: z.string().trim().regex(/^v\d+$/, "version must look like v2").optional(),
  endpointUrl: z
    .string()
    .url()
    .max(500)
    .refine((url) => /^https?:\/\//i.test(url), "endpointUrl must be http(s)")
    .optional(),
});

const deprecateSchema = z.object({
  sunsetAt: isoDate,
  successorOfferId: z.string().trim().min(1).optional(),
});

const alertSchema = z.object({
  offerId: z.string().trim().min(1).optional(),
  thresholdCalls: z.number().int().positive().max(10_000_000),
});

const webhookSchema = z.object({ url: z.string().url() });

const sandboxSchema = z.object({
  buyerOrgId: z.string().trim().min(1).max(80).optional(),
  agentId: z.string().trim().min(1).max(80).optional(),
});

function notFound(res: express.Response, what = "Offer") {
  return res.status(404).json({ error: { code: "NOT_FOUND", message: `${what} not found` } });
}

function policyView(p: SellerAccessPolicyRow) {
  return {
    id: p.id,
    offerId: p.offerId ?? null,
    buyerOrgId: p.buyerOrgId ?? null,
    agentId: p.agentId ?? null,
    effect: p.effect,
    ratePerMinute: p.ratePerMinute ?? null,
    ratePerDay: p.ratePerDay ?? null,
    note: p.note,
    createdAt: p.createdAt,
  };
}

/** Previous full calendar month in UTC. */
function lastMonthWindow(now = new Date()): { periodStart: string; periodEnd: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
  return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
}

function nextVersion(current: string): string {
  const n = Number(/^v(\d+)$/.exec(current)?.[1] ?? "1");
  return `v${n + 1}`;
}

export function registerSellerFeatureRoutes(app: express.Express): void {
  // ------------------------------------------------------------ analytics
  app.get(
    "/v1/seller/analytics",
    partnerRoute((org, req, res) => {
      const days = Math.min(90, Math.max(1, Number(req.query.days ?? 30) || 30));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const events = sellerStore.listUsage(org.id, since);
      const offers = store.listOffers(org.id);
      const perOffer = offers.map((offer) => {
        const rows = events.filter((e) => e.offerId === offer.id);
        const paid = rows.filter((e) => e.mode === "paid");
        const revenue = paid.reduce((sum, e) => sum + BigInt(e.amountMicro), 0n);
        const byBuyer = new Map<string, number>();
        const byAgent = new Map<string, number>();
        const daily = new Map<string, { calls: number; revenueMicro: bigint }>();
        for (const e of rows) {
          if (e.buyerOrgId) byBuyer.set(e.buyerOrgId, (byBuyer.get(e.buyerOrgId) ?? 0) + 1);
          if (e.agentId) byAgent.set(e.agentId, (byAgent.get(e.agentId) ?? 0) + 1);
          const day = e.createdAt.slice(0, 10);
          const d = daily.get(day) ?? { calls: 0, revenueMicro: 0n };
          d.calls += 1;
          if (e.mode === "paid") d.revenueMicro += BigInt(e.amountMicro);
          daily.set(day, d);
        }
        const top = (m: Map<string, number>) =>
          [...m.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([id, calls]) => ({ id, calls }));
        return {
          offerId: offer.id,
          slug: offer.slug,
          version: offer.version,
          calls: {
            paid: paid.length,
            sandbox: rows.filter((e) => e.mode === "sandbox").length,
            denied: rows.filter((e) => e.mode === "denied").length,
          },
          revenueUsdc: formatMicroToUsdc(revenue),
          uniqueBuyers: byBuyer.size,
          uniqueAgents: byAgent.size,
          topBuyers: top(byBuyer),
          topAgents: top(byAgent),
          daily: [...daily.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([day, d]) => ({ day, calls: d.calls, revenueUsdc: formatMicroToUsdc(d.revenueMicro) })),
        };
      });
      const totalRevenue = events
        .filter((e) => e.mode === "paid")
        .reduce((sum, e) => sum + BigInt(e.amountMicro), 0n);
      res.json({
        windowDays: days,
        since,
        totals: {
          paidCalls: events.filter((e) => e.mode === "paid").length,
          revenueUsdc: formatMicroToUsdc(totalRevenue),
          uniqueBuyers: new Set(events.map((e) => e.buyerOrgId).filter(Boolean)).size,
        },
        offers: perOffer,
      });
    }),
  );

  // ------------------------------------------------------------ access policies
  app.get(
    "/v1/seller/policies",
    partnerRoute((org, _req, res) => {
      res.json({ policies: sellerStore.listPolicies(org.id).map(policyView) });
    }),
  );

  app.post(
    "/v1/seller/policies",
    partnerRoute((org, req, res) => {
      const body = policySchema.parse(req.body ?? {});
      if (body.offerId && !store.getOffer(org.id, body.offerId)) return notFound(res);
      const policy = sellerStore.createPolicy({
        sellerOrgId: org.id,
        offerId: body.offerId,
        buyerOrgId: body.buyerOrgId,
        agentId: body.agentId,
        effect: body.effect,
        ratePerMinute: body.ratePerMinute,
        ratePerDay: body.ratePerDay,
        note: body.note,
      });
      emitEvent(org.id, "seller.policy.changed", { action: "created", policy: policyView(policy) });
      recordObs({ name: "seller.policy_created", orgId: org.id });
      res.status(201).json({ policy: policyView(policy) });
    }),
  );

  app.delete(
    "/v1/seller/policies/:policyId",
    partnerRoute((org, req, res) => {
      if (!sellerStore.deletePolicy(org.id, req.params.policyId)) return notFound(res, "Policy");
      emitEvent(org.id, "seller.policy.changed", { action: "deleted", policyId: req.params.policyId });
      res.json({ ok: true });
    }),
  );

  // ------------------------------------------------------------ invoices + payouts
  app.post(
    "/v1/seller/invoices/generate",
    partnerRoute((org, req, res) => {
      const body = invoiceSchema.parse(req.body ?? {});
      const window =
        body.periodStart && body.periodEnd
          ? { periodStart: new Date(body.periodStart).toISOString(), periodEnd: new Date(body.periodEnd).toISOString() }
          : lastMonthWindow();
      if (window.periodStart >= window.periodEnd) {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "periodStart must be before periodEnd" },
        });
      }
      const profile = store.getSellerProfile(org.id);
      const { invoice, created } = sellerStore.generateInvoice({
        sellerOrgId: org.id,
        ...window,
        payoutAddress: profile?.payoutAddress ?? undefined,
      });
      res.status(created ? 201 : 200).json({
        created,
        invoice: { ...invoice, totalUsdc: formatMicroToUsdc(BigInt(invoice.totalMicro)) },
      });
    }),
  );

  app.get(
    "/v1/seller/invoices",
    partnerRoute((org, _req, res) => {
      res.json({
        invoices: sellerStore
          .listInvoices(org.id)
          .map((i) => ({ ...i, totalUsdc: formatMicroToUsdc(BigInt(i.totalMicro)) })),
      });
    }),
  );

  app.get(
    "/v1/seller/payouts",
    partnerRoute((org, _req, res) => {
      const profile = store.getSellerProfile(org.id);
      const summary = sellerStore.payoutSummary(org.id);
      res.json({
        payoutAddress: profile?.payoutAddress ?? null,
        network: profile?.network ?? null,
        settledUsdc: formatMicroToUsdc(BigInt(summary.settledMicro)),
        settlementCount: summary.count,
        lastTxHash: summary.lastTxHash ?? null,
        note: "x402 settles directly to your payout address on each paid call; invoices summarize those settlements per period.",
      });
    }),
  );

  // ------------------------------------------------------------ versioning
  app.post(
    "/v1/seller/offers/:offerId/versions",
    partnerRoute((org, req, res) => {
      const base = store.getOffer(org.id, req.params.offerId);
      if (!base) return notFound(res);
      const body = versionSchema.parse(req.body ?? {});
      try {
        const created = store.createOffer({
          orgId: org.id,
          slug: body.slug,
          title: base.title,
          endpointUrl: body.endpointUrl ?? base.endpointUrl,
          priceUsdcMicro: base.priceUsdcMicro,
          network: base.network,
        });
        const version = body.version ?? nextVersion(base.version);
        sellerStore.setOfferVersion(org.id, created.id, version);
        store.updateOffer(org.id, created.id, {
          directoryListed: base.directoryListed,
          sandboxEnabled: base.sandboxEnabled,
        });
        recordObs({ name: "seller.offer_versioned", orgId: org.id });
        res.status(201).json({
          offer: store.getOffer(org.id, created.id),
          basedOn: base.id,
          note: "New versions start as drafts — verify and publish before deprecating the previous one.",
        });
      } catch (error) {
        if (error instanceof Error && error.message === "OFFER_SLUG_TAKEN") {
          return res.status(409).json({
            error: { code: "OFFER_SLUG_TAKEN", message: "That slug is already in use." },
          });
        }
        throw error;
      }
    }),
  );

  app.post(
    "/v1/seller/offers/:offerId/deprecate",
    partnerRoute((org, req, res) => {
      const offer = store.getOffer(org.id, req.params.offerId);
      if (!offer) return notFound(res);
      const body = deprecateSchema.parse(req.body ?? {});
      const sunset = new Date(body.sunsetAt);
      if (sunset.getTime() - Date.now() < MIN_DEPRECATION_NOTICE_MS) {
        return res.status(400).json({
          error: {
            code: "SUNSET_TOO_SOON",
            message: "Give buyers at least 7 days of notice before the sunset date.",
          },
        });
      }
      if (body.successorOfferId) {
        const successor = store.getOffer(org.id, body.successorOfferId);
        if (!successor || successor.id === offer.id) return notFound(res, "Successor offer");
      }
      sellerStore.deprecateOffer({
        sellerOrgId: org.id,
        offerId: offer.id,
        sunsetAt: sunset.toISOString(),
        successorOfferId: body.successorOfferId,
      });
      const updated = store.getOffer(org.id, offer.id)!;
      emitEvent(org.id, "seller.offer.deprecated", {
        offerId: offer.id,
        slug: offer.slug,
        version: offer.version,
        sunsetAt: updated.sunsetAt,
        successorOfferId: updated.successorOfferId ?? null,
      });
      res.json({ offer: updated });
    }),
  );

  // ------------------------------------------------------------ usage alerts
  app.get(
    "/v1/seller/alerts",
    partnerRoute((org, _req, res) => {
      res.json({ alerts: sellerStore.listAlerts(org.id) });
    }),
  );

  app.post(
    "/v1/seller/alerts",
    partnerRoute((org, req, res) => {
      const body = alertSchema.parse(req.body ?? {});
      if (body.offerId && !store.getOffer(org.id, body.offerId)) return notFound(res);
      const alert = sellerStore.createAlert({
        sellerOrgId: org.id,
        offerId: body.offerId,
        thresholdCalls: body.thresholdCalls,
      });
      res.status(201).json({ alert });
    }),
  );

  app.delete(
    "/v1/seller/alerts/:alertId",
    partnerRoute((org, req, res) => {
      if (!sellerStore.deleteAlert(org.id, req.params.alertId)) return notFound(res, "Alert");
      res.json({ ok: true });
    }),
  );

  // ------------------------------------------------------------ webhooks
  app.get(
    "/v1/seller/webhooks",
    partnerRoute((org, _req, res) => {
      res.json({
        webhooks: store
          .listWebhooks(org.id)
          .map((w) => ({ id: w.id, url: w.url, createdAt: w.createdAt })),
        events: [
          "seller.payment.received",
          "seller.usage.threshold",
          "seller.policy.changed",
          "seller.offer.deprecated",
        ],
      });
    }),
  );

  app.post(
    "/v1/seller/webhooks",
    partnerRoute((org, req, res) => {
      const body = webhookSchema.parse(req.body ?? {});
      const problem = webhookUrlProblem(body.url);
      if (problem) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: problem } });
      }
      const webhook = store.createWebhook(org.id, body.url);
      res.status(201).json({
        id: webhook.id,
        url: webhook.url,
        secret: webhook.secret,
        note: "The secret is shown once. Verify x-policyvault-signature and dedupe on x-policyvault-delivery.",
      });
    }),
  );

  app.delete(
    "/v1/seller/webhooks/:webhookId",
    partnerRoute((org, req, res) => {
      if (!store.deleteWebhook(req.params.webhookId, org.id)) return notFound(res, "Webhook");
      res.json({ ok: true });
    }),
  );

  // ------------------------------------------------------------ public sandbox
  /** Simulated 402 + unlock so buyers can wire their agent before paying. No money moves. */
  app.post(
    "/v1/sandbox/offers/:offerId/try",
    route((req, res) => {
      const offer = sellerStore.getOfferAnyOrg(req.params.offerId);
      if (!offer || (offer.status !== "published" && offer.status !== "verified")) {
        return notFound(res);
      }
      if (!offer.sandboxEnabled) {
        return res.status(403).json({
          error: { code: "SANDBOX_DISABLED", message: "This seller has turned off the sandbox for this offer." },
        });
      }
      const body = sandboxSchema.parse(req.body ?? {});
      const access = evaluateSellerAccess(offer, body.buyerOrgId, body.agentId);
      if (!access.allowed) {
        sellerStore.recordUsage({
          sellerOrgId: offer.orgId,
          offerId: offer.id,
          buyerOrgId: body.buyerOrgId,
          agentId: body.agentId,
          mode: "denied",
        });
        return res.status(access.code === "SELLER_RATE_LIMITED" ? 429 : 403).json({
          error: { code: access.code, message: access.message },
        });
      }
      sellerStore.recordUsage({
        sellerOrgId: offer.orgId,
        offerId: offer.id,
        buyerOrgId: body.buyerOrgId,
        agentId: body.agentId,
        mode: "sandbox",
      });
      const profile = store.getSellerProfile(offer.orgId);
      res.json({
        sandbox: true,
        offer: {
          id: offer.id,
          slug: offer.slug,
          version: offer.version,
          deprecatedAt: offer.deprecatedAt ?? null,
          sunsetAt: offer.sunsetAt ?? null,
        },
        challenge: {
          httpStatus: 402,
          payTo: profile?.payoutAddress ?? null,
          network: offer.network,
          priceUsdc: formatMicroToUsdc(BigInt(offer.priceUsdcMicro)),
          resource: offer.endpointUrl,
        },
        unlock: {
          httpStatus: 200,
          simulated: true,
          receiptId: `sandbox_${offer.id}_${Date.now()}`,
          body: { ok: true, offer: offer.slug, unlocked: true, sandbox: true },
        },
        note: "Sandbox only: no USDC moved. Pay through ABI with a buyer agent to call the real endpoint.",
      });
    }),
  );
}
