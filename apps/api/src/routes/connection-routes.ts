/**
 * Buyer connections to directory sellers.
 *
 * Connecting adds one offer URL to the org's vendor allowlist and pins the
 * seller's payee, network and price as they are right now, read from ABI's
 * own records rather than from the client. Each call changes only its own URL,
 * so two tabs connecting different sellers cannot overwrite each other the way
 * a whole-list policy write would.
 *
 * When the seller later changes their payout address, pays to the pinned URL
 * are refused with PAYEE_CHANGED until a guardian connects again.
 */
import { formatMicroToUsdc } from "@policyvault/common";
import type express from "express";
import { z } from "zod";
import { sellerStore, store, type OrgRow } from "../store.js";
import { X402_NETWORKS } from "../seller-x402.js";
import { policyView } from "./policy-routes.js";

type GuardianRoute = (
  handler: (org: OrgRow, req: express.Request, res: express.Response) => unknown,
  opts?: { ownerOnly?: boolean },
) => express.RequestHandler;

export const DIRECTORY_MERCHANT_SOURCE = "abi-directory";

function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

function notFound(res: express.Response) {
  return res.status(404).json({
    error: { code: "OFFER_NOT_FOUND", message: "No published offer with that id." },
  });
}

export function registerConnectionRoutes(
  app: express.Express,
  { guardianRoute }: { guardianRoute: GuardianRoute },
): void {
  app.post(
    "/v1/guardian/connections",
    guardianRoute(
      (org, req, res) => {
        const body = z.object({ offerId: z.string().min(1).max(64) }).parse(req.body ?? {});
        const offer = sellerStore.getOfferAnyOrg(body.offerId);
        if (!offer || offer.archivedAt || offer.status !== "published") return notFound(res);
        if (offer.orgId === org.id) {
          return res.status(400).json({
            error: { code: "OWN_OFFER", message: "This offer belongs to your own organization." },
          });
        }
        const profile = store.getSellerProfile(offer.orgId);
        const payTo = profile?.payoutAddress;
        if (!payTo) {
          return res.status(409).json({
            error: { code: "SELLER_NOT_READY", message: "The seller has no payout address yet." },
          });
        }
        const network = X402_NETWORKS[offer.network]?.caip2;

        const current = store.getPolicyTemplate(org.id);
        const vendorAllowlist = [
          ...current.vendorAllowlist.filter((u) => !sameUrl(u, offer.endpointUrl)),
          offer.endpointUrl,
        ];
        store.setPolicyTemplate(org.id, { ...current, vendorAllowlist });
        const confirmedAt = new Date().toISOString();
        const merchant = store.upsertMerchant({
          orgId: org.id,
          key: offer.endpointUrl,
          label: `${profile?.displayName || "Seller"} · ${offer.title}`,
          category: offer.category,
          meta: {
            source: DIRECTORY_MERCHANT_SOURCE,
            offerId: offer.id,
            sellerOrgId: offer.orgId,
            payTo,
            network: offer.network,
            priceUsdc: formatMicroToUsdc(BigInt(offer.priceUsdcMicro)),
            gateway: { payoutAddress: payTo, network, amountMicro: offer.priceUsdcMicro },
            confirmedAt,
          },
        });
        store.addKnownCounterparty(org.id, offer.endpointUrl);
        res.json({
          ok: true,
          connection: {
            offerId: offer.id,
            endpointUrl: offer.endpointUrl,
            payTo,
            network: offer.network,
            confirmedAt,
            merchantId: merchant.id,
          },
          policy: policyView({ ...current, vendorAllowlist }),
          version: store.getPolicyVersion(org.id),
        });
      },
      { ownerOnly: true },
    ),
  );

  app.delete(
    "/v1/guardian/connections/:offerId",
    guardianRoute(
      (org, req, res) => {
        const offer = sellerStore.getOfferAnyOrg(req.params.offerId);
        if (!offer) return notFound(res);
        const current = store.getPolicyTemplate(org.id);
        const vendorAllowlist = current.vendorAllowlist.filter(
          (u) => !sameUrl(u, offer.endpointUrl),
        );
        if (vendorAllowlist.length !== current.vendorAllowlist.length) {
          store.setPolicyTemplate(org.id, { ...current, vendorAllowlist });
        }
        const merchant = store
          .listMerchants(org.id)
          .find(
            (m) =>
              sameUrl(m.key, offer.endpointUrl) && m.meta?.source === DIRECTORY_MERCHANT_SOURCE,
          );
        if (merchant) store.deleteMerchant(org.id, merchant.id);
        res.json({
          ok: true,
          policy: policyView({ ...current, vendorAllowlist }),
          version: store.getPolicyVersion(org.id),
        });
      },
      { ownerOnly: true },
    ),
  );
}
