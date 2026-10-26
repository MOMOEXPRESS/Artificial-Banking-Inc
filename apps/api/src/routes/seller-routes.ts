/**
 * Seller partnership surfaces: dedicated seller orgs, profile, catalog, integrate.
 * Published offers are listed in the buyer directory by default; sellers opt out
 * per offer with `directoryListed: false`. Agents can still reach offers on the
 * seller’s own site either way.
 */
import type express from "express";
import { isAddress } from "viem";
import { z } from "zod";
import { parseUsdcToMicro, formatMicroToUsdc } from "@policyvault/common";
import { recordObs } from "../platform/observability.js";
import { sellerStore, store, type OfferRow, type SellerProfileRow } from "../store.js";
import { partnerRoute } from "./partner-auth-routes.js";

const payoutSchema = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .refine((value) => isAddress(value), "payoutAddress must be a valid EVM address"),
  ])
  .optional();

const sellerProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  payoutAddress: payoutSchema,
  network: z.enum(["base-sepolia", "base"]).default("base-sepolia").optional(),
  website: z
    .union([
      z.literal(""),
      z
        .string()
        .url()
        .max(300)
        .refine((url) => /^https:\/\//i.test(url), "Use an HTTPS website"),
    ])
    .optional(),
  description: z.string().trim().max(1000).optional(),
});

const offerCreateSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case"),
  title: z.string().trim().min(1).max(120),
  endpointUrl: z
    .string()
    .url()
    .max(500)
    .refine((url) => /^https?:\/\//i.test(url), "endpointUrl must be http(s)"),
  priceUsdc: z.string().trim().min(1).max(32),
  network: z.enum(["base-sepolia", "base"]).default("base-sepolia"),
});

const offerPatchSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  title: z.string().trim().min(1).max(120).optional(),
  endpointUrl: z
    .string()
    .url()
    .max(500)
    .refine((url) => /^https?:\/\//i.test(url), "endpointUrl must be http(s)")
    .optional(),
  priceUsdc: z.string().trim().min(1).max(32).optional(),
  network: z.enum(["base-sepolia", "base"]).optional(),
  status: z.enum(["draft", "verified", "published", "paused"]).optional(),
  directoryListed: z.boolean().optional(),
  sandboxEnabled: z.boolean().optional(),
});

function sellerProfileView(profile: SellerProfileRow) {
  return {
    orgId: profile.orgId,
    displayName: profile.displayName,
    payoutAddress: profile.payoutAddress ?? "",
    network: profile.network,
    status: profile.status,
    website: profile.website,
    description: profile.description,
    updatedAt: profile.updatedAt,
  };
}

function offerView(offer: OfferRow) {
  const integration = store.getOfferIntegration(offer.id);
  return {
    id: offer.id,
    slug: offer.slug,
    title: offer.title,
    endpointUrl: offer.endpointUrl,
    priceUsdc: formatMicroToUsdc(BigInt(offer.priceUsdcMicro)),
    priceUsdcMicro: offer.priceUsdcMicro,
    network: offer.network,
    status: offer.status,
    version: offer.version,
    deprecatedAt: offer.deprecatedAt ?? null,
    sunsetAt: offer.sunsetAt ?? null,
    successorOfferId: offer.successorOfferId ?? null,
    directoryListed: offer.directoryListed,
    sandboxEnabled: offer.sandboxEnabled,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
    integration: {
      lastVerifiedAt: integration?.lastVerifiedAt ?? null,
      snippetVersion: integration?.snippetVersion ?? null,
      error: integration?.error ?? null,
      lastChallenge: integration?.lastChallengeJson
        ? safeJson(integration.lastChallengeJson)
        : null,
    },
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function buildSnippet(offer: OfferRow, profile: SellerProfileRow | undefined): string {
  const payTo = profile?.payoutAddress || "0xYOUR_PAYOUT_ADDRESS";
  const price = formatMicroToUsdc(BigInt(offer.priceUsdcMicro));
  return `// ABI seller snippet v0 — paste into your Express (or equivalent) server
// Offer: ${offer.slug} · ${offer.title}
// Agents discover this on YOUR site; ABI buyer orgs pay via x402.

import express from "express";
import { paymentMiddleware } from "@x402/express"; // or your x402 stack

const app = express();
app.get("${safePath(offer.endpointUrl)}", paymentMiddleware({
  payTo: "${payTo}",
  price: "${price}",
  network: "${offer.network}",
  description: "${offer.title.replace(/"/g, '\\"')}",
}), (_req, res) => {
  res.json({ ok: true, offer: "${offer.slug}", unlocked: true });
});
`;
}

function safePath(endpointUrl: string): string {
  try {
    const u = new URL(endpointUrl);
    return u.pathname || "/";
  } catch {
    return "/";
  }
}

export function registerSellerRoutes(app: express.Express): void {
  app.get(
    "/v1/seller/profile",
    partnerRoute((org, _req, res) => {
      const profile = store.getSellerProfile(org.id) ?? store.upsertSellerProfile(org.id, {});
      res.json({
        orgId: org.id,
        kind: org.kind,
        profile: sellerProfileView(profile),
      });
    }),
  );

  app.patch(
    "/v1/seller/profile",
    partnerRoute((org, req, res) => {
      const body = sellerProfileSchema.parse(req.body ?? {});
      try {
        const profile = store.upsertSellerProfile(org.id, {
          displayName: body.displayName,
          payoutAddress: body.payoutAddress === "" ? null : body.payoutAddress,
          network: body.network,
          website: body.website,
          description: body.description,
        });
        recordObs({ name: "seller.profile_updated", orgId: org.id });
        res.json({ ok: true, orgId: org.id, profile: sellerProfileView(profile) });
      } catch (error) {
        if (error instanceof Error && error.message === "SELLER_ORG_REQUIRED") {
          return res.status(403).json({
            error: {
              code: "SELLER_ORG_REQUIRED",
              message: "Seller profile updates require a seller organization.",
            },
          });
        }
        throw error;
      }
    }),
  );

  app.get(
    "/v1/seller/offers",
    partnerRoute((org, _req, res) => {
      res.json({ offers: store.listOffers(org.id).map(offerView) });
    }),
  );

  app.post(
    "/v1/seller/offers",
    partnerRoute((org, req, res) => {
      const body = offerCreateSchema.parse(req.body ?? {});
      let priceUsdcMicro: string;
      try {
        priceUsdcMicro = parseUsdcToMicro(body.priceUsdc).toString();
      } catch {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "Invalid USDC amount" },
        });
      }
      if (BigInt(priceUsdcMicro) <= 0n) {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "priceUsdc must be greater than zero" },
        });
      }
      try {
        const offer = store.createOffer({
          orgId: org.id,
          slug: body.slug,
          title: body.title,
          endpointUrl: body.endpointUrl,
          priceUsdcMicro,
          network: body.network,
        });
        recordObs({ name: "seller.offer_created", orgId: org.id });
        res.status(201).json({ offer: offerView(offer) });
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

  app.patch(
    "/v1/seller/offers/:offerId",
    partnerRoute((org, req, res) => {
      const body = offerPatchSchema.parse(req.body ?? {});
      let priceUsdcMicro: string | undefined;
      if (body.priceUsdc !== undefined) {
        try {
          priceUsdcMicro = parseUsdcToMicro(body.priceUsdc).toString();
        } catch {
          return res.status(400).json({
            error: { code: "VALIDATION_ERROR", message: "Invalid USDC amount" },
          });
        }
      }
      try {
        const offer = store.updateOffer(org.id, req.params.offerId, {
          title: body.title,
          endpointUrl: body.endpointUrl,
          priceUsdcMicro,
          network: body.network,
          slug: body.slug,
          status: body.status,
          directoryListed: body.directoryListed,
          sandboxEnabled: body.sandboxEnabled,
        });
        res.json({ offer: offerView(offer) });
      } catch (error) {
        if (error instanceof Error && error.message === "OFFER_NOT_FOUND") {
          return res.status(404).json({ error: { code: "NOT_FOUND", message: "Offer not found" } });
        }
        if (error instanceof Error && error.message === "OFFER_SLUG_TAKEN") {
          return res.status(409).json({
            error: { code: "OFFER_SLUG_TAKEN", message: "That slug is already in use." },
          });
        }
        throw error;
      }
    }),
  );

  app.get(
    "/v1/seller/offers/:offerId/snippet",
    partnerRoute((org, req, res) => {
      const offer = store.getOffer(org.id, req.params.offerId);
      if (!offer) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Offer not found" } });
      }
      const profile = store.getSellerProfile(org.id);
      const snippet = buildSnippet(offer, profile);
      store.setOfferIntegration(offer.id, { snippetVersion: "v0", error: null });
      res.json({
        offerId: offer.id,
        version: "v0",
        language: "javascript",
        snippet,
        note: "Agents find this endpoint on your site. Buyer orgs pay through ABI; you receive USDC at your payout address.",
      });
    }),
  );

  app.post(
    "/v1/seller/offers/:offerId/verify",
    partnerRoute(async (org, req, res) => {
      const offer = store.getOffer(org.id, req.params.offerId);
      if (!offer) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Offer not found" } });
      }
      const profile = store.getSellerProfile(org.id);
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8_000);
        const response = await fetch(offer.endpointUrl, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        clearTimeout(timer);
        const status = response.status;
        const paymentHeader =
          response.headers.get("payment-required") ||
          response.headers.get("x-payment") ||
          response.headers.get("www-authenticate");
        let bodyText = "";
        try {
          bodyText = (await response.text()).slice(0, 4_000);
        } catch {
          bodyText = "";
        }
        const looks402 = status === 402;
        const challenge = {
          httpStatus: status,
          paymentHeader: paymentHeader ? paymentHeader.slice(0, 500) : null,
          bodyPreview: bodyText.slice(0, 800),
          expectedPayTo: profile?.payoutAddress ?? null,
          expectedNetwork: offer.network,
          expectedPriceUsdc: formatMicroToUsdc(BigInt(offer.priceUsdcMicro)),
        };
        if (!looks402) {
          store.setOfferIntegration(offer.id, {
            lastChallengeJson: JSON.stringify(challenge),
            lastVerifiedAt: null,
            error: `Expected HTTP 402 from unpaid GET; got ${status}`,
          });
          if (offer.status === "verified" || offer.status === "published") {
            store.updateOffer(org.id, offer.id, { status: "draft" });
          }
          return res.status(422).json({
            ok: false,
            error: {
              code: "VERIFY_FAILED",
              message: `Expected HTTP 402 Payment Required from unpaid GET; got ${status}`,
            },
            challenge,
            offer: offerView(store.getOffer(org.id, offer.id)!),
          });
        }
        store.setOfferIntegration(offer.id, {
          lastChallengeJson: JSON.stringify(challenge),
          lastVerifiedAt: new Date().toISOString(),
          error: null,
          snippetVersion: "v0",
        });
        const updated = store.updateOffer(org.id, offer.id, { status: "verified" });
        recordObs({ name: "seller.offer_verified", orgId: org.id });
        res.json({
          ok: true,
          challenge,
          offer: offerView(updated),
          note: "Unpaid GET returned 402. Publish when you are ready for buyer agents.",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not reach offer endpoint";
        store.setOfferIntegration(offer.id, {
          error: message.slice(0, 500),
          lastVerifiedAt: null,
        });
        return res.status(422).json({
          ok: false,
          error: { code: "VERIFY_FAILED", message },
          offer: offerView(store.getOffer(org.id, offer.id)!),
        });
      }
    }),
  );

  app.post(
    "/v1/seller/offers/:offerId/publish",
    partnerRoute((org, req, res) => {
      const offer = store.getOffer(org.id, req.params.offerId);
      if (!offer) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Offer not found" } });
      }
      if (
        offer.status !== "verified" &&
        offer.status !== "published" &&
        offer.status !== "paused"
      ) {
        return res.status(400).json({
          error: {
            code: "NOT_VERIFIED",
            message: "Verify the unpaid 402 challenge before publishing.",
          },
        });
      }
      const profile = store.getSellerProfile(org.id);
      if (!profile?.payoutAddress) {
        return res.status(400).json({
          error: {
            code: "PAYOUT_REQUIRED",
            message: "Set a payout address on your seller profile before publishing.",
          },
        });
      }
      const updated = store.updateOffer(org.id, offer.id, { status: "published" });
      recordObs({ name: "seller.offer_published", orgId: org.id });
      res.json({
        offer: offerView(updated),
        note: updated.directoryListed
          ? "Published and listed in the ABI buyer directory. Set directoryListed: false to hide it."
          : "Published for agents that reach this URL on your site. Hidden from the ABI buyer directory.",
      });
    }),
  );

  app.get(
    "/v1/seller/activity",
    partnerRoute((org, _req, res) => {
      const rows = store.listSellerSettlements(org.id);
      res.json({
        settlements: rows.map((r) => ({
          id: r.id,
          offerId: r.offerId ?? null,
          buyerOrgId: r.buyerOrgId ?? null,
          amountUsdc: formatMicroToUsdc(BigInt(r.amountMicro)),
          txHash: r.txHash ?? null,
          state: r.state,
          createdAt: r.createdAt,
        })),
        note: "Inbound pays appear here after buyer agents settle x402 to your offers.",
      });
    }),
  );

  /** Buyer directory: published offers are listed unless the seller opted out. */
  app.get("/v1/directory/offers", (_req, res) => {
    res.json({
      offers: sellerStore.listDirectoryOffers().map((offer) => ({
        id: offer.id,
        slug: offer.slug,
        title: offer.title,
        endpointUrl: offer.endpointUrl,
        priceUsdc: formatMicroToUsdc(BigInt(offer.priceUsdcMicro)),
        network: offer.network,
        version: offer.version,
        deprecatedAt: offer.deprecatedAt ?? null,
        sunsetAt: offer.sunsetAt ?? null,
        successorOfferId: offer.successorOfferId ?? null,
        sandboxEnabled: offer.sandboxEnabled,
        seller: { orgId: offer.orgId, name: offer.sellerName, website: offer.website || null },
      })),
    });
  });
}
