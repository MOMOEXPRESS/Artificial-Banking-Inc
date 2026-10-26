/**
 * Partner (seller) identity: a separate realm from buyer `users`.
 *
 * A partner account is not linked to any buyer account — the same email may
 * exist in both — and owns exactly one seller org, created at sign-up from the
 * company details. Seller APIs authenticate with the partner session only.
 */
import type express from "express";
import { isAddress } from "viem";
import { z } from "zod";
import { hashPassword, passwordProblem, verifyPassword } from "../auth/password.js";
import {
  PARTNER_SESSION_COOKIE,
  SESSION_TTL_MS,
  clearPartnerSessionCookies,
  newToken,
  parseCookies,
  partnerCsrfProblem,
  setPartnerSessionCookies,
} from "../auth/session.js";
import { signupTokenProblem } from "../auth/signup-token.js";
import { assertAuthRuntimeReady } from "../auth/key-encryption.js";
import { allowUnverifiedSignup } from "../platform/email.js";
import { recordObs } from "../platform/observability.js";
import { store, type OrgRow, type PartnerAccountRow } from "../store.js";

export type PartnerRoute = (
  handler: (
    org: OrgRow,
    req: express.Request,
    res: express.Response,
    account: PartnerAccountRow,
  ) => unknown,
) => express.RequestHandler;

const LOGIN_FAILED = {
  error: { code: "UNAUTHORIZED", message: "Email or password is incorrect." },
};

const httpsUrl = z
  .string()
  .trim()
  .url()
  .max(300)
  .refine((url) => /^https:\/\//i.test(url), "Use an HTTPS website");

const signupSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().min(1).max(80),
  password: z.string(),
  companyName: z.string().trim().min(1).max(80),
  website: z.union([z.literal(""), httpsUrl]).optional(),
  description: z.string().trim().max(1000).optional(),
  payoutAddress: z
    .union([
      z.literal(""),
      z.string().trim().refine((v) => isAddress(v), "payoutAddress must be a valid EVM address"),
    ])
    .optional(),
});

export function currentPartner(
  req: express.Request,
): { account: PartnerAccountRow; sessionId: string } | null {
  const token = parseCookies(req)[PARTNER_SESSION_COOKIE];
  if (!token) return null;
  return store.getPartnerBySessionToken(token) ?? null;
}

function partnerView(account: PartnerAccountRow) {
  return { id: account.id, email: account.email, name: account.name, createdAt: account.createdAt };
}

function orgView(org: OrgRow) {
  return { id: org.id, name: org.name, kind: org.kind, status: org.status };
}

function issuePartnerSession(res: express.Response, account: PartnerAccountRow) {
  const token = newToken();
  store.createPartnerSession({ accountId: account.id, token, ttlMs: SESSION_TTL_MS });
  setPartnerSessionCookies(res, token, newToken());
}

function handleError(req: express.Request, res: express.Response, e: unknown) {
  if (e instanceof z.ZodError) {
    const first = e.issues[0];
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: first ? `${first.path.join(".") || "body"}: ${first.message}` : e.message,
      },
    });
  }
  if (e instanceof Error && e.message === "INVALID_USDC_AMOUNT") {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid USDC amount" } });
  }
  req.log?.error({ err: e }, "partner route error");
  res.status(500).json({ error: { code: "RAIL_FAILED", message: "Internal error" } });
}

function route(
  handler: (req: express.Request, res: express.Response) => unknown,
): express.RequestHandler {
  return (req, res) => {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch((e) => handleError(req, res, e));
  };
}

export const partnerRoute: PartnerRoute = (handler) =>
  route((req, res) => {
    const me = currentPartner(req);
    if (!me) {
      return res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "Sign in at /partners/login." },
      });
    }
    const problem = partnerCsrfProblem(req);
    if (problem) {
      return res.status(403).json({ error: { code: "CSRF_FAILED", message: problem } });
    }
    const org = store.getOrg(me.account.orgId);
    if (!org || org.kind !== "seller") {
      return res.status(403).json({
        error: { code: "SELLER_ORG_REQUIRED", message: "This partner account has no seller org." },
      });
    }
    return handler(org, req, res, me.account);
  });

export function registerPartnerAuthRoutes(app: express.Express): void {
  app.post(
    "/v1/partner/auth/signup",
    route(async (req, res) => {
      const gate = signupTokenProblem(req);
      if (gate) {
        return res.status(403).json({ error: { code: "UNAUTHORIZED", message: gate } });
      }
      const body = signupSchema.parse(req.body ?? {});
      const pwProblem = passwordProblem(body.password);
      if (pwProblem) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: pwProblem } });
      }
      // Partner email verification is not built yet; production refuses
      // unverified partner sign-ups unless the operator opted in for demos.
      if (process.env.NODE_ENV === "production" && !allowUnverifiedSignup()) {
        return res.status(503).json({
          error: {
            code: "PARTNER_SIGNUP_UNAVAILABLE",
            message:
              "Partner sign-up requires email verification, which is not enabled yet. " +
              "For testnet demos set ABI_ALLOW_UNVERIFIED_SIGNUP=1.",
          },
        });
      }
      assertAuthRuntimeReady();

      let created;
      try {
        created = store.createPartnerAccountWithOrg({
          email: body.email,
          name: body.name,
          passwordHash: await hashPassword(body.password),
          companyName: body.companyName,
          website: body.website || "",
          description: body.description || "",
          payoutAddress: body.payoutAddress || undefined,
        });
      } catch (e) {
        if (e instanceof Error && e.message === "PARTNER_EMAIL_TAKEN") {
          return res.status(409).json({
            error: {
              code: "EMAIL_IN_USE",
              message: "A partner account with that email already exists. Sign in instead.",
            },
          });
        }
        throw e;
      }
      recordObs({ name: "seller.org_created", orgId: created.org.id });
      issuePartnerSession(res, created.account);
      res.status(201).json({
        partner: partnerView(created.account),
        org: orgView(created.org),
      });
    }),
  );

  app.post(
    "/v1/partner/auth/login",
    route(async (req, res) => {
      const body = z
        .object({ email: z.string().trim().email().max(200), password: z.string() })
        .parse(req.body ?? {});
      const found = store.findPartnerCredentialsByEmail(body.email);
      if (!found) {
        await verifyPassword(body.password, "s2:16384:8:1:00:00");
        return res.status(401).json(LOGIN_FAILED);
      }
      if (!(await verifyPassword(body.password, found.passwordHash))) {
        return res.status(401).json(LOGIN_FAILED);
      }
      store.markPartnerLogin(found.account.id);
      issuePartnerSession(res, found.account);
      const org = store.getOrg(found.account.orgId);
      res.json({ partner: partnerView(found.account), org: org ? orgView(org) : null });
    }),
  );

  app.post("/v1/partner/auth/logout", (req, res) => {
    const token = parseCookies(req)[PARTNER_SESSION_COOKIE];
    if (token) store.revokePartnerSessionByToken(token);
    clearPartnerSessionCookies(res);
    res.json({ ok: true });
  });

  app.get("/v1/partner/auth/me", (req, res) => {
    const me = currentPartner(req);
    if (!me) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    const org = store.getOrg(me.account.orgId);
    res.json({ partner: partnerView(me.account), org: org ? orgView(org) : null });
  });
}
