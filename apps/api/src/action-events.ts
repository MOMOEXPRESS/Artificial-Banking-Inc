/**
 * Events for console actions that never raised one: sign-in, agent created,
 * API key created / revoked, buyer policy changed, member invited, Playground
 * run finished.
 *
 * Implemented as one response hook instead of edits inside each handler, so
 * the route code (and the payment path) is untouched: the hook watches for a
 * 2xx response on a known route, then calls `emitEvent` — which records the
 * notification and fans out to webhooks like every other event.
 */
import type express from "express";
import { store } from "./store.js";
import { emitEvent, type WebhookEvent } from "./webhooks.js";

type Ctx = { org?: { id: string }; user?: { email: string; name: string } };
type Body = Record<string, any> | undefined;

type Rule = {
  method: string;
  path: RegExp;
  /** Runs before the handler (e.g. to read the previous state). */
  before?: (req: express.Request, m: RegExpMatchArray) => unknown;
  emit: (args: {
    req: express.Request;
    m: RegExpMatchArray;
    body: Body;
    orgId: string | undefined;
    ctx: Ctx | undefined;
    prior: unknown;
  }) => { orgIds: string[]; event: WebhookEvent; data: Record<string, unknown> } | null;
};

function agentName(orgId: string | undefined, agentId: string | undefined): string | undefined {
  if (!orgId || !agentId) return undefined;
  return store.listAgents(orgId).find((a) => a.id === agentId)?.name;
}

const FINISHED = new Set(["complete", "failed", "cancelled"]);

export const ACTION_RULES: Rule[] = [
  {
    method: "POST",
    path: /^\/v1\/auth\/login$/,
    emit: ({ req, body }) => {
      const orgIds: string[] = Array.isArray(body?.orgs)
        ? body!.orgs
            .map((o: any) => o?.id ?? o?.orgId)
            .filter((x: unknown) => typeof x === "string")
        : [];
      if (!orgIds.length) return null;
      return {
        orgIds,
        event: "auth.signin",
        data: { email: body?.user?.email, userAgent: req.get("user-agent") ?? undefined },
      };
    },
  },
  {
    method: "POST",
    path: /^\/v1\/guardian\/agents$/,
    emit: ({ body, orgId }) =>
      orgId && body?.agentId
        ? {
            orgIds: [orgId],
            event: "agent.created",
            data: { agentId: body.agentId, agentName: agentName(orgId, body.agentId) },
          }
        : null,
  },
  {
    method: "POST",
    path: /^\/v1\/guardian\/agents\/([^/]+)\/rotate-key$/,
    emit: ({ m, orgId }) =>
      orgId
        ? {
            orgIds: [orgId],
            event: "api_key.created",
            data: { agentId: m[1], agentName: agentName(orgId, m[1]), via: "rotate" },
          }
        : null,
  },
  {
    method: "POST",
    path: /^\/v1\/guardian\/agents\/([^/]+)\/session-keys$/,
    emit: ({ m, orgId, body }) =>
      orgId
        ? {
            orgIds: [orgId],
            event: "api_key.created",
            data: {
              agentId: m[1],
              agentName: agentName(orgId, m[1]),
              via: "session_key",
              sessionKeyId: body?.sessionKey?.id ?? body?.id,
            },
          }
        : null,
  },
  {
    method: "POST",
    path: /^\/v1\/guardian\/agents\/([^/]+)\/revoke-key$/,
    emit: ({ m, orgId }) =>
      orgId
        ? {
            orgIds: [orgId],
            event: "api_key.revoked",
            data: { agentId: m[1], agentName: agentName(orgId, m[1]), via: "api_key" },
          }
        : null,
  },
  {
    method: "POST",
    path: /^\/v1\/guardian\/session-keys\/([^/]+)\/revoke$/,
    emit: ({ m, orgId }) =>
      orgId
        ? {
            orgIds: [orgId],
            event: "api_key.revoked",
            data: { sessionKeyId: m[1], via: "session_key" },
          }
        : null,
  },
  {
    method: "POST",
    path: /^\/v1\/guardian\/policy$/,
    emit: ({ orgId, body }) =>
      orgId
        ? {
            orgIds: [orgId],
            event: "policy.changed",
            data: { scope: "org", action: "updated", version: body?.policy?.version },
          }
        : null,
  },
  {
    method: "POST",
    path: /^\/v1\/guardian\/policy\/apply-template$/,
    emit: ({ orgId, req }) =>
      orgId
        ? {
            orgIds: [orgId],
            event: "policy.changed",
            data: { scope: "org", action: `template ${String(req.body?.templateId ?? "")}`.trim() },
          }
        : null,
  },
  {
    method: "POST",
    path: /^\/v1\/guardian\/policy\/versions\/([^/]+)\/restore$/,
    emit: ({ orgId, m }) =>
      orgId
        ? {
            orgIds: [orgId],
            event: "policy.changed",
            data: { scope: "org", action: `restored ${m[1]}` },
          }
        : null,
  },
  {
    method: "*",
    path: /^\/v1\/guardian\/agents\/([^/]+)\/policy$/,
    emit: ({ orgId, m, req }) =>
      orgId && req.method !== "GET"
        ? {
            orgIds: [orgId],
            event: "policy.changed",
            data: {
              scope: "agent",
              agentId: m[1],
              agentName: agentName(orgId, m[1]),
              action: req.method === "DELETE" ? "override removed" : "override set",
            },
          }
        : null,
  },
  {
    method: "POST",
    path: /^\/v1\/auth\/orgs\/([^/]+)\/invitations$/,
    emit: ({ m, req }) => ({
      orgIds: [m[1]!],
      event: "member.invited",
      data: { email: req.body?.email, role: req.body?.role ?? "approver" },
    }),
  },
  {
    method: "POST",
    path: /^\/v1\/guardian\/guardians$/,
    emit: ({ orgId, body }) =>
      orgId
        ? {
            orgIds: [orgId],
            event: "member.invited",
            data: { name: body?.guardian?.name, role: body?.guardian?.role },
          }
        : null,
  },
  {
    method: "PUT",
    path: /^\/v1\/guardian\/runs\/([^/]+)$/,
    // Run ids are primary keys, so the previous status can be read before the
    // upsert; the org check happens after, against guardianRoute's org.
    before: (_req, m) => ({ previous: store.getRunStatusAnyOrg(m[1]!) }),
    emit: ({ orgId, req, m, prior }) => {
      if (!orgId) return null;
      const status = String(req.body?.status ?? "");
      if (!FINISHED.has(status)) return null;
      const previous = (prior as { previous?: { orgId: string; status: string } | null }).previous;
      if (previous && previous.orgId !== orgId) return null;
      if (previous && FINISHED.has(previous.status)) return null; // already reported
      return {
        orgIds: [orgId],
        event: "playground.run.finished",
        data: {
          runId: m[1],
          title: req.body?.title,
          status,
          agentId: req.body?.agentId,
          agentName: req.body?.agentName,
          costUsdc: req.body?.costUsdc,
        },
      };
    },
  },
];

/** Express middleware; register once, before the routes. */
export function actionEventsMiddleware(): express.RequestHandler {
  return (req, res, next) => {
    const path = req.path;
    const rule = ACTION_RULES.find(
      (r) => (r.method === "*" || r.method === req.method.toUpperCase()) && r.path.test(path),
    );
    if (!rule) return next();
    const m = path.match(rule.path)!;
    const prior = (rule.before?.(req, m) ?? {}) as Record<string, unknown>;
    let body: Body;
    const origJson = res.json.bind(res);
    res.json = ((value: unknown) => {
      body = value as Body;
      return origJson(value);
    }) as typeof res.json;
    res.on("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      try {
        const ctx = (req as any).guardianCtx as Ctx | undefined;
        const out = rule.emit({ req, m, body, orgId: ctx?.org?.id, ctx, prior });
        if (!out) return;
        for (const orgId of out.orgIds) emitEvent(orgId, out.event, out.data);
      } catch (e) {
        console.error("action event failed:", (e as Error).message);
      }
    });
    next();
  };
}
