import type express from "express";
import {
  createCardFunding,
  FundingError,
  verifyStripeSignature,
  type FundingProvider,
} from "./card-funding.js";
import { commerceDatabase, type OrgRow } from "./store.js";

type GuardianRoute = (
  fn: (org: OrgRow, req: express.Request, res: express.Response) => unknown,
  opts?: { ownerOnly?: boolean },
) => express.RequestHandler;
type StripeObject = Record<string, unknown>;
/** Only Stripe's fixed HTTPS API receives the server credential. No redirects. */
async function stripe(
  path: string,
  fields?: Record<string, string>,
  idempotency?: string,
): Promise<StripeObject> {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: fields ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(12000),
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY ?? ""}`,
      "Stripe-Version": "2024-06-20",
      ...(fields ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotency ? { "Idempotency-Key": idempotency } : {}),
    },
    ...(fields ? { body: new URLSearchParams(fields) } : {}),
  });
  const body = (await res.json()) as StripeObject;
  if (!res.ok) {
    const err = body.error as { payment_intent?: StripeObject } | undefined;
    if (err?.payment_intent) return err.payment_intent;
    throw new FundingError(
      "PAYMENT_PROVIDER_FAILED",
      "The payment provider could not complete this request. Refresh funding activity before retrying.",
      502,
    );
  }
  return body;
}
export function stripeFundingProvider(): FundingProvider {
  const origin = process.env.ABI_CONSOLE_URL ?? "";
  const ready =
    process.env.ABI_CARD_FUNDING_ENABLED === "1" &&
    !!process.env.STRIPE_SECRET_KEY &&
    !!process.env.STRIPE_WEBHOOK_SECRET &&
    /^https:\/\/[^/]+\/?$/.test(origin);
  return {
    ready,
    async customer(orgId) {
      const r = await stripe("customers", { "metadata[abiOrgId]": orgId }, "abi-customer:" + orgId);
      return String(r.id);
    },
    async checkout({ id, orgId, customer, amount, setup }) {
      const fields: Record<string, string> = {
        customer,
        mode: setup ? "setup" : "payment",
        success_url: origin.replace(/\/$/, "") + "/console?view=billing&checkout=returned",
        cancel_url: origin.replace(/\/$/, "") + "/console?view=billing&checkout=cancelled",
        "metadata[abiFundingId]": id,
        "metadata[abiOrgId]": orgId,
      };
      if (setup) {
        fields["payment_method_types[0]"] = "card";
      } else {
        Object.assign(fields, {
          "line_items[0][price_data][currency]": "usd",
          "line_items[0][price_data][unit_amount]": String(amount),
          "line_items[0][price_data][product_data][name]": "ABI card-funded credits",
          "line_items[0][quantity]": "1",
          "payment_method_types[0]": "card",
        });
      }
      const r = await stripe("checkout/sessions", fields, "abi-checkout:" + id);
      return { id: String(r.id), url: String(r.url) };
    },
    async charge({ id, orgId, customer, paymentMethod, amount }) {
      const r = await stripe(
        "payment_intents",
        {
          amount: String(amount),
          currency: "usd",
          customer,
          payment_method: paymentMethod,
          confirm: "true",
          off_session: "true",
          "metadata[abiFundingId]": id,
          "metadata[abiOrgId]": orgId,
        },
        "abi-auto:" + id,
      );
      return { id: String(r.id), status: String(r.status) };
    },
    async setup(id) {
      const r = await stripe("setup_intents/" + encodeURIComponent(id));
      if (r.status !== "succeeded" || typeof r.payment_method !== "string")
        throw new FundingError("SETUP_NOT_VERIFIED", "Payment method setup has not completed.");
      const pm = await stripe("payment_methods/" + encodeURIComponent(r.payment_method));
      const card = pm.card as { brand?: string; last4?: string } | undefined;
      return {
        customer: String(r.customer),
        paymentMethod: r.payment_method,
        label: `${card?.brand ?? "Card"} •••• ${card?.last4 ?? ""}`,
      };
    },
  };
}
export const fundingService = () => createCardFunding(commerceDatabase(), stripeFundingProvider());
export async function runCardFundingJobs() {
  const service = fundingService();
  for (const org of service.dueOrgs()) await service.autoTopup(org);
}
export function registerCardFundingRoutes(
  app: express.Express,
  { guardianRoute }: { guardianRoute: GuardianRoute },
) {
  const safe =
    (fn: (req: express.Request, res: express.Response) => unknown): express.RequestHandler =>
    (req, res) => {
      Promise.resolve()
        .then(() => fn(req, res))
        .catch((e: unknown) => {
          if (e instanceof FundingError)
            return res.status(e.status).json({ error: { code: e.code, message: e.message } });
          return res.status(500).json({
            error: {
              code: "FUNDING_FAILED",
              message: "Funding could not be completed. Refresh activity before retrying.",
            },
          });
        });
    };
  const owner = (fn: (orgId: string, req: express.Request, res: express.Response) => unknown) =>
    guardianRoute((org, req, res) => safe((r, s) => fn(org.id, r, s))(req, res, () => {}), {
      ownerOnly: true,
    });
  app.get(
    "/v1/guardian/billing",
    guardianRoute((org, _req, res) =>
      res.set("Cache-Control", "no-store").json(fundingService().summary(org.id)),
    ),
  );
  app.post(
    "/v1/guardian/billing/checkout",
    owner(async (org, req, res) =>
      res.json(
        await fundingService().checkout(org, {
          requestKey: req.body?.requestKey,
          amountCents: req.body?.amountCents,
        }),
      ),
    ),
  );
  app.post(
    "/v1/guardian/billing/payment-method",
    owner(async (org, req, res) =>
      res.json(
        await fundingService().checkout(org, { requestKey: req.body?.requestKey, setup: true }),
      ),
    ),
  );
  app.put(
    "/v1/guardian/billing/auto-topup",
    owner((org, req, res) => res.json(fundingService().settings(org, req.body ?? {}))),
  );
  app.post(
    "/v1/billing/webhook",
    safe(async (req, res) => {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) return res.status(503).json({ error: { code: "FUNDING_NOT_CONFIGURED" } });
      if (
        !Buffer.isBuffer(req.body) ||
        !verifyStripeSignature(req.body, req.header("stripe-signature") ?? "", secret)
      )
        return res.status(400).json({ error: { code: "INVALID_WEBHOOK_SIGNATURE" } });
      let event;
      try {
        event = JSON.parse(req.body.toString("utf8"));
      } catch {
        return res.status(400).json({ error: { code: "INVALID_EVENT" } });
      }
      return res.json(await fundingService().webhook(event));
    }),
  );
}
