/**
 * AI Agent Management HTTP surface — roster, profile, groups, ownership,
 * keys (rotate/revoke), session keys, freeze history, per-agent analytics.
 */
import {
  accountId,
  agentApiKeyIsLive,
  formatMicroToUsdc,
  parseUsdcToMicro,
  type AgentIdentity,
} from "@policyvault/common";
import { transferAvailable } from "@policyvault/ledger";
import type express from "express";
import { z } from "zod";
import { burnForecast } from "./analytics.js";
import { id } from "./engine.js";
import { notify } from "./platform/notifier.js";
import { recordObs } from "./platform/observability.js";
import { store, type OrgRow } from "./store.js";
import { emitEvent } from "./webhooks.js";

type GuardianRoute = (
  handler: (org: OrgRow, req: express.Request, res: express.Response) => unknown,
  opts?: { ownerOnly?: boolean },
) => express.RequestHandler;

function identityOf(agent: {
  id: string;
  orgId: string;
  name: string;
  status: AgentIdentity["status"];
  profile: Record<string, unknown>;
  apiKey: string;
}): AgentIdentity & { apiKeyLive: boolean } {
  return {
    id: agent.id,
    orgId: agent.orgId,
    name: agent.name,
    status: agent.status,
    profile: agent.profile,
    apiKeyLive: agentApiKeyIsLive(agent.apiKey),
  };
}

function balOf(orgId: string, agentId: string) {
  const accounts = store.getAccountMap(orgId);
  const available = accounts.get(accountId("agent", agentId))?.balanceMicro ?? 0n;
  const held = accounts.get(accountId("agent", agentId, "held"))?.balanceMicro ?? 0n;
  return {
    availableUsdc: formatMicroToUsdc(available),
    heldUsdc: formatMicroToUsdc(held),
  };
}

function validateProfileHints(
  org: OrgRow,
  profile: Record<string, unknown>,
): string | null {
  if (profile.groupId !== undefined) {
    if (typeof profile.groupId !== "string") return "groupId must be a string";
    if (profile.groupId) {
      const g = store.getAgentGroup(profile.groupId);
      if (!g || g.orgId !== org.id || g.status !== "active") {
        return "groupId does not match an active org group";
      }
    }
  }
  if (profile.ownerGuardianId !== undefined) {
    if (typeof profile.ownerGuardianId !== "string") return "ownerGuardianId must be a string";
    if (profile.ownerGuardianId && profile.ownerGuardianId !== "owner") {
      const g = store.listGuardians(org.id).find((x) => x.id === profile.ownerGuardianId);
      if (!g || g.revokedAt) return "ownerGuardianId does not match a guardian";
    }
  }
  if (profile.tags !== undefined && !Array.isArray(profile.tags)) {
    return "tags must be an array";
  }
  return null;
}

export function registerAgentRoutes(
  app: express.Express,
  deps: { guardianRoute: GuardianRoute },
): void {
  const { guardianRoute } = deps;

  /** Roster — dedicated list (also embedded in GET /org). */
  app.get(
    "/v1/guardian/agents",
    guardianRoute((org, _req, res) => {
      const groups = new Map(store.listAgentGroups(org.id).map((g) => [g.id, g.name]));
      res.json({
        agents: store.listAgents(org.id).map((a) => {
          const groupIds = store.listAgentGroupIds(a.id);
          const groupNames = groupIds
            .map((gid) => groups.get(gid))
            .filter((n): n is string => Boolean(n));
          return {
            ...identityOf(a),
            ...balOf(org.id, a.id),
            spent24hUsdc: formatMicroToUsdc(store.spentLast24h(a.id)),
            groupIds,
            groupNames,
            /** @deprecated use groupNames — first label for older clients */
            groupName: groupNames[0],
          };
        }),
      });
    }),
  );

  /** Create agent — API key returned exactly once. */
  app.post(
    "/v1/guardian/agents",
    guardianRoute((org, req, res) => {
      const body = z
        .object({
          name: z.string().min(1).max(80),
          profile: z.record(z.unknown()).optional(),
        })
        .parse(req.body);
      if (body.profile) {
        const err = validateProfileHints(org, body.profile);
        if (err) {
          return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: err } });
        }
      }
      const { agentId, apiKey } = store.createAgent(org.id, body.name);
      if (body.profile) store.setAgentProfile(agentId, body.profile);
      const agent = store.getAgent(agentId)!;
      recordObs({ name: "agent.created", orgId: org.id, agentId });
      res.status(201).json({
        agentId,
        apiKey,
        identity: identityOf(agent),
        note: "Store this API key now — it is not shown again. Use as Bearer token for /v1/agent routes.",
      });
    }, { ownerOnly: true }),
  );

  /** Agent detail — identity, balances, recent activity / runs. */
  app.get(
    "/v1/guardian/agents/:id",
    guardianRoute((org, req, res) => {
      const agent = store.getAgent(req.params.id);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
      }
      const burn = burnForecast(org.id).perAgent.find((p) => p.agentId === agent.id);
      res.json({
        identity: identityOf(agent),
        ...balOf(org.id, agent.id),
        spent24hUsdc: formatMicroToUsdc(store.spentLast24h(agent.id)),
        burn,
        recentDecisions: store.listDecisionsForAgent(org.id, agent.id, 25),
        recentRuns: store.listRunsForAgent(org.id, agent.id, 10).map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          agentId: r.agentId,
          costUsdc: formatMicroToUsdc(r.costMicro),
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
        })),
        sessionKeys: store.listSessionKeys(org.id, agent.id),
      });
    }),
  );

  /** Rename + optional profile merge. */
  app.patch(
    "/v1/guardian/agents/:id",
    guardianRoute((org, req, res) => {
      const agent = store.getAgent(req.params.id);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
      }
      const body = z
        .object({
          name: z.string().min(1).max(80).optional(),
          profile: z.record(z.unknown()).optional(),
        })
        .parse(req.body);
      if (body.name) store.renameAgent(agent.id, body.name);
      let profile = agent.profile;
      if (body.profile) {
        const err = validateProfileHints(org, body.profile);
        if (err) {
          return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: err } });
        }
        profile = { ...agent.profile, ...body.profile };
        store.setAgentProfile(agent.id, profile);
      }
      const next = store.getAgent(agent.id)!;
      res.json({ identity: identityOf(next) });
    }, { ownerOnly: true }),
  );

  /** Patch extensible agent profile (groups, ownership, tags). */
  app.patch(
    "/v1/guardian/agents/:id/profile",
    guardianRoute((org, req, res) => {
      const agent = store.getAgent(req.params.id);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
      }
      const body = z.object({ profile: z.record(z.unknown()) }).parse(req.body);
      const err = validateProfileHints(org, body.profile);
      if (err) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: err } });
      }
      const next = { ...agent.profile, ...body.profile };
      store.setAgentProfile(agent.id, next);
      res.json({
        agentId: agent.id,
        profile: next,
        identity: identityOf({ ...agent, profile: next }),
      });
    }, { ownerOnly: true }),
  );

  /** Soft-delete — archived agents cannot spend (treated as frozen). */
  app.post(
    "/v1/guardian/agents/:id/archive",
    guardianRoute((org, req, res) => {
      const agent = store.getAgent(req.params.id);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
      }
      store.setAgentStatus(agent.id, "archived");
      store.addFreeze(org.id, agent.id, "archived");
      store.revokeAgentKey(agent.id);
      emitEvent(org.id, "agent.frozen", { agentId: agent.id, reason: "archived" });
      res.json({ ok: true, identity: identityOf(store.getAgent(agent.id)!) });
    }, { ownerOnly: true }),
  );

  app.post(
    "/v1/guardian/agents/:id/unarchive",
    guardianRoute((org, req, res) => {
      const agent = store.getAgent(req.params.id);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
      }
      if (agent.status !== "archived") {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "Agent is not archived" },
        });
      }
      store.setAgentStatus(agent.id, "active");
      const apiKey = store.rotateAgentKey(agent.id);
      res.json({
        ok: true,
        apiKey,
        identity: identityOf(store.getAgent(agent.id)!),
        note: "Agent restored active with a fresh API key — store it now.",
      });
    }, { ownerOnly: true }),
  );

  /** Rotate API key — old key dies immediately. */
  app.post(
    "/v1/guardian/agents/:id/rotate-key",
    guardianRoute((org, req, res) => {
      const agent = store.getAgent(req.params.id);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
      }
      if (agent.status === "archived") {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "Unarchive before rotating keys" },
        });
      }
      const apiKey = store.rotateAgentKey(agent.id);
      store.addFreeze(org.id, agent.id, "key rotated");
      res.json({
        agentId: agent.id,
        apiKey,
        note: "Old key is dead. Update the agent's environment now — it cannot spend until you do.",
      });
    }, { ownerOnly: true }),
  );

  /** Revoke long-lived key without replacement + kill session keys. */
  app.post(
    "/v1/guardian/agents/:id/revoke-key",
    guardianRoute((org, req, res) => {
      const agent = store.getAgent(req.params.id);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
      }
      store.revokeAgentKey(agent.id);
      const sessionsRevoked = store.revokeAllSessionKeys(agent.id);
      store.addFreeze(org.id, agent.id, "key revoked");
      emitEvent(org.id, "agent.frozen", { agentId: agent.id, reason: "key_revoked" });
      res.json({
        ok: true,
        agentId: agent.id,
        sessionsRevoked,
        note: "API key and session keys are dead. Rotate or issue a session key to restore access.",
      });
    }, { ownerOnly: true }),
  );

  /** Per-agent analytics rollup. */
  app.get(
    "/v1/guardian/agents/:id/analytics",
    guardianRoute((org, req, res) => {
      const agent = store.getAgent(req.params.id);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
      }
      const decisions = store.listDecisionsForAgent(org.id, agent.id, 500);
      const allow = decisions.filter((d) => d.outcome === "allow");
      const deny = decisions.filter((d) => d.outcome === "deny");
      const review = decisions.filter((d) => d.outcome === "review");
      const spent = allow.reduce((s, d) => {
        try {
          return s + parseUsdcToMicro(d.amountUsdc);
        } catch {
          return s;
        }
      }, 0n);
      const burn = burnForecast(org.id).perAgent.find((p) => p.agentId === agent.id);
      res.json({
        agentId: agent.id,
        name: agent.name,
        ...balOf(org.id, agent.id),
        spent24hUsdc: formatMicroToUsdc(store.spentLast24h(agent.id)),
        lifetimeSettledUsdc: formatMicroToUsdc(spent),
        decisions: {
          total: decisions.length,
          allow: allow.length,
          deny: deny.length,
          review: review.length,
        },
        burn: burn ?? null,
        runs: store.listRunsForAgent(org.id, agent.id, 20).length,
      });
    }),
  );

  // ---------------------------------------------------------------- groups
  app.get(
    "/v1/guardian/agent-groups",
    guardianRoute((org, _req, res) => {
      const agentsById = new Map(store.listAgents(org.id).map((a) => [a.id, a]));
      res.json({
        groups: store.listAgentGroups(org.id).map((g) => {
          const memberIds = store.listGroupMemberIds(g.id);
          const members = memberIds
            .map((mid) => agentsById.get(mid))
            .filter((a): a is NonNullable<typeof a> => Boolean(a))
            .map((a) => ({ id: a.id, name: a.name, status: a.status }));
          return {
            ...g,
            memberCount: members.length,
            members,
          };
        }),
      });
    }),
  );

  app.post(
    "/v1/guardian/agent-groups",
    guardianRoute((org, req, res) => {
      const body = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
      const group = store.createAgentGroup(org.id, body.name);
      res.status(201).json({ group });
    }, { ownerOnly: true }),
  );

  app.post(
    "/v1/guardian/agent-groups/:id/archive",
    guardianRoute((org, req, res) => {
      const group = store.getAgentGroup(req.params.id);
      if (!group || group.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "group" } });
      }
      store.setAgentGroupStatus(group.id, "archived");
      store.clearGroupMembers(group.id);
      res.json({ ok: true, group: { ...group, status: "archived" as const } });
    }, { ownerOnly: true }),
  );

  app.post(
    "/v1/guardian/agent-groups/:id/assign",
    guardianRoute((org, req, res) => {
      const group = store.getAgentGroup(req.params.id);
      if (!group || group.orgId !== org.id || group.status !== "active") {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "group" } });
      }
      const body = z.object({ agentIds: z.array(z.string()).min(1) }).parse(req.body);
      const assigned: string[] = [];
      for (const agentId of body.agentIds) {
        const agent = store.getAgent(agentId);
        if (!agent || agent.orgId !== org.id) continue;
        store.addAgentToGroup(org.id, agent.id, group.id);
        assigned.push(agent.id);
      }
      res.json({ ok: true, groupId: group.id, assigned });
    }, { ownerOnly: true }),
  );

  app.post(
    "/v1/guardian/agent-groups/:id/unassign",
    guardianRoute((org, req, res) => {
      const group = store.getAgentGroup(req.params.id);
      if (!group || group.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "group" } });
      }
      const body = z.object({ agentIds: z.array(z.string()).min(1) }).parse(req.body);
      const removed: string[] = [];
      for (const agentId of body.agentIds) {
        const agent = store.getAgent(agentId);
        if (!agent || agent.orgId !== org.id) continue;
        store.removeAgentFromGroup(agent.id, group.id);
        removed.push(agent.id);
      }
      res.json({ ok: true, groupId: group.id, removed });
    }, { ownerOnly: true }),
  );

  /** Freeze every active member of a group (desk kill-switch). */
  app.post(
    "/v1/guardian/agent-groups/:id/freeze",
    guardianRoute((org, req, res) => {
      const group = store.getAgentGroup(req.params.id);
      if (!group || group.orgId !== org.id || group.status !== "active") {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "group" } });
      }
      const body = z.object({ reason: z.string().default("group_freeze") }).parse(req.body ?? {});
      const memberIds = new Set(store.listGroupMemberIds(group.id));
      const members = store
        .listAgents(org.id)
        .filter((a) => memberIds.has(a.id) && a.status === "active");
      for (const agent of members) {
        store.setAgentStatus(agent.id, "frozen");
        store.addFreeze(org.id, agent.id, `group:${group.id}:${body.reason}`);
        emitEvent(org.id, "agent.frozen", { agentId: agent.id, reason: body.reason, groupId: group.id });
      }
      res.json({ ok: true, frozen: members.map((m) => m.id), groupId: group.id });
    }, { ownerOnly: true }),
  );

  /** Unfreeze every frozen member of a group. */
  app.post(
    "/v1/guardian/agent-groups/:id/unfreeze",
    guardianRoute((org, req, res) => {
      const group = store.getAgentGroup(req.params.id);
      if (!group || group.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "group" } });
      }
      const memberIds = new Set(store.listGroupMemberIds(group.id));
      const members = store
        .listAgents(org.id)
        .filter((a) => memberIds.has(a.id) && a.status === "frozen");
      for (const agent of members) {
        store.setAgentStatus(agent.id, "active");
        emitEvent(org.id, "agent.unfrozen", { agentId: agent.id, groupId: group.id });
      }
      res.json({ ok: true, unfrozen: members.map((m) => m.id), groupId: group.id });
    }, { ownerOnly: true }),
  );

  /** Split an equal stipend across group members from org vault or a budget. */
  app.post(
    "/v1/guardian/agent-groups/:id/fund",
    guardianRoute((org, req, res) => {
      const group = store.getAgentGroup(req.params.id);
      if (!group || group.orgId !== org.id || group.status !== "active") {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "group" } });
      }
      const body = z
        .object({
          amountUsdcEach: z.string(),
          fromScope: z.enum(["org", "department"]).default("org"),
          fromId: z.string().optional(),
        })
        .parse(req.body);
      const each = parseUsdcToMicro(body.amountUsdcEach);
      if (each <= 0n) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "amount must be positive" } });
      }
      const memberIds = new Set(store.listGroupMemberIds(group.id));
      const members = store
        .listAgents(org.id)
        .filter((a) => memberIds.has(a.id) && a.status !== "archived");
      if (!members.length) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "group has no members" } });
      }
      const total = each * BigInt(members.length);

      let fromAvailableId: string;
      let sourceLabel: string;
      if (body.fromScope === "department") {
        if (!body.fromId) {
          return res.status(400).json({
            error: { code: "VALIDATION_ERROR", message: "fromId (budget id) is required when fromScope is department" },
          });
        }
        const dept = store.getDepartment(body.fromId);
        if (!dept || dept.orgId !== org.id) {
          return res.status(404).json({ error: { code: "NOT_FOUND", message: "budget" } });
        }
        fromAvailableId = accountId("department", dept.id);
        sourceLabel = `${dept.name} budget`;
      } else {
        fromAvailableId = accountId("org", org.id);
        sourceLabel = "org vault";
      }

      const sourceAvail = store.getAccountMap(org.id).get(fromAvailableId)?.balanceMicro ?? 0n;
      if (total > sourceAvail) {
        return res.status(400).json({
          error: {
            code: "INSUFFICIENT_STIPEND",
            message: `Need $${formatMicroToUsdc(total)} total ($${formatMicroToUsdc(each)} × ${members.length} agents) from ${sourceLabel}; ${sourceLabel} has $${formatMicroToUsdc(sourceAvail)}`,
          },
        });
      }
      const funded: string[] = [];
      for (const agent of members) {
        store.applyEntries(org.id, [
          transferAvailable({
            orgId: org.id,
            journalId: id("j"),
            fromAvailableId,
            toAvailableId: accountId("agent", agent.id),
            amountMicro: each,
            memo: `group_fund:${group.id}:${body.fromScope}`,
          }),
        ]);
        funded.push(agent.id);
      }
      res.json({
        ok: true,
        groupId: group.id,
        funded,
        amountUsdcEach: body.amountUsdcEach,
        totalUsdc: formatMicroToUsdc(total),
        fromScope: body.fromScope,
        fromId: body.fromId ?? org.id,
        sourceLabel,
      });
    }, { ownerOnly: true }),
  );

  /** Configure proactive top-up when member stipends fall below a threshold. */
  app.patch(
    "/v1/guardian/agent-groups/:id/auto-fund",
    guardianRoute((org, req, res) => {
      const group = store.getAgentGroup(req.params.id);
      if (!group || group.orgId !== org.id || group.status !== "active") {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "group" } });
      }
      const body = z
        .object({
          enabled: z.boolean(),
          thresholdUsdc: z.string().default("5"),
          topUpUsdc: z.string().default("25"),
          minIntervalMinutes: z.number().int().min(5).max(7 * 24 * 60).default(60),
        })
        .parse(req.body);
      if (body.enabled && !group.budgetId) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message:
              "Link this ops label to a Treasury budget before enabling auto-fund (create the budget first).",
          },
        });
      }
      const topUp = parseUsdcToMicro(body.topUpUsdc);
      if (body.enabled && topUp <= 0n) {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "topUpUsdc must be positive" },
        });
      }
      const config = {
        enabled: body.enabled,
        thresholdUsdc: body.thresholdUsdc,
        topUpUsdc: body.topUpUsdc,
        minIntervalMinutes: body.minIntervalMinutes,
      };
      store.setAgentGroupAutoFund(group.id, config);
      res.json({ ok: true, groupId: group.id, autoFund: config });
    }, { ownerOnly: true }),
  );

  app.get(
    "/v1/guardian/auto-fund/runs",
    guardianRoute((org, req, res) => {
      const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 40;
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 40;
      res.json({ runs: store.listAutoFundRuns(org.id, limit) });
    }),
  );

  // ----------------------------------------------------------- session keys
  app.get(
    "/v1/guardian/session-keys",
    guardianRoute((org, req, res) => {
      const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
      res.json({ sessionKeys: store.listSessionKeys(org.id, agentId) });
    }),
  );

  app.post(
    "/v1/guardian/agents/:id/session-keys",
    guardianRoute((org, req, res) => {
      const agent = store.getAgent(req.params.id);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
      }
      if (agent.status !== "active") {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "Only active agents can mint session keys" },
        });
      }
      const body = z
        .object({
          label: z.string().max(80).optional(),
          scopes: z.array(z.enum(["read", "pay", "escrow", "admin"])).optional(),
          ttlHours: z.number().int().min(1).max(24 * 30).optional(),
        })
        .parse(req.body ?? {});
      const session = store.createSessionKey({
        orgId: org.id,
        agentId: agent.id,
        label: body.label,
        scopes: body.scopes,
        ttlHours: body.ttlHours,
      });
      res.status(201).json({
        sessionKey: session,
        note: "Session token shown once. Prefer Bearer pv_sess_… for short-lived agent runs.",
      });
    }, { ownerOnly: true }),
  );

  app.post(
    "/v1/guardian/session-keys/:id/revoke",
    guardianRoute((org, req, res) => {
      const ok = store.revokeSessionKey(org.id, req.params.id);
      if (!ok) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "session key" } });
      }
      res.json({ ok: true });
    }, { ownerOnly: true }),
  );

  // ----------------------------------------------------------- freeze log
  app.get(
    "/v1/guardian/freezes",
    guardianRoute((org, _req, res) => {
      const names = new Map(store.listAgents(org.id).map((a) => [a.id, a.name]));
      res.json({
        freezes: store.listFreezes(org.id).map((f) => ({
          ...f,
          agentName: f.agentId ? names.get(f.agentId) : undefined,
          scope: f.agentId ? "agent" : "org",
        })),
      });
    }),
  );

  // Freeze / unfreeze stay callable here too (also on index for org kill-switch).
  app.post(
    "/v1/guardian/agents/:id/freeze",
    guardianRoute((org, req, res) => {
      const agent = store.getAgent(req.params.id);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND" } });
      }
      const body = z.object({ reason: z.string().default("manual") }).parse(req.body ?? {});
      store.setAgentStatus(agent.id, "frozen");
      store.addFreeze(org.id, agent.id, body.reason);
      emitEvent(org.id, "agent.frozen", { agentId: agent.id, reason: body.reason });
      void notify({
        kind: "agent.frozen",
        orgId: org.id,
        title: "Agent frozen",
        body: `${agent.name} frozen — ${body.reason}`,
        meta: { agentId: agent.id },
      });
      recordObs({ name: "freeze", orgId: org.id, agentId: agent.id, attrs: { reason: body.reason } });
      res.json({ ok: true, identity: identityOf(store.getAgent(agent.id)!) });
    }, { ownerOnly: true }),
  );

  app.post(
    "/v1/guardian/agents/:id/unfreeze",
    guardianRoute((org, req, res) => {
      const agent = store.getAgent(req.params.id);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND" } });
      }
      if (agent.status === "archived") {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "Use unarchive for archived agents" },
        });
      }
      store.setAgentStatus(agent.id, "active");
      emitEvent(org.id, "agent.unfrozen", { agentId: agent.id });
      res.json({ ok: true, identity: identityOf(store.getAgent(agent.id)!) });
    }, { ownerOnly: true }),
  );
}
