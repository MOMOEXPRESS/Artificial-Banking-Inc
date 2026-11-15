import type express from "express";
import { z } from "zod";
import { commerceDatabase, store, sellerStore, type OrgRow } from "./store.js";
import { createWalletKey, listWalletKeys, changeWalletKey } from "./wallet-keys.js";
import {
  canUseWorkspace,
  allocationView,
  WorkspaceError,
  ensureWorkspaces,
  createWorkspace,
  viewWorkspace,
  findWorkspace,
  setCard,
  connectAgent,
  allocateWorkspace,
  workspaceForAgent,
} from "./workspaces.js";
import { currentUser } from "./routes/auth-routes.js";
import {
  PrivyTrialError,
  privyTrialStatus,
  provisionPrivyTrial,
  verifyPrivyTrial,
} from "./privy-trial.js";
import { parseCookies, PARTNER_SESSION_COOKIE } from "./auth/session.js";

type GuardianRoute = (
  fn: (org: OrgRow, req: express.Request, res: express.Response) => unknown,
  opts?: { ownerOnly?: boolean },
) => express.RequestHandler;
const key = z
  .string()
  .min(16)
  .max(100)
  .regex(/^[\w:-]+$/);
const amount = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/);
export function registerWorkspaceRoutes(
  app: express.Express,
  deps: {
    guardianRoute: GuardianRoute;
    authAgent: (
      req: express.Request,
    ) => { orgId: string; agentId: string; scopes: string[]; sessionId?: string } | null;
  },
) {
  app.get("/v1/account/workspaces", (req, res) => {
    const me = currentUser(req);
    if (!me) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    const workspaces = store.listMembershipsForUser(me.user.id).flatMap((m) =>
      ensureWorkspaces(m.orgId)
        .filter((w) => canUseWorkspace(m.orgId, String(w.id), m.role, me.user.id))
        .map((w) => ({
          ...viewWorkspace(m.orgId, String(w.id)),
          role: m.role,
        })),
    );
    return res.json({ workspaces });
  });
  const route = (
    fn: (org: OrgRow, req: express.Request, res: express.Response) => unknown,
    owner = false,
  ) =>
    deps.guardianRoute(
      async (org, req, res) => {
        try {
          const ctx = (req as express.Request & { guardianCtx?: { role: string } }).guardianCtx;
          if (
            req.params.workspaceId &&
            !canUseWorkspace(
              org.id,
              String(req.params.workspaceId),
              ctx?.role ?? "viewer",
              currentUser(req)?.user.id,
            )
          )
            throw new WorkspaceError(
              "WORKSPACE_FORBIDDEN",
              "This workspace has not been shared with you.",
              403,
            );
          return await fn(org, req, res);
        } catch (e) {
          if (e instanceof WorkspaceError)
            return res.status(e.status).json({ error: { code: e.code, message: e.message } });
          if (e instanceof PrivyTrialError)
            return res.status(e.status).json({ error: { code: e.code, message: e.message } });
          throw e;
        }
      },
      { ownerOnly: owner },
    );
  app.get(
    "/v1/guardian/workspaces/:workspaceId/privy",
    route(
      (org, req, res) => res.json(privyTrialStatus(org.id, String(req.params.workspaceId))),
      true,
    ),
  );
  app.post(
    "/v1/guardian/workspaces/:workspaceId/privy",
    route(async (org, req, res) => {
      z.object({ acknowledgeTestOnly: z.literal(true) })
        .strict()
        .parse(req.body);
      res.json(await provisionPrivyTrial(org.id, String(req.params.workspaceId)));
    }, true),
  );
  app.post(
    "/v1/guardian/workspaces/:workspaceId/privy/verify",
    route(async (org, req, res) => {
      z.object({}).strict().parse(req.body);
      res.json(await verifyPrivyTrial(org.id, String(req.params.workspaceId)));
    }, true),
  );
  app.get(
    "/v1/guardian/workspaces",
    route((org, _req, res) =>
      res.json({
        workspaces: ensureWorkspaces(org.id)
          .filter((w) =>
            canUseWorkspace(
              org.id,
              String(w.id),
              (_req as express.Request & { guardianCtx?: { role: string } }).guardianCtx?.role ??
                "viewer",
              currentUser(_req)?.user.id,
            ),
          )
          .map((w) => viewWorkspace(org.id, String(w.id))),
      }),
    ),
  );
  app.post(
    "/v1/guardian/workspaces",
    route((org, req, res) => {
      const b = z
        .object({ name: z.string().trim().min(1).max(80), idempotencyKey: key })
        .strict()
        .parse(req.body);
      return res.status(201).json({ workspace: createWorkspace(org.id, b.name, b.idempotencyKey) });
    }, true),
  );
  app.get(
    "/v1/guardian/workspaces/:workspaceId",
    route((org, req, res) =>
      res.json({ workspace: viewWorkspace(org.id, String(req.params.workspaceId)) }),
    ),
  );
  app.patch(
    "/v1/guardian/workspaces/:workspaceId/card",
    route((org, req, res) => {
      const b = z
        .object({
          status: z.enum(["active", "frozen"]).optional(),
          limitUsdc: amount.optional(),
          period: z.enum(["day", "week", "month", "total"]).optional(),
          allowRecurring: z.boolean().optional(),
          services: z.array(z.string().url().max(2048)).max(500).nullable().optional(),
        })
        .strict()
        .parse(req.body);
      return res.json({ workspace: setCard(org.id, String(req.params.workspaceId), b) });
    }, true),
  );
  app.post(
    "/v1/guardian/workspaces/:workspaceId/connections",
    route((org, req, res) => {
      const b = z
        .object({
          name: z.string().trim().min(1).max(80),
          pay: z.boolean().default(false),
          ttlHours: z.number().int().min(1).max(720).default(24),
          idempotencyKey: key,
        })
        .strict()
        .parse(req.body);
      return res
        .status(201)
        .json(
          connectAgent(org.id, String(req.params.workspaceId), { ...b, key: b.idempotencyKey }),
        );
    }, true),
  );
  app.get(
    "/v1/guardian/wallet-keys",
    route((org, _req, res) => res.json({ keys: listWalletKeys(org.id) }), true),
  );
  app.post(
    "/v1/guardian/wallet-keys",
    route((org, req, res) => {
      const input = z
        .object({
          name: z.string().trim().min(1).max(80),
          workspaceIds: z.array(z.string().min(1).max(100)).min(1).max(20),
          permissions: z
            .array(z.enum(["wallets:create", "cards:manage", "keys:manage"]))
            .max(3)
            .default([]),
          pay: z.boolean().default(false),
          ttlHours: z.number().int().min(1).max(720).default(24),
          idempotencyKey: key,
        })
        .strict()
        .parse(req.body);
      return res.status(201).json(createWalletKey(org.id, input));
    }, true),
  );
  app.post(
    "/v1/guardian/wallet-keys/:keyId/:operation",
    route((org, req, res) => {
      const operation = z.enum(["rotate", "revoke"]).parse(req.params.operation);
      return res.json(changeWalletKey(org.id, String(req.params.keyId), operation));
    }, true),
  );
  app.get(
    "/v1/guardian/spending-services",
    route((_org, _req, res) =>
      res.json({
        services: sellerStore.listDirectoryOffers().map((o) => ({
          id: o.id,
          name: o.title,
          providerId: o.orgId,
          provider: o.sellerName,
          endpoint: o.endpointUrl,
        })),
      }),
    ),
  );
  app.post(
    "/v1/guardian/workspaces/:workspaceId/allocations",
    route((org, req, res) => {
      const b = z
        .object({
          toWorkspaceId: z.string().min(1).max(100),
          amountUsdc: amount,
          idempotencyKey: key,
        })
        .strict()
        .parse(req.body);
      return res.json({
        allocation: allocateWorkspace(
          org.id,
          String(req.params.workspaceId),
          b.toWorkspaceId,
          b.amountUsdc,
          b.idempotencyKey,
        ),
      });
    }, true),
  );
  app.get(
    "/v1/guardian/workspaces/:workspaceId/allocations",
    route((org, req, res) => {
      const w = findWorkspace(org.id, String(req.params.workspaceId));
      return res.json({
        allocations: commerceDatabase()
          .prepare(
            "SELECT * FROM abi_workspace_allocations WHERE org_id=? AND (from_id=? OR to_id=?) ORDER BY created_at DESC LIMIT 100",
          )
          .all(org.id, w.id, w.id)
          .map((row) => allocationView(row as Record<string, string | number | null>)),
      });
    }),
  );
  app.post(
    "/v1/guardian/workspaces/:workspaceId/seller",
    route((org, req, res) => {
      const user = currentUser(req);
      if (
        !user ||
        !user.user.emailVerifiedAt ||
        store.getMembership(user.user.id, org.id)?.role !== "owner"
      )
        throw new WorkspaceError(
          "OWNER_SESSION_REQUIRED",
          "Sign in as the account owner to enable selling.",
          403,
        );
      const w = findWorkspace(org.id, String(req.params.workspaceId));
      const partnerToken = parseCookies(req)[PARTNER_SESSION_COOKIE];
      const existing = partnerToken ? store.getPartnerBySessionToken(partnerToken) : undefined;
      const b = z
        .object({ linkExisting: z.boolean().default(false) })
        .strict()
        .parse(req.body);
      if (b.linkExisting && !existing)
        throw new WorkspaceError(
          "SELLER_SESSION_REQUIRED",
          "Sign in to the existing seller account in this browser before linking it.",
          403,
        );
      commerceDatabase().transaction(() => {
        if (w.seller_org_id) return;
        const sellerOrg = b.linkExisting
          ? store.getOrg(existing!.account.orgId)!
          : store.createOrg(`${w.name} seller`, 0n, { kind: "seller" });
        if (
          commerceDatabase()
            .prepare("SELECT 1 FROM abi_workspaces WHERE seller_org_id=?")
            .get(sellerOrg.id)
        )
          throw new WorkspaceError(
            "SELLER_ALREADY_LINKED",
            "That seller is already associated with a workspace.",
          );
        commerceDatabase()
          .prepare("UPDATE abi_workspaces SET seller_org_id=? WHERE id=? AND org_id=?")
          .run(sellerOrg.id, w.id, org.id);
      })();
      return res.json({ workspace: viewWorkspace(org.id, String(w.id)) });
    }, true),
  );
  app.post(
    "/v1/guardian/workspaces/:workspaceId/members",
    route((org, req, res) => {
      const b = z
        .object({ userId: z.string().min(1).max(100), enabled: z.boolean() })
        .strict()
        .parse(req.body);
      const w = findWorkspace(org.id, String(req.params.workspaceId));
      if (!store.getMembership(b.userId, org.id))
        throw new WorkspaceError(
          "MEMBERSHIP_REQUIRED",
          "Invite this person to the account before sharing its workspace.",
          400,
        );
      if (b.enabled)
        commerceDatabase()
          .prepare("INSERT OR IGNORE INTO abi_workspace_members(workspace_id,user_id) VALUES (?,?)")
          .run(w.id, b.userId);
      else
        commerceDatabase()
          .prepare("DELETE FROM abi_workspace_members WHERE workspace_id=? AND user_id=?")
          .run(w.id, b.userId);
      res.json({ ok: true });
    }, true),
  );
  app.get("/v1/agent/context", (req, res) => {
    const auth = deps.authAgent(req);
    if (!auth) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    if (!auth.scopes.includes("read"))
      return res.status(403).json({ error: { code: "INSUFFICIENT_SCOPE" } });
    const w = workspaceForAgent(auth.agentId);
    if (!w)
      return res.status(409).json({
        error: {
          code: "WORKSPACE_CONNECTION_REQUIRED",
          message: "Ask the owner to create a card connection.",
        },
      });
    commerceDatabase()
      .prepare("UPDATE abi_workspace_connections SET verified_at=? WHERE agent_id=?")
      .run(new Date().toISOString(), auth.agentId);
    res.json({
      workspace: viewWorkspace(auth.orgId, String(w.id)),
      agentId: auth.agentId,
      scopes: auth.scopes,
      verified: true,
      network: process.env.CHAIN ?? "base-sepolia",
      capabilities: {
        read: true,
        pay: auth.scopes.includes("pay"),
        reallocate: false,
        manageKeys: false,
        hostedMcp: "testnet-only",
      },
    });
  });
  app.get("/v1/agent/wallets", (req, res) => {
    const auth = deps.authAgent(req);
    if (!auth || !auth.scopes.includes("read"))
      return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    const linked = commerceDatabase()
      .prepare("SELECT parent_session_id FROM abi_key_wallet_grants WHERE session_id=?")
      .get(auth.sessionId ?? "") as { parent_session_id: string } | undefined;
    const rows = linked
      ? (commerceDatabase()
          .prepare("SELECT workspace_id FROM abi_key_wallet_grants WHERE parent_session_id=?")
          .all(linked.parent_session_id) as { workspace_id: string }[])
      : [];
    const workspace = workspaceForAgent(auth.agentId);
    return res.json({
      wallets: (rows.length
        ? rows.map((r) => r.workspace_id)
        : workspace
          ? [String(workspace.id)]
          : []
      ).map((id) => {
        const w = findWorkspace(auth.orgId, id);
        return { id, name: w.name, cardId: w.card_id };
      }),
    });
  });
  const agentRoute =
    (
      scope: string,
      handler: (
        auth: NonNullable<ReturnType<typeof deps.authAgent>>,
        req: express.Request,
        res: express.Response,
      ) => unknown,
    ): express.RequestHandler =>
    (req, res, next) => {
      try {
        const auth = deps.authAgent(req);
        if (!auth) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
        if (!auth.sessionId || !auth.scopes.includes(scope))
          return res.status(403).json({ error: { code: "INSUFFICIENT_SCOPE" } });
        return handler(auth, req, res);
      } catch (e) {
        if (e instanceof WorkspaceError)
          return res.status(e.status).json({ error: { code: e.code, message: e.message } });
        next(e);
      }
    };
  app.post(
    "/v1/agent/wallets",
    agentRoute("wallets:create", (auth, req, res) => {
      const b = z
        .object({ name: z.string().trim().min(1).max(80), idempotencyKey: key })
        .strict()
        .parse(req.body);
      // Creation never grants existing funds or raises any allowance. Access to
      // this new wallet still requires an owner-issued key grant.
      return res.status(201).json({
        workspace: createWorkspace(auth.orgId, b.name, `${auth.sessionId}:${b.idempotencyKey}`),
      });
    }),
  );
  app.patch(
    "/v1/agent/card",
    agentRoute("cards:manage", (auth, req, res) => {
      const b = z
        .object({ status: z.enum(["active", "frozen"]) })
        .strict()
        .parse(req.body);
      const w = workspaceForAgent(auth.agentId);
      if (!w) throw new WorkspaceError("WORKSPACE_CONNECTION_REQUIRED", "Connect a wallet first.");
      return res.json({ workspace: setCard(auth.orgId, String(w.id), b) });
    }),
  );
  app.post(
    "/v1/agent/key/:operation",
    agentRoute("keys:manage", (auth, req, res) => {
      const operation = z.enum(["rotate", "revoke"]).parse(req.params.operation);
      const parent = commerceDatabase()
        .prepare("SELECT parent_session_id FROM abi_key_wallet_grants WHERE session_id=?")
        .get(auth.sessionId) as { parent_session_id: string } | undefined;
      return res.json(
        changeWalletKey(auth.orgId, parent?.parent_session_id ?? auth.sessionId!, operation),
      );
    }),
  );
}
