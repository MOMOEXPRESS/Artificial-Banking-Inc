/**
 * Marketplace listings spike (products create + get-by-id).
 *
 *   POST /v1/guardian/products      create one product (org-scoped)
 *   GET  /v1/guardian/products/:id  read one product (org-scoped; cross-org → 404)
 *
 * No vendor onboarding, search, checkout, or UI. Money is priceMicro (TEXT
 * minor units) + currency, matching amount_micro / price_usdc_micro elsewhere.
 */
import type express from "express";
import { z } from "zod";
import { store, type OrgRow, type ProductRecord } from "./store.js";

type GuardianRoute = (
  handler: (org: OrgRow, req: express.Request, res: express.Response) => unknown,
  opts?: { ownerOnly?: boolean },
) => express.RequestHandler;

const PRICE_MICRO_RE = /^\d+$/;

const productCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional().default(""),
  category: z.string().trim().min(1).max(80),
  /** Integer minor units as a digit string (USDC micro when currency is USDC). */
  priceMicro: z
    .string()
    .trim()
    .regex(PRICE_MICRO_RE, "priceMicro must be a non-negative integer string"),
  currency: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, "currency must be alphanumeric")
    .optional()
    .default("USDC"),
  stockLevel: z.number().int().min(0).max(1_000_000_000).optional().default(0),
  vendorId: z.string().trim().min(1).max(120),
  images: z.array(z.string().url().max(500)).max(20).optional().default([]),
  attributes: z.record(z.unknown()).optional().default({}),
});

function productView(p: ProductRecord) {
  return {
    id: p.id,
    orgId: p.orgId,
    name: p.name,
    description: p.description,
    category: p.category,
    priceMicro: p.priceMicro,
    currency: p.currency,
    stockLevel: p.stockLevel,
    vendorId: p.vendorId,
    images: p.images,
    attributes: p.attributes,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function registerListingsRoutes(
  app: express.Express,
  deps: { guardianRoute: GuardianRoute },
): void {
  const { guardianRoute } = deps;

  app.post(
    "/v1/guardian/products",
    guardianRoute((org, req, res) => {
      const body = productCreateSchema.parse(req.body);
      const product = store.createProduct({
        orgId: org.id,
        name: body.name,
        description: body.description,
        category: body.category,
        priceMicro: body.priceMicro,
        currency: body.currency,
        stockLevel: body.stockLevel,
        vendorId: body.vendorId,
        images: body.images,
        attributes: body.attributes,
      });
      res.status(201).json({ product: productView(product) });
    }),
  );

  app.get(
    "/v1/guardian/products/:id",
    guardianRoute((org, req, res) => {
      const id = String(req.params.id ?? "");
      const product = store.getProduct(org.id, id);
      if (!product) {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Product not found" },
        });
      }
      res.json({ product: productView(product) });
    }),
  );
}
