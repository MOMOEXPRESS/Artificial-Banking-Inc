/**
 * Seller partnership surfaces: dedicated seller orgs, profile, catalog, integrate.
 * Published offers are listed in the buyer directory by default; sellers opt out
 * per offer with `directoryListed: false`. Agents can still reach offers on the
 * seller’s own site either way.
 *
 * An offer is either served by the seller's own x402 server (`endpointUrl`) or
 * hosted by ABI at /v1/x402/offers/:id, where ABI answers the 402 challenge and
 * settles through the facilitator straight to the seller's payout address.
 */
import type express from "express";
import { isAddress } from "viem";
import { z } from "zod";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { parseUsdcToMicro, formatMicroToUsdc } from "@policyvault/common";
import { verifyPassword } from "../auth/password.js";
import { resolveConsoleUrl, sendEmail } from "../platform/email.js";
import { recordObs } from "../platform/observability.js";
import { fetchNoRedirect, outboundUrlProblem } from "../outbound-url.js";
import {
  partnerStore,
  sellerStore,
  store,
  type OfferRow,
  type PartnerAccountRow,
  type SellerProfileRow,
} from "../store.js";
import { emitEvent } from "../webhooks.js";
import {
  X402_NETWORKS,
  handleHostedOffer,
  hostedOfferUrl,
  requirementFor,
} from "../seller-x402.js";
import { checkSecondFactor, partnerRoute } from "./partner-auth-routes.js";

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
  supportEmail: z.union([z.literal(""), z.string().trim().email().max(200)]).optional(),
  /** Required to change an existing payout address. */
  currentPassword: z.string().max(200).optional(),
  /** Also required for a payout change when the account has MFA on. */
  code: z.string().max(12).optional(),
  recoveryCode: z.string().max(40).optional(),
});

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case");

const endpointSchema = z
  .string()
  .url()
  .max(500)
  .refine((url) => /^https?:\/\//i.test(url), "endpointUrl must be http(s)");

export const OFFER_CATEGORIES = [
  "data",
  "research",
  "ai-model",
  "media",
  "finance",
  "developer-tools",
  "other",
] as const;

const offerCreateSchema = z
  .object({
    slug: slugSchema,
    title: z.string().trim().min(1).max(120),
    hosted: z.boolean().default(false),
    endpointUrl: endpointSchema.optional(),
    priceUsdc: z.string().trim().min(1).max(32),
    network: z.enum(["base-sepolia", "base"]).default("base-sepolia"),
    description: z.string().trim().max(1000).default(""),
    category: z.enum(OFFER_CATEGORIES).default("other"),
    hostedContent: z.string().max(20_000).default(""),
  })
  .refine((b) => b.hosted || Boolean(b.endpointUrl), {
    message: "endpointUrl is required unless ABI hosts the offer",
    path: ["endpointUrl"],
  });

const offerPatchSchema = z.object({
  slug: slugSchema.optional(),
  title: z.string().trim().min(1).max(120).optional(),
  endpointUrl: endpointSchema.optional(),
  priceUsdc: z.string().trim().min(1).max(32).optional(),
  network: z.enum(["base-sepolia", "base"]).optional(),
  /** Pause takes an offer off sale; resume through publish. */
  status: z.enum(["paused"]).optional(),
  directoryListed: z.boolean().optional(),
  sandboxEnabled: z.boolean().optional(),
  description: z.string().trim().max(1000).optional(),
  category: z.enum(OFFER_CATEGORIES).optional(),
  accessMode: z.enum(["open", "allowlist"]).optional(),
  hostedContent: z.string().max(20_000).optional(),
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
    supportEmail: profile.supportEmail,
    updatedAt: profile.updatedAt,
  };
}

export function offerView(offer: OfferRow) {
  const integration = store.getOfferIntegration(offer.id);
  return {
    id: offer.id,
    slug: offer.slug,
    title: offer.title,
    description: offer.description,
    category: offer.category,
    endpointUrl: offer.endpointUrl,
    hosted: offer.hosted,
    hostedContent: offer.hosted ? offer.hostedContent : "",
    priceUsdc: formatMicroToUsdc(BigInt(offer.priceUsdcMicro)),
    priceUsdcMicro: offer.priceUsdcMicro,
    network: offer.network,
    status: offer.status,
    accessMode: offer.accessMode,
    version: offer.version,
    familyId: offer.familyId,
    deprecatedAt: offer.deprecatedAt ?? null,
    sunsetAt: offer.sunsetAt ?? null,
    successorOfferId: offer.successorOfferId ?? null,
    archivedAt: offer.archivedAt ?? null,
    directoryListed: offer.directoryListed,
    sandboxEnabled: offer.sandboxEnabled,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
    integration: {
      lastVerifiedAt: integration?.lastVerifiedAt ?? null,
      snippetVersion: integration?.snippetVersion ?? null,
      error: integration?.error ?? null,
      lastChallenge: integration?.lastChallengeJson
        ? challengeView(safeJson(integration.lastChallengeJson))
        : null,
    },
  };
}

/** Saved checks from older builds lack `problems`; always return a list. */
function challengeView(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const check = raw as Record<string, unknown>;
  return {
    ...check,
    problems: Array.isArray(check.problems)
      ? check.problems.filter((p): p is string => typeof p === "string")
      : [],
    ...(check.offered !== undefined && {
      offered: Array.isArray(check.offered) ? check.offered : [],
    }),
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function safePath(endpointUrl: string): string {
  try {
    const u = new URL(endpointUrl);
    return u.pathname || "/";
  } catch {
    return "/";
  }
}

export type SnippetStack = "express" | "hono" | "next";

/** Working x402 V2 server code for the seller's own stack, pinned to this offer. */
export function buildSnippet(
  offer: OfferRow,
  profile: SellerProfileRow | undefined,
  stack: SnippetStack,
): string {
  const payTo = profile?.payoutAddress || "0xYOUR_PAYOUT_ADDRESS";
  const price = `$${formatMicroToUsdc(BigInt(offer.priceUsdcMicro))}`;
  const network = X402_NETWORKS[offer.network]?.caip2 ?? "eip155:84532";
  const path = safePath(offer.endpointUrl);
  const description = offer.title.replace(/"/g, '\\"');
  const route = `{
  "GET ${path}": {
    accepts: { scheme: "exact", price: "${price}", network: "${network}", payTo: "${payTo}", maxTimeoutSeconds: 120 },
    description: "${description}",
    mimeType: "application/json",
  },
}`;
  const server = `const facilitator = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });
const resourceServer = new x402ResourceServer(facilitator).register("${network}", new ExactEvmScheme());`;
  if (stack === "hono") {
    return `// ${offer.slug} ${offer.version}: npm i hono @x402/hono @x402/core @x402/evm
import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

${server}

const app = new Hono();
app.use(paymentMiddleware(${route}, resourceServer));
app.get("${path}", (c) => c.json({ ok: true, offer: "${offer.slug}" }));

export default app;
`;
  }
  if (stack === "next") {
    return `// ${offer.slug} ${offer.version}: npm i @x402/next @x402/core @x402/evm
// app${path}/route.ts (settles only after the handler answers < 400)
import { NextResponse } from "next/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

${server}

export const GET = withX402(
  async () => NextResponse.json({ ok: true, offer: "${offer.slug}" }),
  {
    accepts: [{ scheme: "exact", price: "${price}", network: "${network}", payTo: "${payTo}" }],
    description: "${description}",
  },
  resourceServer,
);
`;
  }
  return `// ${offer.slug} ${offer.version}: npm i express @x402/express @x402/core @x402/evm
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

${server}

const app = express();
// Answer only GET on the paid path: HEAD would otherwise run the handler unpaid.
app.all("${path}", (req, res, next) => (req.method === "GET" ? next() : res.status(405).set("allow", "GET").end()));
app.use(paymentMiddleware(${route}, resourceServer));
app.get("${path}", (_req, res) => res.json({ ok: true, offer: "${offer.slug}" }));

app.listen(Number(process.env.PORT ?? 3000));
`;
}

function notFound(res: express.Response) {
  return res.status(404).json({ error: { code: "NOT_FOUND", message: "Offer not found" } });
}

function parsePrice(raw: string): string | { error: string } {
  let micro: bigint;
  try {
    micro = parseUsdcToMicro(raw);
  } catch {
    return { error: "Invalid USDC amount" };
  }
  if (micro <= 0n) return { error: "priceUsdc must be greater than zero" };
  return micro.toString();
}

interface ChallengeCheck {
  httpStatus: number;
  paymentHeader: string | null;
  bodyPreview: string;
  expectedPayTo: string | null;
  expectedNetwork: string;
  expectedPriceUsdc: string;
  offered?: { scheme: string; network: string; asset: string; amount: string; payTo: string }[];
  problems: string[];
}

/**
 * Check an unpaid response is a 402 asking for exactly what the listing says:
 * this seller's payout address, the offer's network, USDC, and the offer's price.
 */
function checkChallenge(
  offer: OfferRow,
  payTo: string | undefined,
  status: number,
  header: string | null,
  bodyText: string,
): ChallengeCheck {
  const check: ChallengeCheck = {
    httpStatus: status,
    paymentHeader: header ? header.slice(0, 500) : null,
    bodyPreview: bodyText.slice(0, 800),
    expectedPayTo: payTo ?? null,
    expectedNetwork: offer.network,
    expectedPriceUsdc: formatMicroToUsdc(BigInt(offer.priceUsdcMicro)),
    problems: [],
  };
  if (status !== 402) {
    check.problems.push(`Expected HTTP 402 Payment Required from an unpaid GET; got ${status}.`);
    return check;
  }
  if (!header) {
    check.problems.push("The 402 has no PAYMENT-REQUIRED header (x402 V2).");
    return check;
  }
  let accepts: ChallengeCheck["offered"] = [];
  try {
    const decoded = decodePaymentRequiredHeader(header);
    if (decoded.x402Version !== 2)
      check.problems.push(`x402 V${decoded.x402Version}; ABI pays V2.`);
    accepts = decoded.accepts.map((a) => ({
      scheme: a.scheme,
      network: a.network,
      asset: a.asset,
      amount: a.amount,
      payTo: a.payTo,
    }));
  } catch {
    check.problems.push("PAYMENT-REQUIRED is not valid base64 JSON.");
    return check;
  }
  check.offered = accepts;
  if (!payTo) {
    check.problems.push("Set a payout address in Settings before verifying.");
    return check;
  }
  const want = requirementFor(offer, payTo);
  const match = accepts.find(
    (a) =>
      a.scheme === "exact" &&
      a.network === want.network &&
      a.asset.toLowerCase() === want.asset.toLowerCase(),
  );
  if (!match) {
    check.problems.push(`No exact USDC option on ${want.network}.`);
    return check;
  }
  if (match.payTo.toLowerCase() !== payTo.toLowerCase()) {
    check.problems.push(`Pays ${match.payTo}, but your payout address is ${payTo}.`);
  }
  if (match.amount !== want.amount) {
    check.problems.push(
      `Asks for ${formatMicroToUsdc(BigInt(match.amount))} USDC; the listing says ${check.expectedPriceUsdc}.`,
    );
  }
  return check;
}

/** Sites behind bot rules often 403 requests without a User-Agent; sellers can allowlist this one. */
const VERIFY_USER_AGENT = "ABI-Verify/1.0 (+https://artificial-banking-inc-web.vercel.app)";

async function probeOffer(
  offer: OfferRow,
): Promise<{ status: number; header: string | null; body: string }> {
  if (offer.hosted) {
    const r = await handleHostedOffer(offer.id, () => undefined);
    return {
      status: r.status,
      header: r.headers["PAYMENT-REQUIRED"] ?? null,
      body: JSON.stringify(r.body),
    };
  }
  const problem = outboundUrlProblem(offer.endpointUrl, "Offer endpoint");
  if (problem) throw new Error(problem);
  const response = await fetchNoRedirect(
    offer.endpointUrl,
    {
      method: "GET",
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "application/json", "user-agent": VERIFY_USER_AGENT },
    },
    "Offer endpoint",
  );
  let body = "";
  try {
    body = (await response.text()).slice(0, 4_000);
  } catch {
    body = "";
  }
  return { status: response.status, header: response.headers.get("payment-required"), body };
}

function notifyConnectedBuyers(
  sellerOrgId: string,
  sellerName: string,
  oldAddress: string | undefined,
  newAddress: string | undefined,
): void {
  for (const c of sellerStore.listBuyerConnections(sellerOrgId)) {
    emitEvent(c.buyerOrgId, "merchant.payee_changed", {
      sellerOrgId,
      sellerName,
      offerId: c.offerId ?? null,
      endpointUrl: c.key,
      pinnedPayTo: c.pinnedPayTo ?? null,
      oldAddress: oldAddress ?? null,
      newAddress: newAddress ?? null,
      action:
        "Pays to this seller are paused until a guardian reconnects to confirm the new payee.",
    });
  }
}

async function notifyPayoutChange(
  account: PartnerAccountRow,
  orgName: string,
  oldAddress: string | undefined,
  newAddress: string | undefined,
): Promise<void> {
  const consoleUrl = resolveConsoleUrl();
  const link = consoleUrl.ok ? `${consoleUrl.url}/seller/settings` : "your seller settings";
  await sendEmail({
    to: account.email,
    subject: "Your ABI payout address changed",
    text: `Hi ${account.name},\n\nThe payout address for ${orgName} changed\nfrom ${oldAddress ?? "(none)"}\nto   ${newAddress ?? "(none)"}.\n\nNew sales settle to the new address. If you did not make this change, sign in at ${link}, change your password and sign out of every session.`,
  }).catch(() => undefined);
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
    partnerRoute(async (org, req, res, account) => {
      const body = sellerProfileSchema.parse(req.body ?? {});
      const before = store.getSellerProfile(org.id);
      const nextPayout =
        body.payoutAddress === undefined
          ? undefined
          : body.payoutAddress === ""
            ? null
            : body.payoutAddress;
      const payoutChanging =
        nextPayout !== undefined &&
        (nextPayout ?? "").toLowerCase() !== (before?.payoutAddress ?? "").toLowerCase();
      if (payoutChanging && before?.payoutAddress) {
        const hash = partnerStore.passwordHash(account.id);
        if (!body.currentPassword || !hash || !(await verifyPassword(body.currentPassword, hash))) {
          return res.status(403).json({
            error: {
              code: "PASSWORD_REQUIRED",
              message: "Enter your current password to change where payouts go.",
            },
          });
        }
        const factor = checkSecondFactor(account.id, body);
        if (factor) {
          return res.status(403).json({
            error: {
              ...factor,
              message:
                factor.code === "MFA_REQUIRED"
                  ? "Enter your authenticator code to change where payouts go."
                  : factor.message,
            },
          });
        }
      }
      try {
        const profile = store.upsertSellerProfile(org.id, {
          displayName: body.displayName,
          payoutAddress: nextPayout,
          network: body.network,
          website: body.website,
          description: body.description,
          supportEmail: body.supportEmail,
        });
        if (payoutChanging) {
          sellerStore.recordPayoutAddressChange({
            sellerOrgId: org.id,
            oldAddress: before?.payoutAddress,
            newAddress: profile.payoutAddress,
            changedBy: account.email,
          });
          emitEvent(org.id, "seller.payout_address.changed", {
            oldAddress: before?.payoutAddress ?? null,
            newAddress: profile.payoutAddress ?? null,
            changedBy: account.email,
          });
          if (before?.payoutAddress) {
            void notifyPayoutChange(account, org.name, before.payoutAddress, profile.payoutAddress);
          }
          notifyConnectedBuyers(org.id, org.name, before?.payoutAddress, profile.payoutAddress);
        }
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
    "/v1/seller/profile/payout-history",
    partnerRoute((org, _req, res) => {
      res.json({ changes: sellerStore.listPayoutAddressChanges(org.id) });
    }),
  );

  app.get(
    "/v1/seller/offers",
    partnerRoute((org, req, res) => {
      const includeArchived = req.query.archived === "1";
      const live = store.listOffers(org.id);
      const offers = includeArchived
        ? [
            ...live,
            ...sellerStore
              .listArchivedOffers(org.id)
              .filter((o) => !live.some((l) => l.id === o.id)),
          ]
        : live;
      res.json({ offers: offers.map(offerView) });
    }),
  );

  app.post(
    "/v1/seller/offers",
    partnerRoute((org, req, res) => {
      const body = offerCreateSchema.parse(req.body ?? {});
      const price = parsePrice(body.priceUsdc);
      if (typeof price !== "string") {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: price.error } });
      }
      if (body.hosted && !body.hostedContent.trim()) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Hosted offers need the content a paid call returns.",
          },
        });
      }
      try {
        const offer = store.createOffer({
          orgId: org.id,
          slug: body.slug,
          title: body.title,
          endpointUrl: body.endpointUrl ?? "",
          priceUsdcMicro: price,
          network: body.network,
          description: body.description,
          category: body.category,
          hosted: body.hosted,
          hostedContent: body.hosted ? body.hostedContent : "",
          endpointFor: body.hosted ? hostedOfferUrl : undefined,
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
      const existing = store.getOffer(org.id, req.params.offerId);
      if (!existing || existing.archivedAt) return notFound(res);
      let priceUsdcMicro: string | undefined;
      if (body.priceUsdc !== undefined) {
        const price = parsePrice(body.priceUsdc);
        if (typeof price !== "string") {
          return res
            .status(400)
            .json({ error: { code: "VALIDATION_ERROR", message: price.error } });
        }
        priceUsdcMicro = price;
      }
      if (
        body.status === "paused" &&
        existing.status !== "verified" &&
        existing.status !== "published" &&
        existing.status !== "paused"
      ) {
        return res.status(400).json({
          error: {
            code: "NOT_VERIFIED",
            message: "Only a verified or published offer can be paused. Verify it first.",
          },
        });
      }
      if (existing.hosted && body.endpointUrl !== undefined) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Hosted offers are served at their ABI URL; the endpoint cannot be changed.",
          },
        });
      }
      if (body.hostedContent !== undefined && !existing.hosted) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Only ABI-hosted offers carry content; your server returns its own.",
          },
        });
      }
      // What a buyer pays and where must be re-verified before it is sold again.
      const termsChanged =
        (body.endpointUrl !== undefined && body.endpointUrl !== existing.endpointUrl) ||
        (priceUsdcMicro !== undefined && priceUsdcMicro !== existing.priceUsdcMicro) ||
        (body.network !== undefined && body.network !== existing.network);
      try {
        const offer = store.updateOffer(org.id, existing.id, {
          title: body.title,
          endpointUrl: body.endpointUrl,
          priceUsdcMicro,
          network: body.network,
          slug: body.slug,
          status: termsChanged ? "draft" : body.status,
          directoryListed: body.directoryListed,
          sandboxEnabled: body.sandboxEnabled,
          description: body.description,
          category: body.category,
          accessMode: body.accessMode,
          hostedContent: body.hostedContent,
        });
        if (termsChanged) {
          store.setOfferIntegration(offer.id, { lastVerifiedAt: null, error: null });
        }
        res.json({
          offer: offerView(offer),
          ...(termsChanged && {
            note: "Price, network or endpoint changed, so the offer is back in draft. Verify and publish it again.",
          }),
        });
      } catch (error) {
        if (error instanceof Error && error.message === "OFFER_NOT_FOUND") return notFound(res);
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
    "/v1/seller/offers/:offerId/archive",
    partnerRoute((org, req, res) => {
      const offer = store.getOffer(org.id, req.params.offerId);
      if (!offer) return notFound(res);
      sellerStore.archiveOffer(org.id, offer.id);
      recordObs({ name: "seller.offer_archived", orgId: org.id });
      res.json({
        ok: true,
        note: "Archived: off sale and out of the directory. Past sales and invoices keep it.",
      });
    }),
  );

  app.get(
    "/v1/seller/offers/:offerId/snippet",
    partnerRoute((org, req, res) => {
      const offer = store.getOffer(org.id, req.params.offerId);
      if (!offer) return notFound(res);
      const profile = store.getSellerProfile(org.id);
      if (offer.hosted) {
        return res.json({
          offerId: offer.id,
          hosted: true,
          endpointUrl: offer.endpointUrl,
          note: "ABI serves this offer. There is nothing to deploy: verify, then publish.",
          snippets: {},
        });
      }
      const stacks: SnippetStack[] = ["express", "hono", "next"];
      const snippets = Object.fromEntries(stacks.map((s) => [s, buildSnippet(offer, profile, s)]));
      store.setOfferIntegration(offer.id, { snippetVersion: "v2", error: null });
      res.json({
        offerId: offer.id,
        version: "v2",
        language: "typescript",
        snippet: snippets.express,
        snippets,
        note: "Buyer agents pay this endpoint with x402. USDC settles to your payout address.",
      });
    }),
  );

  app.post(
    "/v1/seller/offers/:offerId/verify",
    partnerRoute(async (org, req, res) => {
      const offer = store.getOffer(org.id, req.params.offerId);
      if (!offer || offer.archivedAt) return notFound(res);
      const profile = store.getSellerProfile(org.id);
      try {
        const probe = await probeOffer(offer);
        const challenge = checkChallenge(
          offer,
          profile?.payoutAddress,
          probe.status,
          probe.header,
          probe.body,
        );
        if (challenge.problems.length) {
          store.setOfferIntegration(offer.id, {
            lastChallengeJson: JSON.stringify(challenge),
            lastVerifiedAt: null,
            error: challenge.problems.join(" "),
          });
          if (offer.status === "verified" || offer.status === "published") {
            store.updateOffer(org.id, offer.id, { status: "draft" });
          }
          return res.status(422).json({
            ok: false,
            error: { code: "VERIFY_FAILED", message: challenge.problems.join(" ") },
            challenge,
            offer: offerView(store.getOffer(org.id, offer.id)!),
          });
        }
        store.setOfferIntegration(offer.id, {
          lastChallengeJson: JSON.stringify(challenge),
          lastVerifiedAt: new Date().toISOString(),
          error: null,
          snippetVersion: offer.hosted ? "hosted" : "v2",
        });
        const updated =
          offer.status === "published" || offer.status === "paused"
            ? offer
            : store.updateOffer(org.id, offer.id, { status: "verified" });
        recordObs({ name: "seller.offer_verified", orgId: org.id });
        res.json({
          ok: true,
          challenge,
          offer: offerView(updated),
          note: "The unpaid GET asks for the right payee, network and price. Publish when ready.",
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
      if (!offer || offer.archivedAt) return notFound(res);
      const integration = store.getOfferIntegration(offer.id);
      if (
        !integration?.lastVerifiedAt ||
        (offer.status !== "verified" && offer.status !== "published" && offer.status !== "paused")
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
      const claims = sellerStore.endpointClaims(offer.endpointUrl, org.id);
      if (claims.length) {
        return res.status(409).json({
          error: {
            code: "ENDPOINT_CLAIMED",
            message:
              "Another seller already lists this endpoint. A URL can only pay one seller; contact support if it is yours.",
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
      const offers = new Map(store.listOffers(org.id).map((o) => [o.id, o]));
      res.json({
        settlements: rows.map((r) => ({
          id: r.id,
          offerId: r.offerId ?? null,
          offerTitle: (r.offerId && offers.get(r.offerId)?.title) || null,
          buyerOrgId: r.buyerOrgId ?? null,
          buyerName: (r.buyerOrgId && store.getOrg(r.buyerOrgId)?.name) || null,
          amountUsdc: formatMicroToUsdc(BigInt(r.amountMicro)),
          txHash: r.txHash ?? null,
          explorerUrl: r.txHash
            ? explorerTxUrl(
                (r.offerId && offers.get(r.offerId)?.network) || "base-sepolia",
                r.txHash,
              )
            : null,
          state: r.state,
          createdAt: r.createdAt,
        })),
        note: "Inbound pays appear here after buyer agents settle x402 to your offers.",
      });
    }),
  );

  /** Buyer directory: published offers are listed unless the seller opted out. */
  app.get("/v1/directory/offers", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const category = typeof req.query.category === "string" ? req.query.category : "";
    const network = typeof req.query.network === "string" ? req.query.network : "";
    const offers = sellerStore.listDirectoryOffers().filter((o) => {
      if (o.archivedAt || o.status !== "published") return false;
      if (category && o.category !== category) return false;
      if (network && o.network !== network) return false;
      if (!q) return true;
      return [o.title, o.slug, o.description, o.sellerName, o.category]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    res.json({
      offers: offers.map((offer) => ({
        id: offer.id,
        slug: offer.slug,
        title: offer.title,
        description: offer.description,
        category: offer.category,
        endpointUrl: offer.endpointUrl,
        hosted: offer.hosted,
        priceUsdc: formatMicroToUsdc(BigInt(offer.priceUsdcMicro)),
        priceUsdcMicro: offer.priceUsdcMicro,
        network: offer.network,
        accessMode: offer.accessMode,
        payTo: offer.payoutAddress ?? null,
        version: offer.version,
        deprecatedAt: offer.deprecatedAt ?? null,
        sunsetAt: offer.sunsetAt ?? null,
        successorOfferId: offer.successorOfferId ?? null,
        sandboxEnabled: offer.sandboxEnabled,
        seller: {
          orgId: offer.orgId,
          name: offer.sellerName,
          website: offer.website || null,
          supportEmail: offer.supportEmail || null,
        },
      })),
      categories: OFFER_CATEGORIES,
    });
  });
}

export function explorerTxUrl(network: string, txHash: string): string {
  return network === "base"
    ? `https://basescan.org/tx/${txHash}`
    : `https://sepolia.basescan.org/tx/${txHash}`;
}
