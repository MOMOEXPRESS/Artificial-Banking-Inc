/**
 * Identity routes: sign up, sign in, sessions, memberships, invitations.
 *
 * Replaces "paste a bearer key that never expires" with actual accounts. Bearer
 * keys survive as *machine* credentials for agents and automation; humans use
 * sessions.
 */
import type express from "express";
import { z } from "zod";
import { hashPassword, passwordProblem, verifyPassword } from "../auth/password.js";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  clearSessionCookies,
  newToken,
  parseCookies,
  setSessionCookies,
} from "../auth/session.js";
import { store, type GuardianRoleName, type UserRow } from "../store.js";

const INVITE_TTL_MS = 7 * 24 * 3600_000;

const emailSchema = z.string().email().max(200);

/** Resolve the signed-in user from the session cookie, if any. */
export function currentUser(req: express.Request): { user: UserRow; sessionId: string } | null {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  return store.getUserBySessionToken(token) ?? null;
}

function userView(user: UserRow) {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}

/**
 * Deliberately identical response for "no such account" and "wrong password".
 * Distinguishing them turns the login form into an account-existence oracle.
 */
const LOGIN_FAILED = {
  error: { code: "UNAUTHORIZED", message: "Email or password is incorrect." },
};

export function registerAuthRoutes(app: express.Express) {
  /**
   * Create an account, and an organization to own.
   *
   * Gated the same way org creation is: this mints an owner. Roadmap P3-T5
   * adds email verification, at which point the token gate can relax.
   */
  app.post("/v1/auth/signup", async (req, res) => {
    const body = z
      .object({
        email: emailSchema,
        name: z.string().min(1).max(80),
        password: z.string(),
        orgName: z.string().min(1).max(80).optional(),
        /** Accept an invitation instead of creating a new org. */
        invitationToken: z.string().optional(),
      })
      .parse(req.body);

    const pwProblem = passwordProblem(body.password);
    if (pwProblem) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: pwProblem } });
    }

    const invitation = body.invitationToken
      ? store.findLiveInvitationByToken(body.invitationToken)
      : undefined;
    if (body.invitationToken && !invitation) {
      return res.status(400).json({
        error: { code: "INVALID_INVITATION", message: "That invitation is invalid or expired." },
      });
    }
    if (invitation && invitation.email !== body.email.trim().toLowerCase()) {
      return res.status(400).json({
        error: {
          code: "INVALID_INVITATION",
          message: "This invitation was issued to a different email address.",
        },
      });
    }

    const created = store.createUser({
      email: body.email,
      name: body.name,
      passwordHash: await hashPassword(body.password),
    });
    if ("conflict" in created) {
      return res.status(409).json({
        error: { code: "EMAIL_IN_USE", message: "An account with that email already exists." },
      });
    }

    let orgId: string;
    let role: GuardianRoleName;
    if (invitation) {
      orgId = invitation.orgId;
      role = invitation.role;
      store.markInvitationAccepted(invitation.id);
    } else {
      const org = store.createOrg(body.orgName?.trim() || `${body.name}'s organization`, 0n);
      orgId = org.id;
      role = "owner";
    }
    store.addMembership(created.id, orgId, role);

    issueSession(res, created, req);
    res.status(201).json({
      user: userView(created),
      org: { id: orgId, role },
      note: "Signed in. Agent API keys are issued separately from the console.",
    });
  });

  app.post("/v1/auth/login", async (req, res) => {
    const body = z.object({ email: emailSchema, password: z.string() }).parse(req.body);
    const found = store.findUserCredentialsByEmail(body.email);

    if (!found) {
      // Spend comparable time on the miss so response latency does not reveal
      // whether the account exists.
      await verifyPassword(body.password, "s2:16384:8:1:00:00");
      return res.status(401).json(LOGIN_FAILED);
    }
    if (found.disabled) return res.status(401).json(LOGIN_FAILED);
    if (!(await verifyPassword(body.password, found.passwordHash))) {
      return res.status(401).json(LOGIN_FAILED);
    }

    store.markUserLogin(found.user.id);
    issueSession(res, found.user, req);
    res.json({
      user: userView(found.user),
      orgs: store.listMembershipsForUser(found.user.id).map((m) => ({
        id: m.orgId,
        name: m.orgName,
        role: m.role,
      })),
    });
  });

  app.post("/v1/auth/logout", (req, res) => {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) store.revokeUserSessionByToken(token);
    clearSessionCookies(res);
    res.json({ ok: true });
  });

  app.get("/v1/auth/me", (req, res) => {
    const me = currentUser(req);
    if (!me) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    res.json({
      user: userView(me.user),
      orgs: store.listMembershipsForUser(me.user.id).map((m) => ({
        id: m.orgId,
        name: m.orgName,
        role: m.role,
      })),
      csrfToken: parseCookies(req)[CSRF_COOKIE] ?? null,
    });
  });

  app.post("/v1/auth/change-password", async (req, res) => {
    const me = currentUser(req);
    if (!me) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    const body = z
      .object({ currentPassword: z.string(), newPassword: z.string() })
      .parse(req.body);

    const found = store.findUserCredentialsByEmail(me.user.email);
    if (!found || !(await verifyPassword(body.currentPassword, found.passwordHash))) {
      return res.status(403).json({
        error: { code: "UNAUTHORIZED", message: "Current password is incorrect." },
      });
    }
    const problem = passwordProblem(body.newPassword);
    if (problem) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: problem } });
    }

    // Revokes every session, including this one — changing a password must not
    // leave a stolen session alive.
    store.setUserPassword(me.user.id, await hashPassword(body.newPassword));
    clearSessionCookies(res);
    res.json({ ok: true, note: "Password changed. All sessions signed out — sign in again." });
  });

  // -------------------------------------------------------------- invitations

  /** Owner-only: invite a colleague to this org by email. */
  app.post("/v1/auth/orgs/:orgId/invitations", (req, res) => {
    const gate = requireOwner(req, res);
    if (!gate) return;
    const body = z
      .object({ email: emailSchema, role: z.enum(["approver", "viewer", "owner"]).default("approver") })
      .parse(req.body);

    const token = newToken();
    const invitation = store.createInvitation({
      orgId: gate.orgId,
      email: body.email,
      role: body.role,
      token,
      invitedBy: gate.user.id,
      ttlMs: INVITE_TTL_MS,
    });
    res.status(201).json({
      invitation: { id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt },
      // Shown once. Email delivery is roadmap P3-T5; until then the inviter
      // passes this along out of band.
      invitationToken: token,
      note: "Shown once. The invitee signs up with this token to join the org.",
    });
  });

  app.get("/v1/auth/orgs/:orgId/invitations", (req, res) => {
    const gate = requireOwner(req, res);
    if (!gate) return;
    res.json({ invitations: store.listInvitations(gate.orgId) });
  });

  app.delete("/v1/auth/orgs/:orgId/invitations/:id", (req, res) => {
    const gate = requireOwner(req, res);
    if (!gate) return;
    if (!store.revokeInvitation(gate.orgId, req.params.id)) {
      return res.status(404).json({ error: { code: "NOT_FOUND" } });
    }
    res.json({ ok: true });
  });

  /** Accept an invitation as an already-registered user. */
  app.post("/v1/auth/invitations/accept", (req, res) => {
    const me = currentUser(req);
    if (!me) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    const body = z.object({ invitationToken: z.string() }).parse(req.body);

    const invitation = store.findLiveInvitationByToken(body.invitationToken);
    if (!invitation) {
      return res.status(400).json({
        error: { code: "INVALID_INVITATION", message: "That invitation is invalid or expired." },
      });
    }
    if (invitation.email !== me.user.email) {
      return res.status(403).json({
        error: {
          code: "INVALID_INVITATION",
          message: "This invitation was issued to a different email address.",
        },
      });
    }
    store.addMembership(me.user.id, invitation.orgId, invitation.role);
    store.markInvitationAccepted(invitation.id);
    res.json({ ok: true, org: { id: invitation.orgId, role: invitation.role } });
  });

  // ------------------------------------------------------------------ members

  app.get("/v1/auth/orgs/:orgId/members", (req, res) => {
    const me = currentUser(req);
    if (!me) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    const membership = store.getMembership(me.user.id, req.params.orgId);
    if (!membership) return res.status(403).json({ error: { code: "UNAUTHORIZED" } });
    res.json({
      members: store.listMembersOfOrg(req.params.orgId).map((m) => ({
        userId: m.userId,
        email: m.email,
        name: m.name,
        role: m.role,
        joinedAt: m.createdAt,
      })),
    });
  });

  app.delete("/v1/auth/orgs/:orgId/members/:userId", (req, res) => {
    const gate = requireOwner(req, res);
    if (!gate) return;
    const target = store.getMembership(req.params.userId, gate.orgId);
    if (!target) return res.status(404).json({ error: { code: "NOT_FOUND" } });
    // Removing the last owner would strand the organization with nobody able
    // to administer it — and there is no support channel to recover from that.
    if (target.role === "owner" && store.countOwners(gate.orgId) <= 1) {
      return res.status(409).json({
        error: {
          code: "LAST_OWNER",
          message: "An organization must keep at least one owner. Promote someone else first.",
        },
      });
    }
    store.revokeMembership(req.params.userId, gate.orgId);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------ helpers

  function issueSession(res: express.Response, user: UserRow, req: express.Request) {
    const sessionToken = newToken();
    const csrfToken = newToken();
    store.createUserSession({
      userId: user.id,
      token: sessionToken,
      ttlMs: SESSION_TTL_MS,
      userAgent: req.header("user-agent") ?? undefined,
      ip: req.ip,
    });
    setSessionCookies(res, sessionToken, csrfToken);
  }

  function requireOwner(
    req: express.Request,
    res: express.Response,
  ): { user: UserRow; orgId: string } | null {
    const me = currentUser(req);
    if (!me) {
      res.status(401).json({ error: { code: "UNAUTHORIZED" } });
      return null;
    }
    const orgId = req.params.orgId;
    const membership = store.getMembership(me.user.id, orgId);
    if (!membership || membership.role !== "owner") {
      res.status(403).json({
        error: { code: "UNAUTHORIZED", message: "This action requires an organization owner." },
      });
      return null;
    }
    return { user: me.user, orgId };
  }
}
