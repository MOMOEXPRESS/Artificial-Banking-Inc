/**
 * Second factor, step-up, and password recovery.
 *
 * Three gaps this closes:
 *   - A stolen password was total account takeover. Now it is not, if MFA is on.
 *   - Approving a large payment required only possession of a live session.
 *     High-value approvals now require a fresh second factor.
 *   - A forgotten password meant a permanently lost organization, because there
 *     was no recovery path of any kind.
 */
import type express from "express";
import { z } from "zod";
import { hashPassword, passwordProblem, verifyPassword } from "../auth/password.js";
import { clearSessionCookies, newToken } from "../auth/session.js";
import {
  generateRecoveryCodes,
  generateSecret,
  otpauthUri,
  verifyCode,
} from "../auth/totp.js";
import { notify } from "../platform/notifier.js";
import { store } from "../store.js";
import { currentUser } from "./auth-routes.js";

/** How long a step-up lasts before a high-value approval needs it again. */
export const STEP_UP_TTL_MS = Number(process.env.ABI_STEP_UP_TTL_MINUTES ?? 5) * 60_000;
const RESET_TTL_MS = 60 * 60_000;

/**
 * Approvals at or above this amount require a fresh second factor.
 * `0` disables step-up entirely; the default protects anything over $100.
 */
export function stepUpThresholdMicro(): bigint {
  const raw = process.env.ABI_STEP_UP_ABOVE_USDC ?? "100";
  try {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return 100_000_000n;
    return BigInt(Math.round(n * 1e6));
  } catch {
    return 100_000_000n;
  }
}

export function registerMfaRoutes(app: express.Express) {
  // ------------------------------------------------------------- enrolment

  app.post("/v1/auth/mfa/enroll", (req, res) => {
    const me = currentUser(req);
    if (!me) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    const existing = store.getMfa(me.user.id);
    if (existing?.confirmed) {
      return res.status(409).json({
        error: { code: "MFA_ALREADY_ENABLED", message: "Disable the current factor first." },
      });
    }
    const secret = generateSecret();
    store.startMfaEnrolment(me.user.id, secret);
    res.json({
      secret,
      otpauthUri: otpauthUri(secret, me.user.email),
      note: "Add this to an authenticator app, then confirm with a code. Not active until confirmed.",
    });
  });

  app.post("/v1/auth/mfa/confirm", (req, res) => {
    const me = currentUser(req);
    if (!me) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    const body = z.object({ code: z.string() }).parse(req.body);

    const mfa = store.getMfa(me.user.id);
    if (!mfa) {
      return res.status(400).json({
        error: { code: "MFA_NOT_STARTED", message: "Start enrolment first." },
      });
    }
    const check = verifyCode(mfa.secret, body.code, { lastUsedStep: mfa.lastStep });
    if (!check.ok) {
      return res.status(400).json({ error: { code: "MFA_INVALID", message: "That code is not valid." } });
    }

    store.confirmMfa(me.user.id, check.step);
    // Issued once. Without them, a lost phone is a lost organization.
    const codes = generateRecoveryCodes();
    store.replaceRecoveryCodes(
      me.user.id,
      codes.map((c) => c.toLowerCase()),
    );
    res.json({
      ok: true,
      recoveryCodes: codes,
      note: "Store these somewhere safe. Each works once, and they are shown only now.",
    });
  });

  app.post("/v1/auth/mfa/disable", async (req, res) => {
    const me = currentUser(req);
    if (!me) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    const body = z.object({ password: z.string() }).parse(req.body);

    // Turning off a second factor is exactly what an attacker with a stolen
    // session would try, so re-prove the password.
    const found = store.findUserCredentialsByEmail(me.user.email);
    if (!found || !(await verifyPassword(body.password, found.passwordHash))) {
      return res.status(403).json({ error: { code: "UNAUTHORIZED", message: "Password is incorrect." } });
    }
    store.disableMfa(me.user.id);
    res.json({ ok: true });
  });

  app.get("/v1/auth/mfa", (req, res) => {
    const me = currentUser(req);
    if (!me) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    const mfa = store.getMfa(me.user.id);
    res.json({
      enabled: Boolean(mfa?.confirmed),
      pending: Boolean(mfa && !mfa.confirmed),
      recoveryCodesRemaining: mfa?.confirmed ? store.countUnusedRecoveryCodes(me.user.id) : 0,
      stepUp: {
        thresholdUsdc: (Number(stepUpThresholdMicro()) / 1e6).toString(),
        ttlMinutes: STEP_UP_TTL_MS / 60_000,
        active: store.hasLiveStepUp(me.sessionId),
      },
    });
  });

  // --------------------------------------------------------------- step-up

  /**
   * Re-prove identity, granting a short-lived window in which high-value
   * approvals may be resolved.
   */
  app.post("/v1/auth/step-up", async (req, res) => {
    const me = currentUser(req);
    if (!me) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    const body = z
      .object({ code: z.string().optional(), password: z.string().optional() })
      .parse(req.body);

    const mfa = store.getMfa(me.user.id);
    if (mfa?.confirmed) {
      if (!body.code) {
        return res.status(400).json({
          error: { code: "MFA_REQUIRED", message: "Enter a code from your authenticator app." },
        });
      }
      const check = verifyCode(mfa.secret, body.code, { lastUsedStep: mfa.lastStep });
      if (!check.ok) {
        // Fall back to a recovery code so a lost device is not a lockout.
        if (!store.useRecoveryCode(me.user.id, body.code)) {
          return res.status(403).json({ error: { code: "MFA_INVALID", message: "That code is not valid." } });
        }
      } else {
        store.recordMfaStep(me.user.id, check.step);
      }
    } else {
      // No second factor enrolled: the password is the strongest proof there is.
      if (!body.password) {
        return res.status(400).json({
          error: { code: "PASSWORD_REQUIRED", message: "Confirm your password to continue." },
        });
      }
      const found = store.findUserCredentialsByEmail(me.user.email);
      if (!found || !(await verifyPassword(body.password, found.passwordHash))) {
        return res.status(403).json({ error: { code: "UNAUTHORIZED", message: "Password is incorrect." } });
      }
    }

    store.grantStepUp(me.user.id, me.sessionId, STEP_UP_TTL_MS);
    res.json({
      ok: true,
      expiresInMinutes: STEP_UP_TTL_MS / 60_000,
      note: "High-value approvals are unlocked for this window.",
    });
  });

  // ------------------------------------------------------- password reset

  /**
   * Request a reset link.
   *
   * Always answers 200, whether or not the address is registered — otherwise
   * this endpoint enumerates accounts.
   */
  app.post("/v1/auth/password-reset/request", (req, res) => {
    const body = z.object({ email: z.string().email().max(200) }).parse(req.body);
    const found = store.findUserCredentialsByEmail(body.email);

    if (found && !found.disabled) {
      const token = newToken();
      store.createPasswordReset(found.user.id, token, RESET_TTL_MS);
      const link = `${(process.env.ABI_CONSOLE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/console?reset=${token}`;
      void notify(
        {
          kind: "info",
          orgId: "",
          title: "ABI password reset",
          body: `Reset your password: ${link}\n\nThis link expires in one hour. If you did not ask for it, ignore this email.`,
          meta: { email: found.user.email },
        },
        ["email"],
      );
      // Without an email provider configured the notifier only logs, so surface
      // the token to the operator in development rather than silently failing.
      if (process.env.NODE_ENV !== "production") {
        return res.json({
          ok: true,
          devResetToken: token,
          note: "Dev only: email is not configured, so the token is returned here.",
        });
      }
    }

    res.json({
      ok: true,
      note: "If that address has an account, a reset link is on its way.",
    });
  });

  app.post("/v1/auth/password-reset/confirm", async (req, res) => {
    const body = z.object({ token: z.string(), newPassword: z.string() }).parse(req.body);
    const problem = passwordProblem(body.newPassword);
    if (problem) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: problem } });
    }

    const consumed = store.consumePasswordReset(body.token);
    if (!consumed) {
      return res.status(400).json({
        error: { code: "INVALID_TOKEN", message: "That reset link is invalid, used, or expired." },
      });
    }
    // Also revokes every session for this user — a reset must evict whoever
    // prompted it.
    store.setUserPassword(consumed.userId, await hashPassword(body.newPassword));
    clearSessionCookies(res);
    res.json({ ok: true, note: "Password updated. Sign in with the new password." });
  });
}
