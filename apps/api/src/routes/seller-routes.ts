/**
 * Seller partnership surfaces (Phase 0): dedicated seller orgs + profile.
 * Buyer float and seller catalog stay in separate organizations.
 */
import type express from "express";
import { isAddress } from "viem";
import { z } from "zod";
import { csrfProblem } from "../auth/session.js";
import { recordObs } from "../platform/observability.js";
import { store, type OrgRow } from "../store.js";
import { currentUser } from "./auth-routes.js";

type GuardianRoute = (
  handler: (org: OrgRow, req: express.Request, res: express.Response) => unknown,
  opts?: { ownerOnly?: boolean },
) => express.RequestHandler;

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

function sellerProfileView(profile: NonNullable<ReturnType<typeof store.getSellerProfile>>) {
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

function requireSellerOrg(org: OrgRow, res: express.Response): boolean {
  if (org.kind !== "seller") {
    res.status(403).json({
      error: {
        code: "SELLER_ORG_REQUIRED",
        message:
          "Seller APIs require a dedicated seller organization. Create one with POST /v1/seller/orgs.",
      },
    });
    return false;
  }
  return true;
}

export function registerSellerRoutes(
  app: express.Express,
  deps: { guardianRoute: GuardianRoute },
): void {
  const { guardianRoute } = deps;

  /** Create a dedicated seller org for the signed-in user (never reuses buyer float). */
  app.post("/v1/seller/orgs", (req, res) => {
    const me = currentUser(req);
    if (!me) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    const csrf = csrfProblem(req);
    if (csrf) {
      return res.status(403).json({ error: { code: "CSRF_FAILED", message: csrf } });
    }

    const body = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
      })
      .parse(req.body ?? {});

    const existing = store
      .listMembershipsForUser(me.user.id)
      .filter((m) => m.orgKind === "seller");
    const name =
      body.name?.trim() ||
      (existing.length === 0
        ? `${me.user.name.trim()}'s seller org`
        : `${me.user.name.trim()}'s seller org ${existing.length + 1}`);

    const { org, profile } = store.createSellerOrgForUser(me.user.id, name);
    recordObs({ name: "seller.org_created", orgId: org.id });
    res.status(201).json({
      org: { id: org.id, name: org.name, kind: org.kind, status: org.status },
      profile: sellerProfileView(profile),
      note: "Use x-abi-org with this org id for /v1/seller/* routes. Buyer and seller floats stay separate.",
    });
  });

  app.get(
    "/v1/seller/profile",
    guardianRoute((org, _req, res) => {
      if (!requireSellerOrg(org, res)) return;
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
    guardianRoute(
      (org, req, res) => {
        if (!requireSellerOrg(org, res)) return;
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
      },
      { ownerOnly: true },
    ),
  );

  /** Early public directory stub — empty until Phase 1 publishes offers. */
  app.get("/v1/directory/offers", (_req, res) => {
    res.json({
      offers: [],
      note: "Directory is early: published offers will appear here after Phase 1 verify + publish.",
    });
  });
}
