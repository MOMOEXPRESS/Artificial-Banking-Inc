import { createMarketplace } from "./marketplace.js";
import { commerceDatabase, sellerStore, store } from "./store.js";

export function marketplace() {
  return createMarketplace(commerceDatabase(), {
    vendorName: (orgId) => store.getSellerProfile(orgId)?.displayName ?? orgId,
    sellerReady: (orgId) => Boolean(store.getSellerProfile(orgId)?.payoutAddress),
    offer: (id) => {
      const offer = sellerStore.getOfferAnyOrg(id);
      return offer ? { orgId: offer.orgId, endpointUrl: offer.endpointUrl, priceMicro: offer.priceUsdcMicro, currency: "USDC", published: offer.status === "published" && !offer.archivedAt, network: offer.network } : undefined;
    },
  });
}
