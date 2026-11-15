import type express from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { commerceDatabase, store } from "../store.js";
import { verifySupabaseIdentity, IdentityError } from "../auth/supabase.js";
import { accountMfaProblem } from "../auth/mfa-check.js";
import { hashPassword } from "../auth/password.js";
import {
  csrfProblem,
  newToken,
  SESSION_TTL_MS,
  setSessionCookies,
  parseCookies,
  SESSION_COOKIE,
} from "../auth/session.js";
import { signupTokenProblem } from "../auth/signup-token.js";
import { KYC_TERMS_VERSION } from "../kyc-kya.js";
import { queueDefaultCustomerWallet } from "../customer-wallets.js";
export function registerSupabaseAuth(app: express.Express, fetcher: typeof fetch = fetch) {
  app.post("/v1/auth/supabase/exchange", (req, res, next) => {
    void (async () => {
      const token = req.header("authorization")?.match(/^Bearer (.+)$/)?.[1];
      if (!token) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
      const body = z
        .object({
          acceptTerms: z.boolean().default(false),
          linkExisting: z.boolean().default(false),
          mfaCode: z.string().max(100).optional(),
        })
        .strict()
        .parse(req.body);
      const identity = await verifySupabaseIdentity(token, fetcher);
      const linked = commerceDatabase()
        .prepare("SELECT user_id FROM abi_external_identities WHERE subject=?")
        .get(identity.id) as { user_id: string } | undefined;
      let user = linked ? store.getUser(linked.user_id) : undefined;
      let newExternalOnly = false;
      if (!linked) {
        const found = store.findUserCredentialsByEmail(identity.email);
        if (found) {
          const sessionCookie = parseCookies(req)[SESSION_COOKIE];
          const current = sessionCookie ? store.getUserBySessionToken(sessionCookie) : undefined;
          if (!body.linkExisting || !current || current.user.id !== found.user.id)
            return res.status(409).json({
              error: {
                code: "ACCOUNT_LINK_REQUIRED",
                message:
                  "Sign in to your existing ABI account in another tab, then explicitly link this sign-in. Your wallets stay with that account.",
              },
            });
          const csrf = csrfProblem(req);
          if (csrf) return res.status(403).json({ error: { code: "CSRF_FAILED", message: csrf } });
          if (
            commerceDatabase()
              .prepare("SELECT 1 FROM abi_external_identities WHERE user_id=?")
              .get(found.user.id)
          )
            return res.status(409).json({
              error: {
                code: "IDENTITY_ALREADY_LINKED",
                message: "This account already has a different Supabase identity.",
              },
            });
          user = found.user;
        } else {
          const gate = signupTokenProblem(req);
          if (gate)
            return res.status(403).json({ error: { code: "SIGNUP_UNAVAILABLE", message: gate } });
          if (!body.acceptTerms)
            return res.status(400).json({
              error: {
                code: "TERMS_REQUIRED",
                message: "Accept the Terms and Privacy Notice to create your ABI account.",
              },
            });
          const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
          const result = commerceDatabase().transaction(() => {
            const created = store.createAccountWithOrg({
              email: identity.email,
              name: identity.name || identity.email.split("@")[0]!,
              passwordHash,
              verificationToken: newToken(),
              verificationTtlMs: 60000,
              markEmailVerified: true,
            });
            if (created.status !== "created")
              throw new IdentityError(
                409,
                "ACCOUNT_LINK_REQUIRED",
                "An account already exists. Sign in and link it explicitly.",
              );
            commerceDatabase()
              .prepare(
                "INSERT INTO abi_external_identities(subject,user_id,external_only,created_at) VALUES (?,?,1,?)",
              )
              .run(identity.id, created.user.id, new Date().toISOString());
            store.recordTermsAcceptance(created.user.id, KYC_TERMS_VERSION);
            return created.user;
          })();
          user = result;
          newExternalOnly = true;
        }
      }
      if (!user) throw new IdentityError(401, "UNAUTHORIZED", "The ABI account is unavailable.");
      const credentials = store.findUserCredentialsByEmail(user.email);
      if (!credentials || credentials.disabled || !user.emailVerifiedAt)
        throw new IdentityError(401, "UNAUTHORIZED", "The ABI account is unavailable.");
      const factor = accountMfaProblem(user.id, body.mfaCode);
      if (factor) return res.status(403).json({ error: factor });
      if (!linked && !newExternalOnly)
        commerceDatabase()
          .prepare(
            "INSERT INTO abi_external_identities(subject,user_id,external_only,created_at) VALUES (?,?,0,?)",
          )
          .run(identity.id, user.id, new Date().toISOString());
      const sessionToken = newToken();
      commerceDatabase().transaction(() => {
        const session = store.createUserSession({
          userId: user.id,
          token: sessionToken,
          ttlMs: SESSION_TTL_MS,
          userAgent: req.header("user-agent"),
          ip: req.ip,
        });
        commerceDatabase()
          .prepare(
            "INSERT INTO abi_external_sessions(session_id,subject,provider_session_id) VALUES (?,?,?)",
          )
          .run(session.id, identity.id, identity.sessionId);
      })();
      store.markUserLogin(user.id);
      setSessionCookies(res, sessionToken, newToken());
      const ownerOrg = store.listMembershipsForUser(user.id).find((m) => m.role === "owner");
      if (ownerOrg) queueDefaultCustomerWallet(user.id, ownerOrg.orgId);
      return res.json({
        user: { id: user.id, email: user.email, name: user.name, emailVerified: true },
        orgs: store
          .listMembershipsForUser(user.id)
          .map((m) => ({ id: m.orgId, name: m.orgName, role: m.role, kind: m.orgKind })),
      });
    })().catch((e) => {
      if (e instanceof IdentityError)
        return res.status(e.status).json({ error: { code: e.code, message: e.message } });
      next(e);
    });
  });
}
