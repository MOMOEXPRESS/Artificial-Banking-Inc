import { z } from "zod";
import { parseDocument, stringify } from "yaml";
import {
  emptyServiceListing,
  serviceListingSchema,
  type ServiceListing,
} from "@policyvault/common";
import { microToUsdcInput, usdcInputToMicro } from "./marketplace-price";

export const manifestSchema = z
  .object({
    schemaVersion: z.literal("abi.listing.v1"),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(4000),
    category: z.string().trim().min(1).max(80),
    kind: z.enum(["service", "digital", "physical"]),
    priceMicro: z.string().regex(/^\d{1,25}$/),
    currency: z.literal("USDC"),
    stockLevel: z.number().int().min(0).max(1000000000),
    offerId: z.string().max(100).optional(),
    images: z
      .array(
        z
          .string()
          .max(500)
          .url()
          .refine((s) => s.startsWith("https://"), "Use HTTPS image URLs"),
      )
      .max(20),
    attributes: z
      .object({
        colors: z.array(z.string().max(100)).max(50).optional(),
        sizes: z.array(z.string().max(100)).max(50).optional(),
        regions: z.array(z.string().max(100)).max(50).optional(),
        useCases: z.array(z.string().max(100)).max(50).optional(),
        deliveryDays: z.number().int().min(0).max(365).optional(),
      })
      .catchall(z.unknown()),
    service: serviceListingSchema.optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.kind === "service" && !m.service)
      ctx.addIssue({
        code: "custom",
        path: ["service"],
        message: "Add the service details and at least one endpoint",
      });
    if (m.kind !== "service" && m.service)
      ctx.addIssue({
        code: "custom",
        path: ["service"],
        message: "Service details belong to a service listing",
      });
    if ("service" in m.attributes)
      ctx.addIssue({
        code: "custom",
        path: ["attributes", "service"],
        message: "Put service details in the top-level service field",
      });
  });
export type ListingManifest = z.infer<typeof manifestSchema>;
export type ListingDraft = {
  name: string;
  description: string;
  category: string;
  kind: ListingManifest["kind"];
  priceUsdc: string;
  stockLevel: string;
  offerId: string;
  images: string;
  colors: string;
  sizes: string;
  regions: string;
  useCases: string;
  deliveryDays: string;
  service: ServiceListing;
  extraAttributes: Record<string, unknown>;
};
export function listingDraft(p?: {
  name: string;
  description: string;
  category: string;
  kind: string;
  priceMicro: string;
  stockLevel: number;
  offerId?: string;
  images: string[];
  attributes: Record<string, unknown>;
}): ListingDraft {
  const attrs = { ...(p?.attributes ?? {}) };
  const parsed = serviceListingSchema.safeParse(attrs.service);
  const values = (key: string) =>
    Array.isArray(attrs[key]) ? (attrs[key] as string[]).join(", ") : "";
  const base = {
    name: p?.name ?? "",
    description: p?.description ?? "",
    category: p?.category ?? "",
    kind: (p?.kind ?? "service") as ListingManifest["kind"],
    priceUsdc: p ? microToUsdcInput(p.priceMicro) : "",
    stockLevel: String(p?.stockLevel ?? 0),
    offerId: p?.offerId ?? "",
    images: p?.images.join("\n") ?? "",
    colors: values("colors"),
    sizes: values("sizes"),
    regions: values("regions"),
    useCases: values("useCases"),
    deliveryDays: String(attrs.deliveryDays ?? ""),
    service: parsed.success ? parsed.data : emptyServiceListing(),
    extraAttributes: attrs,
  };
  for (const k of ["service", "colors", "sizes", "regions", "useCases", "deliveryDays"])
    delete attrs[k];
  return base;
}
export function draftManifest(d: ListingDraft): ListingManifest {
  const list = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  return {
    schemaVersion: "abi.listing.v1",
    name: d.name,
    description: d.description,
    category: d.category,
    kind: d.kind,
    priceMicro: d.priceUsdc ? usdcInputToMicro(d.priceUsdc) : "",
    currency: "USDC",
    stockLevel: d.stockLevel.trim() ? Number(d.stockLevel) : NaN,
    ...(d.offerId ? { offerId: d.offerId } : {}),
    images: d.images
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean),
    attributes: {
      ...d.extraAttributes,
      colors: list(d.colors),
      sizes: list(d.sizes),
      regions: list(d.regions),
      useCases: list(d.useCases),
      ...(d.deliveryDays ? { deliveryDays: Number(d.deliveryDays) } : {}),
    },
    ...(d.kind === "service" ? { service: d.service } : {}),
  };
}
export function serializeListing(d: ListingDraft): string {
  // Keep incomplete drafts editable without inventing a price.
  let m;
  try {
    m = draftManifest(d);
  } catch {
    m = { ...draftManifest({ ...d, priceUsdc: "" }), priceMicro: d.priceUsdc };
  }
  return stringify(m, { lineWidth: 0, aliasDuplicateObjects: false });
}
export function parseListing(source: string): ListingManifest {
  if (source.length > 96000) throw Error("abi.yaml is too large (96 KB maximum).");
  const doc = parseDocument(source, { uniqueKeys: true, merge: false });
  if (doc.errors.length) throw Error(doc.errors[0].message);
  // Listing files are data, not templates. Reject aliases to keep review and resource use bounded.
  const value = doc.toJS({ maxAliasCount: 0 });
  const result = manifestSchema.safeParse(value);
  if (!result.success) {
    const e = result.error.issues[0];
    throw Error(`${e.path.join(".") || "Listing"}: ${e.message}`);
  }
  if (JSON.stringify(value.attributes).length + JSON.stringify(value.service ?? {}).length > 64000)
    throw Error("Listing attributes and service details exceed 64 KB.");
  return result.data;
}
export function manifestDraft(m: ListingManifest): ListingDraft {
  return listingDraft({
    ...m,
    attributes: { ...m.attributes, ...(m.service ? { service: m.service } : {}) },
  });
}
export function listingPayload(m: ListingManifest) {
  const { schemaVersion: _, service, ...product } = m;
  void _;
  const attributes: Record<string, unknown> = {
    ...product.attributes,
    ...(service ? { service } : {}),
  };
  return { ...product, attributes };
}
