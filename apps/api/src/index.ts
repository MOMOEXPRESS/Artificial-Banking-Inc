import {
  LEGAL_FOOTER,
  formatMicroToUsdc,
  parseUsdcToMicro,
} from "@policyvault/common";
import { recogniseRevenue } from "@policyvault/ledger";
import { evaluatePolicy } from "@policyvault/policy";
import cors from "cors";
import express from "express";
import { z } from "zod";
import {
  APPROVAL_TTL_MINUTES,
  executeIntent,
  id,
  recordDecision,
  resolveApproval,
  rulesFor,
  scopedIdempotencyKey,
  settleEscrow,
  sweepApprovalExpiry,
  sweepEscrowTimeouts,
  type ExecInput,
} from "./engine.js";
import {
  anomalies,
  burnForecast,
  jobEconomics,
  simulatePolicy,
  vendorLedger,
} from "./analytics.js";
import { answerQuestion, buildSummary } from "./insights.js";
import {
  store,
  type ApprovalRow,
  type EscrowRow,
  type InvoiceRow,
  type OrgRow,
  type RunRow,
} from "./store.js";
import { startTelegramPolling, telegramEnabled, registerTelegramNotifier } from "./telegram.js";
import { notify, registerInAppNotifier } from "./platform/notifier.js";
import { emitEvent } from "./webhooks.js";
import { openApiDocument } from "./platform/openapi.js";
import { webhookUrlProblem } from "./webhook-url.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT ?? 8787);
const STARTED_AT = Date.now();

registerInAppNotifier();
registerTelegramNotifier();

// ---------------------------------------------------------------------------
// Rate limiting: sliding window per bearer key (falls back to IP).
// Generous dev default — this is abuse protection, not throttling.
// ---------------------------------------------------------------------------
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN ?? 5000);
const rateWindows = new Map<string, number[]>();
app.use((req, res, next) => {
  if (req.path === "/health") return next();
  const key = req.header("authorization") ?? req.ip ?? "anon";
  const now = Date.now();
  const hits = (rateWindows.get(key) ?? []).filter((t) => t > now - 60_000);
  hits.push(now);
  rateWindows.set(key, hits);
  if (hits.length > RATE_LIMIT_PER_MIN) {
    return res.status(429).json({
      error: { code: "RATE_LIMITED", message: `Over ${RATE_LIMIT_PER_MIN} requests/minute` },
    });
  }
  next();
});
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [key, hits] of rateWindows) {
    const alive = hits.filter((t) => t > cutoff);
    if (alive.length === 0) rateWindows.delete(key);
    else rateWindows.set(key, alive);
  }
}, 30_000).unref();

function bearer(req: express.Request): string | null {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

function authAgent(req: express.Request): { orgId: string; agentId: string } | null {
  const key = bearer(req);
  if (!key || !key.startsWith("pv_agent_")) return null;
  const agent = store.getAgentByKey(key);
  if (!agent) return null;
  // Frozen agents/orgs still authenticate: their intents hit the policy engine
  // and produce an explainable agent_frozen/org_frozen deny in the trace.
  return { orgId: agent.orgId, agentId: agent.id };
}

/** Guardian auth: org is derived from the pv_guardian_ key, never from the body. */
type GuardianRole = "owner" | "approver" | "viewer";
type GuardianCtx = { org: OrgRow; role: GuardianRole; guardianId: string };

function authGuardianCtx(req: express.Request): GuardianCtx | null {
  const key = bearer(req);
  if (!key || !key.startsWith("pv_guardian_")) return null;
  const founder = store.findOrgByGuardianKey(key);
  if (founder) return { org: founder, role: "owner", guardianId: "owner" };
  const invited = store.findGuardianByKey(key);
  if (!invited || invited.revokedAt) return null;
  if (invited.role === "viewer") return null;
  const org = store.getOrg(invited.orgId);
  if (!org) return null;
  return { org, role: invited.role, guardianId: invited.id };
}

/** Identity of the acting guardian, for vote attribution under quorum. */
function guardianIdentity(req: express.Request): string {
  return authGuardianCtx(req)?.guardianId ?? "owner";
}

function guardianRoute(
  handler: (org: OrgRow, req: express.Request, res: express.Response) => unknown,
  opts?: { ownerOnly?: boolean },
): express.RequestHandler {
  return (req, res) => {
    const ctx = authGuardianCtx(req);
    if (!ctx) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    if (opts?.ownerOnly && ctx.role !== "owner") {
      return res.status(403).json({
        error: {
          code: "UNAUTHORIZED",
          message: "This action requires an owner guardian key",
        },
      });
    }
    Promise.resolve(handler(ctx.org, req, res)).catch((e) => {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: e.message } });
      }
      if (isInvalidUsdcAmount(e)) {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "Invalid USDC amount" },
        });
      }
      console.error("guardian route error:", e);
      res.status(500).json({ error: { code: "RAIL_FAILED", message: String(e) } });
    });
  };
}

/** Wrap an async route handler so rejections become clean HTTP errors. */
function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<unknown>,
): express.RequestHandler {
  return (req, res) => {
    fn(req, res).catch((e) => {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: e.message } });
      }
      if (isInvalidUsdcAmount(e)) {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "Invalid USDC amount" },
        });
      }
      console.error("route error:", e);
      res.status(500).json({ error: { code: "RAIL_FAILED", message: String(e) } });
    });
  };
}

function isInvalidUsdcAmount(e: unknown): boolean {
  return e instanceof Error && e.message === "INVALID_USDC_AMOUNT";
}

function approvalView(a: ApprovalRow) {
  const { amountMicro: _m, ...rest } = a;
  return rest;
}

function escrowView(e: EscrowRow) {
  const { amountMicro, ...rest } = e;
  return { ...rest, amountUsdc: formatMicroToUsdc(amountMicro) };
}

/** Policy-gated agent intent entrypoint. */
async function handleIntent(
  res: express.Response,
  input: Omit<ExecInput, "intentId"> & { idempotencyKey: string },
) {
  const idemKey = scopedIdempotencyKey(input.agentId, input.idempotencyKey);
  // Claim the key first. Anything already recorded — settled, denied, parked
  // or in flight — replays instead of executing a second time.
  if (!store.reserveIdempotent(input.orgId, idemKey)) {
    const existing = store.getIdempotent(input.orgId, idemKey) as
      | { status?: string; httpStatus?: number }
      | undefined;
    if (existing?.status === "in_flight") {
      return res.status(409).json({
        error: {
          code: "IDEMPOTENCY_REPLAY",
          message: "An identical request is still in flight — poll rather than retry.",
        },
      });
    }
    // Replay the original status: a denial must not come back as HTTP 200.
    const { httpStatus, ...payload } = (existing ?? {}) as Record<string, unknown> & {
      httpStatus?: number;
    };
    return res.status(typeof httpStatus === "number" ? httpStatus : 200).json({
      ...payload,
      replayed: true,
    });
  }

  const decision = evaluatePolicy(
    {
      agentId: input.agentId,
      orgId: input.orgId,
      tool: input.tool,
      amountMicro: input.amountMicro,
      destination: input.destination,
      jobId: input.jobId,
      idempotencyKey: input.idempotencyKey,
      memo: input.memo,
    },
    rulesFor(input.agentId, input.orgId),
    store.getPolicyVersion(input.orgId),
  );
  const intentId = id("int");
  recordDecision({
    intentId,
    orgId: input.orgId,
    agentId: input.agentId,
    outcome: decision.outcome,
    ruleIds: decision.ruleIds,
    reasons: decision.reasons,
    tool: input.tool,
    amountUsdc: input.amountUsdc,
    destination: input.destination,
  });

  if (decision.outcome === "deny") {
    const payload = {
      intentId,
      outcome: "deny" as const,
      error: { code: "POLICY_DENIED" as const, message: decision.reasons.join("; ") },
      ruleIds: decision.ruleIds,
    };
    store.setIdempotent(input.orgId, idemKey, { ...payload, httpStatus: 403 });
    emitEvent(input.orgId, "policy.denied", {
      intentId,
      agentId: input.agentId,
      tool: input.tool,
      amountUsdc: input.amountUsdc,
      destination: input.destination,
      ruleIds: decision.ruleIds,
      reasons: decision.reasons,
    });
    return res.status(403).json(payload);
  }

  if (decision.outcome === "review") {
    const approval: ApprovalRow = {
      id: id("apr"),
      orgId: input.orgId,
      agentId: input.agentId,
      intentId,
      tool: input.tool,
      amountMicro: input.amountMicro,
      amountUsdc: input.amountUsdc,
      destination: input.destination,
      jobId: input.jobId,
      memo: input.memo,
      idempotencyKey: input.idempotencyKey,
      payeeAgentId: input.payeeAgentId,
      timeoutMinutes: input.timeoutMinutes,
      ruleIds: decision.ruleIds,
      reasons: decision.reasons,
      status: "pending",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MINUTES * 60_000).toISOString(),
    };
    store.createApproval(approval);
    // Persist the parked result under the key so a retry replays the SAME
    // approval instead of parking a second one that could also be approved.
    const reviewPayload = {
      intentId,
      outcome: "review" as const,
      approvalId: approval.id,
      expiresAt: approval.expiresAt,
      error: { code: "NEEDS_APPROVAL" as const, message: decision.reasons.join("; ") },
      ruleIds: decision.ruleIds,
      hint: "Poll GET /v1/agent/approvals/:id until approved/denied/expired.",
      httpStatus: 202,
    };
    store.setIdempotent(input.orgId, idemKey, reviewPayload);
    void notify({ kind: "approval.pending", approval });
    emitEvent(input.orgId, "approval.pending", {
      approvalId: approval.id,
      intentId,
      agentId: input.agentId,
      tool: input.tool,
      amountUsdc: input.amountUsdc,
      destination: input.destination,
      reasons: decision.reasons,
      expiresAt: approval.expiresAt,
    });
    return res.status(202).json({
      intentId,
      outcome: "review" as const,
      approvalId: approval.id,
      expiresAt: approval.expiresAt,
      error: { code: "NEEDS_APPROVAL" as const, message: decision.reasons.join("; ") },
      ruleIds: decision.ruleIds,
      hint: "Poll GET /v1/agent/approvals/:id until approved/denied/expired.",
    });
  }

  const result = await executeIntent({ ...input, intentId });
  if (result.ok) {
    store.setIdempotent(input.orgId, idemKey, { ...result.payload, httpStatus: 200 });
    return res.json(result.payload);
  }
  // A rail failure is transient — free the key so the caller may genuinely retry.
  store.releaseIdempotent(input.orgId, idemKey);
  return res.status(result.status).json(result.payload);
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "abi-api",
    uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
    legal: LEGAL_FOOTER,
    telegram: telegramEnabled,
  });
});

app.get("/v1/openapi.json", (_req, res) => {
  res.json(openApiDocument(`http://localhost:${PORT}`));
});

/**
 * Bootstrap demo org — DESTRUCTIVE: wipes every org in the database.
 * Disabled unless explicitly enabled, so a deployed instance cannot have its
 * ledger erased by an unauthenticated POST.
 */
const ALLOW_BOOTSTRAP =
  process.env.POLICYVAULT_ALLOW_BOOTSTRAP === "1" ||
  (process.env.NODE_ENV !== "production" && process.env.POLICYVAULT_ALLOW_BOOTSTRAP !== "0");

app.post("/v1/demo/bootstrap", (_req, res) => {
  if (!ALLOW_BOOTSTRAP) {
    return res.status(403).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Demo bootstrap is disabled. Set POLICYVAULT_ALLOW_BOOTSTRAP=1 to enable.",
      },
    });
  }
  const demo = store.bootstrapDemo();
  res.json({
    ...demo,
    legal: LEGAL_FOOTER,
    note: "Dev bootstrap. agentApiKey = agent Bearer token; guardianKey = guardian Bearer token.",
  });
});

// ---------------------------------------------------------------------------
// Guardian routes (Bearer pv_guardian_... — org derived from the key)
// ---------------------------------------------------------------------------

/** Create a real org with a mock USDC deposit (on-chain deposit is a later phase). */
const ALLOW_PUBLIC_ORG_CREATE =
  process.env.POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE === "1" ||
  (process.env.NODE_ENV !== "production" && process.env.POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE !== "0");

app.post("/v1/guardian/orgs", (req, res) => {
  if (!ALLOW_PUBLIC_ORG_CREATE) {
    return res.status(403).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Public org creation disabled — set POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE=1",
      },
    });
  }
  const body = z
    .object({
      name: z.string().min(1).max(80),
      depositUsdc: z.string().default("100"),
    })
    .parse(req.body);
  const org = store.createOrg(body.name, parseUsdcToMicro(body.depositUsdc));
  res.status(201).json({
    orgId: org.id,
    name: org.name,
    guardianKey: org.guardianKey,
    vaultAddress: store.getVaultAddress(org.id),
    depositUsdc: body.depositUsdc,
    note: "Store guardianKey now — it authenticates all /v1/guardian routes for this org.",
    legal: LEGAL_FOOTER,
  });
});

/** Create an agent in the org. The API key is returned exactly once — store it. */
app.post(
  "/v1/guardian/agents",
  guardianRoute((org, req, res) => {
    const body = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
    const { agentId, apiKey } = store.createAgent(org.id, body.name);
    res.status(201).json({
      agentId,
      apiKey,
      note: "Store this API key now — it is not shown again. Use as Bearer token for /v1/agent routes.",
    });
  }, { ownerOnly: true }),
);

app.get(
  "/v1/guardian/org",
  guardianRoute((org, _req, res) => {
    const accounts = [...store.getAccountMap(org.id).values()];
    const agents = store.listAgents(org.id);
    const template = store.getPolicyTemplate(org.id);
    res.json({
      org: { id: org.id, name: org.name, status: org.status },
      agents: agents.map(({ apiKey: _, ...rest }) => ({
        ...rest,
        spent24hUsdc: formatMicroToUsdc(store.spentLast24h(rest.id)),
      })),
      dailyMaxUsdc: formatMicroToUsdc(template.dailyMaxMicro),
      balances: accounts.map((a) => ({
        id: a.id,
        kind: a.kind,
        agentId: a.agentId,
        usdc: formatMicroToUsdc(a.balanceMicro),
      })),
      vaultAddress: store.getVaultAddress(org.id),
      legal: LEGAL_FOOTER,
    });
  }),
);

// --------------------------------------------------------- subscriptions

function subView(s: ReturnType<typeof store.listSubscriptions>[number]) {
  const { amountMicro, spentMicro, maxTotalMicro, ...rest } = s;
  return {
    ...rest,
    amountUsdc: formatMicroToUsdc(amountMicro),
    spentUsdc: formatMicroToUsdc(spentMicro),
    maxTotalUsdc: maxTotalMicro ? formatMicroToUsdc(maxTotalMicro) : null,
  };
}

app.get(
  "/v1/guardian/subscriptions",
  guardianRoute((org, _req, res) => {
    res.json({ subscriptions: store.listSubscriptions(org.id).map(subView) });
  }),
);

/** Recurring agent spend — each run still passes the full policy engine. */
app.post(
  "/v1/guardian/subscriptions",
  guardianRoute((org, req, res) => {
    const body = z
      .object({
        agentId: z.string(),
        vendor: z.string().min(1),
        amountUsdc: z.string(),
        intervalHours: z.number().int().min(1).max(24 * 90),
        maxTotalUsdc: z.string().optional(),
        memo: z.string().max(200).optional(),
        startNow: z.boolean().default(false),
      })
      .parse(req.body);
    const agent = store.getAgent(body.agentId);
    if (!agent || agent.orgId !== org.id) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
    }
    const sub = {
      id: id("sub"),
      orgId: org.id,
      agentId: body.agentId,
      vendor: body.vendor,
      amountMicro: parseUsdcToMicro(body.amountUsdc),
      intervalHours: body.intervalHours,
      status: "active" as const,
      createdAt: new Date().toISOString(),
      nextRunAt: new Date(
        Date.now() + (body.startNow ? 0 : body.intervalHours * 3600_000),
      ).toISOString(),
      runs: 0,
      spentMicro: 0n,
      maxTotalMicro: body.maxTotalUsdc ? parseUsdcToMicro(body.maxTotalUsdc) : undefined,
      memo: body.memo,
    };
    store.createSubscription(sub);
    res.status(201).json({ subscription: subView(sub) });
  }, { ownerOnly: true }),
);

app.post(
  "/v1/guardian/subscriptions/:id/:action",
  guardianRoute((org, req, res) => {
    const action = req.params.action;
    if (!["pause", "resume", "cancel"].includes(action)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "bad action" } });
    }
    const sub = store.getSubscription(req.params.id, org.id);
    if (!sub) return res.status(404).json({ error: { code: "NOT_FOUND" } });
    store.setSubscriptionStatus(
      sub.id,
      action === "pause" ? "paused" : action === "resume" ? "active" : "cancelled",
    );
    res.json({ ok: true, status: action === "pause" ? "paused" : action === "resume" ? "active" : "cancelled" });
  }, { ownerOnly: true }),
);

// ------------------------------------------------------------- guardians

app.get(
  "/v1/guardian/guardians",
  guardianRoute((org, _req, res) => {
    res.json({
      guardians: store
        .listGuardians(org.id)
        .map(({ guardianKey: _k, ...rest }) => ({ ...rest, guardianKey: "pv_guardian_***" })),
      quorum: store.getPolicyTemplate(org.id).approvalQuorum ?? 1,
    });
  }),
);

/** Invite a second decision-maker. Their key is shown once. */
app.post(
  "/v1/guardian/guardians",
  guardianRoute((org, req, res) => {
    const body = z
      .object({
        name: z.string().min(1).max(60),
        // Inviting another owner requires a future dual-control flow — not via this route.
        role: z.enum(["approver", "viewer"]).default("approver"),
      })
      .parse(req.body);
    const g = store.createGuardian(org.id, body.name, body.role);
    res.status(201).json({
      guardian: { id: g.id, name: g.name, role: g.role },
      guardianKey: g.guardianKey,
      note: "Shown once. This key can sign in to the console for this org.",
    });
  }, { ownerOnly: true }),
);

app.delete(
  "/v1/guardian/guardians/:id",
  guardianRoute((org, req, res) => {
    if (!store.revokeGuardian(req.params.id, org.id)) {
      return res.status(404).json({ error: { code: "NOT_FOUND" } });
    }
    res.json({ ok: true });
  }, { ownerOnly: true }),
);

/** How many distinct approvals a payment needs before it executes. */
app.post(
  "/v1/guardian/quorum",
  guardianRoute((org, req, res) => {
    const body = z.object({ approvalQuorum: z.number().int().min(1).max(5) }).parse(req.body);
    const current = store.getPolicyTemplate(org.id);
    const seats = store
      .listGuardians(org.id)
      .filter((g) => !g.revokedAt && g.role !== "viewer").length + 1; // +1 founder
    if (body.approvalQuorum > seats) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: `Quorum of ${body.approvalQuorum} needs ${body.approvalQuorum} guardians; you have ${seats}. Approvals would be unresolvable.`,
        },
      });
    }
    store.setPolicyTemplate(org.id, { ...current, approvalQuorum: body.approvalQuorum });
    res.json({ ok: true, approvalQuorum: body.approvalQuorum });
  }, { ownerOnly: true }),
);

// ------------------------------------------------------------- analytics

app.get(
  "/v1/guardian/vendors",
  guardianRoute((org, _req, res) => {
    res.json(vendorLedger(org.id));
  }),
);

app.get(
  "/v1/guardian/burn",
  guardianRoute((org, _req, res) => {
    res.json({ forecast: burnForecast(org.id) });
  }),
);

app.get(
  "/v1/guardian/anomalies",
  guardianRoute((org, _req, res) => {
    res.json(anomalies(org.id));
  }),
);

app.get(
  "/v1/guardian/economics",
  guardianRoute((org, _req, res) => {
    res.json({ economics: jobEconomics(org.id) });
  }),
);

/** Replay real history against a proposed ruleset before committing to it. */
app.post(
  "/v1/guardian/policy/simulate",
  guardianRoute((org, req, res) => {
    const body = z
      .object({
        perTxMaxUsdc: z.string().optional(),
        dailyMaxUsdc: z.string().optional(),
        hitlAboveUsdc: z.string().optional(),
        maxPaysPerMinute: z.number().int().positive().optional(),
        addressAllowlist: z.array(z.string()).optional(),
        domainAllowlist: z.array(z.string()).optional(),
        vendorAllowlist: z.array(z.string()).optional(),
        blocklist: z.array(z.string()).optional(),
        windowHours: z.number().int().positive().max(24 * 90).default(24 * 7),
      })
      .parse(req.body);
    const { windowHours, ...change } = body;
    res.json({ simulation: simulatePolicy(org.id, change, windowHours) });
  }),
);

// ------------------------------------------------------- insights & Q&A

app.get(
  "/v1/guardian/summary",
  guardianRoute((org, req, res) => {
    const hours = Math.min(Number(req.query.hours ?? 24), 24 * 30);
    res.json({ summary: buildSummary(org.id, hours) });
  }),
);

app.post(
  "/v1/guardian/ask",
  guardianRoute((org, req, res) => {
    const body = z.object({ question: z.string().max(400) }).parse(req.body);
    res.json(answerQuestion(org.id, body.question));
  }),
);

/** In-app ABI Assistant — durable chat + approval cards (Telegram is optional). */
app.get(
  "/v1/guardian/chat",
  guardianRoute((org, _req, res) => {
    res.json({ messages: store.listChatMessages(org.id) });
  }),
);

app.post(
  "/v1/guardian/chat",
  guardianRoute((org, req, res) => {
    const body = z.object({ message: z.string().min(1).max(800) }).parse(req.body);
    store.appendChatMessage({
      orgId: org.id,
      role: "user",
      kind: "text",
      body: body.message,
    });
    const answer = answerQuestion(org.id, body.message);
    const reply = store.appendChatMessage({
      orgId: org.id,
      role: "assistant",
      kind: "text",
      body: answer.answer,
      meta: answer.goto ? { goto: answer.goto } : undefined,
    });
    res.json({ reply, goto: answer.goto, messages: store.listChatMessages(org.id) });
  }),
);

app.get(
  "/v1/guardian/policy/versions",
  guardianRoute((org, _req, res) => {
    res.json({
      current: store.getPolicyVersion(org.id),
      versions: store.listPolicyVersions(org.id).map(({ rules: _r, ...rest }) => rest),
    });
  }),
);

// ---------------------------------------------------------------- invoices

function invoiceView(i: InvoiceRow) {
  const { amountMicro, ...rest } = i;
  return { ...rest, amountUsdc: formatMicroToUsdc(amountMicro) };
}

app.get(
  "/v1/guardian/invoices",
  guardianRoute((org, _req, res) => {
    // Overdue marking happens in the background sweep — a GET must not write.
    const invoices = store.listInvoices(org.id);
    const paid = invoices.filter((i) => i.status === "paid");
    const open = invoices.filter((i) => i.status === "sent" || i.status === "overdue");
    const overdue = invoices.filter((i) => i.status === "overdue");
    // Payment score: on-time collection rate, penalised by overdue exposure.
    const settled = paid.length + overdue.length;
    const base = settled === 0 ? 80 : Math.round((paid.length / settled) * 100);
    const score = Math.max(0, Math.min(100, base - overdue.length * 5));
    res.json({
      invoices: invoices.map(invoiceView),
      stats: {
        paidUsdc: formatMicroToUsdc(paid.reduce((a, i) => a + i.amountMicro, 0n)),
        outstandingUsdc: formatMicroToUsdc(open.reduce((a, i) => a + i.amountMicro, 0n)),
        overdueCount: overdue.length,
        paymentScore: score,
      },
    });
  }),
);

app.post(
  "/v1/guardian/invoices",
  guardianRoute((org, req, res) => {
    const body = z
      .object({
        counterparty: z.string().min(1).max(80),
        amountUsdc: z.string(),
        dueInDays: z.number().int().min(0).max(365).default(14),
        memo: z.string().max(200).optional(),
        jobId: z.string().optional(),
        runId: z.string().optional(),
        status: z.enum(["draft", "sent"]).default("sent"),
      })
      .parse(req.body);
    const invoice = store.createInvoice({
      id: id("inv"),
      orgId: org.id,
      counterparty: body.counterparty,
      amountMicro: parseUsdcToMicro(body.amountUsdc),
      status: body.status,
      issuedAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + body.dueInDays * 864e5).toISOString(),
      memo: body.memo,
      jobId: body.jobId,
      runId: body.runId,
    });
    res.status(201).json({ invoice: invoiceView(invoice) });
  }),
);

/** Mark an invoice settled — books the cash into the treasury and the income. */
app.post(
  "/v1/guardian/invoices/:id/pay",
  guardianRoute((org, req, res) => {
    const invoice = store.getInvoice(req.params.id, org.id);
    if (!invoice) return res.status(404).json({ error: { code: "NOT_FOUND" } });
    if (invoice.status === "paid") {
      return res
        .status(409)
        .json({ error: { code: "VALIDATION_ERROR", message: "Invoice is already paid" } });
    }
    store.applyEntries(org.id, [
      recogniseRevenue({
        orgId: org.id,
        journalId: id("j"),
        revenueAccountId: `org:${org.id}:revenue`,
        orgAvailableId: `org:${org.id}:available`,
        amountMicro: invoice.amountMicro,
        memo: `invoice_paid:${invoice.number}`,
      }),
    ]);
    store.updateInvoiceStatus(invoice.id, "paid", new Date().toISOString());
    emitEvent(org.id, "payment.succeeded", {
      kind: "invoice_settled",
      invoiceId: invoice.id,
      number: invoice.number,
      counterparty: invoice.counterparty,
      amountUsdc: formatMicroToUsdc(invoice.amountMicro),
    });
    res.json({ ok: true, invoice: invoiceView(store.getInvoice(invoice.id, org.id)!) });
  }),
);

app.post(
  "/v1/guardian/invoices/:id/void",
  guardianRoute((org, req, res) => {
    const invoice = store.getInvoice(req.params.id, org.id);
    if (!invoice) return res.status(404).json({ error: { code: "NOT_FOUND" } });
    if (invoice.status === "paid") {
      return res
        .status(409)
        .json({ error: { code: "VALIDATION_ERROR", message: "Cannot void a paid invoice" } });
    }
    store.updateInvoiceStatus(invoice.id, "void");
    res.json({ ok: true });
  }),
);

// -------------------------------------------------------------------- runs

function runView(r: RunRow) {
  const { costMicro, ...rest } = r;
  return { ...rest, costUsdc: formatMicroToUsdc(costMicro) };
}

app.get(
  "/v1/guardian/runs",
  guardianRoute((org, _req, res) => {
    res.json({ runs: store.listRuns(org.id).map(runView) });
  }),
);

app.get(
  "/v1/guardian/runs/:id",
  guardianRoute((org, req, res) => {
    const run = store.getRun(req.params.id, org.id);
    if (!run) return res.status(404).json({ error: { code: "NOT_FOUND" } });
    res.json({ run: runView(run) });
  }),
);

/** Upsert a mission run record (the console streams progress here). */
app.put(
  "/v1/guardian/runs/:id",
  guardianRoute((org, req, res) => {
    const body = z
      .object({
        missionId: z.string(),
        title: z.string(),
        agentId: z.string().optional(),
        agentName: z.string().optional(),
        status: z.enum(["running", "complete", "failed", "cancelled"]),
        startedAt: z.string(),
        finishedAt: z.string().optional(),
        costUsdc: z.string().default("0"),
        steps: z
          .array(
            z.object({
              id: z.string(),
              title: z.string(),
              detail: z.string(),
              status: z.string(),
              summary: z.string().optional(),
              output: z.string().optional(),
            }),
          )
          .default([]),
        deliverableMd: z.string().optional(),
      })
      .parse(req.body);
    store.upsertRun({
      id: req.params.id,
      orgId: org.id,
      missionId: body.missionId,
      title: body.title,
      agentId: body.agentId,
      agentName: body.agentName,
      status: body.status,
      startedAt: body.startedAt,
      finishedAt: body.finishedAt,
      costMicro: parseUsdcToMicro(body.costUsdc),
      steps: body.steps,
      deliverableMd: body.deliverableMd,
    });
    res.json({ ok: true });
  }),
);

app.get(
  "/v1/guardian/journals",
  guardianRoute((org, req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    res.json({ journals: store.listJournals(org.id, limit) });
  }),
);

app.post(
  "/v1/guardian/allocate",
  guardianRoute((org, req, res) => {
    const body = z
      .object({
        agentId: z.string(),
        amountUsdc: z.string(),
      })
      .parse(req.body);
    const agent = store.getAgent(body.agentId);
    if (!agent || agent.orgId !== org.id) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
    }
    const amount = parseUsdcToMicro(body.amountUsdc);
    try {
      store.applyEntries(org.id, [
        {
          id: id("j"),
          orgId: org.id,
          memo: "allocate_stipend",
          createdAt: new Date().toISOString(),
          lines: [
            { accountId: `org:${org.id}:available`, deltaMicro: -amount },
            { accountId: `agent:${body.agentId}:available`, deltaMicro: amount },
          ],
        },
      ]);
      res.json({ ok: true, amountUsdc: body.amountUsdc });
    } catch (e) {
      res.status(400).json({ error: { code: "INSUFFICIENT_STIPEND", message: String(e) } });
    }
  }, { ownerOnly: true }),
);

/** Rotate an agent's API key. The old key stops working immediately. */
app.post(
  "/v1/guardian/agents/:id/rotate-key",
  guardianRoute((org, req, res) => {
    const agent = store.getAgent(req.params.id);
    if (!agent || agent.orgId !== org.id) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
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

/**
 * Pull a stipend back from an agent into the org treasury — the inverse of
 * allocate. Only *available* funds can be reclaimed: money already held mid-
 * payment or locked in escrow belongs to an in-flight commitment.
 */
app.post(
  "/v1/guardian/reclaim",
  guardianRoute((org, req, res) => {
    const body = z
      .object({
        agentId: z.string(),
        /** Omit to sweep the agent's entire available balance. */
        amountUsdc: z.string().optional(),
      })
      .parse(req.body);
    const agent = store.getAgent(body.agentId);
    if (!agent || agent.orgId !== org.id) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
    }
    const accounts = store.getAccountMap(org.id);
    const available = accounts.get(`agent:${body.agentId}:available`)?.balanceMicro ?? 0n;
    const held = accounts.get(`agent:${body.agentId}:held`)?.balanceMicro ?? 0n;
    const amount = body.amountUsdc ? parseUsdcToMicro(body.amountUsdc) : available;

    if (amount <= 0n) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Nothing available to reclaim" },
      });
    }
    if (amount > available) {
      return res.status(400).json({
        error: {
          code: "INSUFFICIENT_STIPEND",
          message: `Agent has ${formatMicroToUsdc(available)} available${
            held > 0n ? ` (${formatMicroToUsdc(held)} is held mid-payment and cannot be reclaimed)` : ""
          }`,
        },
      });
    }

    store.applyEntries(org.id, [
      {
        id: id("j"),
        orgId: org.id,
        memo: "reclaim_stipend",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `agent:${body.agentId}:available`, deltaMicro: -amount },
          { accountId: `org:${org.id}:available`, deltaMicro: amount },
        ],
      },
    ]);
    res.json({
      ok: true,
      amountUsdc: formatMicroToUsdc(amount),
      agentRemainingUsdc: formatMicroToUsdc(available - amount),
    });
  }, { ownerOnly: true }),
);

/**
 * Move a stipend directly between two agents — the "I funded the wrong agent"
 * fix. Routed as one balanced journal so the treasury is never touched and the
 * books cannot land half-done.
 */
app.post(
  "/v1/guardian/transfer",
  guardianRoute((org, req, res) => {
    const body = z
      .object({
        fromAgentId: z.string(),
        toAgentId: z.string(),
        amountUsdc: z.string().optional(),
      })
      .parse(req.body);
    if (body.fromAgentId === body.toAgentId) {
      return res
        .status(400)
        .json({ error: { code: "VALIDATION_ERROR", message: "Source and destination are the same agent" } });
    }
    const from = store.getAgent(body.fromAgentId);
    const to = store.getAgent(body.toAgentId);
    if (!from || from.orgId !== org.id || !to || to.orgId !== org.id) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
    }
    const accounts = store.getAccountMap(org.id);
    const available = accounts.get(`agent:${body.fromAgentId}:available`)?.balanceMicro ?? 0n;
    const held = accounts.get(`agent:${body.fromAgentId}:held`)?.balanceMicro ?? 0n;
    const amount = body.amountUsdc ? parseUsdcToMicro(body.amountUsdc) : available;

    if (amount <= 0n) {
      return res
        .status(400)
        .json({ error: { code: "VALIDATION_ERROR", message: "Nothing available to move" } });
    }
    if (amount > available) {
      return res.status(400).json({
        error: {
          code: "INSUFFICIENT_STIPEND",
          message: `${from.name} has ${formatMicroToUsdc(available)} available${
            held > 0n ? ` (${formatMicroToUsdc(held)} held mid-payment cannot be moved)` : ""
          }`,
        },
      });
    }

    store.applyEntries(org.id, [
      {
        id: id("j"),
        orgId: org.id,
        memo: "transfer_stipend",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `agent:${body.fromAgentId}:available`, deltaMicro: -amount },
          { accountId: `agent:${body.toAgentId}:available`, deltaMicro: amount },
        ],
      },
    ]);
    res.json({
      ok: true,
      amountUsdc: formatMicroToUsdc(amount),
      from: from.name,
      to: to.name,
    });
  }, { ownerOnly: true }),
);

app.post(
  "/v1/guardian/freeze",
  guardianRoute((org, req, res) => {
    const body = z
      .object({
        agentId: z.string().optional(),
        reason: z.string().default("manual"),
      })
      .parse(req.body);
    if (body.agentId) {
      const agent = store.getAgent(body.agentId);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND" } });
      }
      store.setAgentStatus(body.agentId, "frozen");
    } else {
      store.setOrgStatus(org.id, "frozen");
    }
    store.addFreeze(org.id, body.agentId, body.reason);
    res.json({ ok: true });
  }, { ownerOnly: true }),
);

app.post(
  "/v1/guardian/unfreeze",
  guardianRoute((org, req, res) => {
    const body = z.object({ agentId: z.string().optional() }).parse(req.body);
    if (body.agentId) {
      const agent = store.getAgent(body.agentId);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND" } });
      }
      store.setAgentStatus(body.agentId, "active");
    } else {
      store.setOrgStatus(org.id, "active");
    }
    res.json({ ok: true });
  }, { ownerOnly: true }),
);

app.get(
  "/v1/guardian/activity",
  guardianRoute((org, _req, res) => {
    res.json({ decisions: store.listDecisions(org.id) });
  }),
);

app.get(
  "/v1/guardian/metrics",
  guardianRoute((org, _req, res) => {
    const m = store.orgMetrics(org.id);
    res.json({
      metrics: {
        ...m,
        balancesUsdc: Object.fromEntries(
          Object.entries(m.balancesMicro).map(([k, v]) => [k, formatMicroToUsdc(BigInt(v))]),
        ),
      },
    });
  }),
);

app.get(
  "/v1/guardian/reconcile",
  guardianRoute((org, _req, res) => {
    res.json({ reconciliation: store.reconcileOrg(org.id) });
  }),
);

/** Integration/go-live status for the Settings screen. */
app.get(
  "/v1/guardian/setup",
  guardianRoute((_org, _req, res) => {
    res.json({
      setup: {
        custody: process.env.CDP_API_KEY_ID ? "cdp" : "dev-local-key",
        network: "base-sepolia",
        settlement: process.env.CDP_API_KEY_ID ? "onchain" : "mock (dev facilitator)",
        telegram: telegramEnabled,
        rateLimitPerMin: RATE_LIMIT_PER_MIN,
        approvalTtlMinutes: APPROVAL_TTL_MINUTES,
      },
    });
  }),
);

function policyView(template: ReturnType<typeof store.getPolicyTemplate>) {
  return {
    perTxMaxUsdc: formatMicroToUsdc(template.perTxMaxMicro),
    dailyMaxUsdc: formatMicroToUsdc(template.dailyMaxMicro),
    hitlAboveUsdc: formatMicroToUsdc(template.hitlAboveMicro),
    maxPaysPerMinute: template.maxPaysPerMinute,
    newCounterpartyCooldownHours: template.newCounterpartyCooldownHours,
    addressAllowlist: template.addressAllowlist,
    domainAllowlist: template.domainAllowlist,
    vendorAllowlist: template.vendorAllowlist,
    blocklist: template.blocklist,
    hitlCategories: template.hitlCategories,
    quietHours: template.quietHours ?? null,
  };
}

app.get(
  "/v1/guardian/policy",
  guardianRoute((org, _req, res) => {
    res.json({ policy: policyView(store.getPolicyTemplate(org.id)) });
  }),
);

/** Partial policy update. Amounts in USDC strings; lists replace wholesale. */
app.post(
  "/v1/guardian/policy",
  guardianRoute((org, req, res) => {
    const body = z
      .object({
        perTxMaxUsdc: z.string().optional(),
        dailyMaxUsdc: z.string().optional(),
        hitlAboveUsdc: z.string().optional(),
        maxPaysPerMinute: z.number().int().positive().optional(),
        newCounterpartyCooldownHours: z.number().int().min(0).optional(),
        addressAllowlist: z.array(z.string()).optional(),
        domainAllowlist: z.array(z.string()).optional(),
        vendorAllowlist: z.array(z.string()).optional(),
        blocklist: z.array(z.string()).optional(),
        hitlCategories: z
          .array(
            z.enum([
              "pay",
              "pay_api",
              "transfer_internal",
              "escrow_lock",
              "escrow_release",
              "escrow_refund",
              "withdraw",
            ]),
          )
          .optional(),
        quietHours: z
          .object({
            startHour: z.number().int().min(0).max(23),
            endHour: z.number().int().min(0).max(23),
            action: z.enum(["review", "deny"]),
          })
          .nullable()
          .optional(),
      })
      .parse(req.body);
    const current = store.getPolicyTemplate(org.id);
    const next = {
      ...current,
      ...(body.perTxMaxUsdc !== undefined && { perTxMaxMicro: parseUsdcToMicro(body.perTxMaxUsdc) }),
      ...(body.dailyMaxUsdc !== undefined && { dailyMaxMicro: parseUsdcToMicro(body.dailyMaxUsdc) }),
      ...(body.hitlAboveUsdc !== undefined && { hitlAboveMicro: parseUsdcToMicro(body.hitlAboveUsdc) }),
      ...(body.maxPaysPerMinute !== undefined && { maxPaysPerMinute: body.maxPaysPerMinute }),
      ...(body.newCounterpartyCooldownHours !== undefined && {
        newCounterpartyCooldownHours: body.newCounterpartyCooldownHours,
      }),
      ...(body.addressAllowlist && { addressAllowlist: body.addressAllowlist }),
      ...(body.domainAllowlist && { domainAllowlist: body.domainAllowlist }),
      ...(body.vendorAllowlist && { vendorAllowlist: body.vendorAllowlist }),
      ...(body.blocklist && { blocklist: body.blocklist }),
      ...(body.hitlCategories && { hitlCategories: body.hitlCategories }),
      ...(body.quietHours !== undefined && { quietHours: body.quietHours ?? undefined }),
    };
    if (next.hitlAboveMicro >= next.perTxMaxMicro) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "hitlAboveUsdc must be below perTxMaxUsdc (allow < review < deny bands)",
        },
      });
    }
    store.setPolicyTemplate(org.id, next);
    // New allowlist entries are trusted counterparties going forward.
    for (const v of [...next.vendorAllowlist, ...next.domainAllowlist, ...next.addressAllowlist]) {
      store.addKnownCounterparty(org.id, v);
    }
    res.json({ ok: true, policy: policyView(next) });
  }, { ownerOnly: true }),
);

app.get(
  "/v1/guardian/approvals",
  guardianRoute((org, req, res) => {
    sweepApprovalExpiry();
    const status = req.query.status ? String(req.query.status) : undefined;
    res.json({ approvals: store.listApprovals(org.id, status).map(approvalView) });
  }),
);

app.post(
  "/v1/guardian/approvals/:id/resolve",
  guardianRoute(async (org, req, res) => {
    const body = z
      .object({
        approve: z.boolean(),
        resolvedBy: z.string().default("guardian"),
      })
      .parse(req.body);
    const outcome = await resolveApproval(
      org.id,
      req.params.id,
      body.approve,
      body.resolvedBy,
      guardianIdentity(req),
    );
    switch (outcome.kind) {
      case "not_found":
        return res.status(404).json({ error: { code: "NOT_FOUND" } });
      case "conflict":
        return res.status(409).json({
          error: {
            code: "VALIDATION_ERROR",
            message: `Approval is ${outcome.approval.status}`,
          },
          approval: approvalView(outcome.approval),
        });
      case "expired":
        return res.status(409).json({
          error: { code: "APPROVAL_TIMEOUT", message: "Approval expired" },
          approval: approvalView(outcome.approval),
        });
      case "frozen":
        return res
          .status(409)
          .json({ error: { code: "FROZEN" }, approval: approvalView(outcome.approval) });
      case "pending_quorum":
        return res.status(202).json({
          ok: true,
          pendingQuorum: true,
          have: outcome.have,
          need: outcome.need,
          message: `Vote recorded — ${outcome.have} of ${outcome.need} guardians have approved.`,
          approval: approvalView(outcome.approval),
        });
      case "resolved":
        return res
          .status(outcome.ok ? 200 : (outcome.execStatus ?? 500))
          .json({ ok: outcome.ok, approval: approvalView(outcome.approval) });
    }
  }),
);

app.get(
  "/v1/guardian/escrows",
  guardianRoute((org, _req, res) => {
    sweepEscrowTimeouts();
    res.json({ escrows: store.listEscrows(org.id).map(escrowView) });
  }),
);

/** Guardian dispute resolution: force release or refund a locked escrow. */
app.post(
  "/v1/guardian/escrows/:id/resolve",
  guardianRoute((org, req, res) => {
    const body = z
      .object({
        action: z.enum(["release", "refund"]),
        resolvedBy: z.string().default("guardian"),
      })
      .parse(req.body);
    const escrow = store.getEscrow(req.params.id, org.id);
    if (!escrow) return res.status(404).json({ error: { code: "NOT_FOUND" } });
    const result = settleEscrow(escrow, body.action, `guardian:${body.resolvedBy}`);
    if (!result.ok) return res.status(result.status).json(result.payload);
    return res.json({ ok: true, escrow: escrowView(store.getEscrow(req.params.id, org.id)!) });
  }),
);

app.post(
  "/v1/guardian/webhooks",
  guardianRoute((org, req, res) => {
    const body = z.object({ url: z.string().url() }).parse(req.body);
    const problem = webhookUrlProblem(body.url);
    if (problem) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: problem },
      });
    }
    const webhook = store.createWebhook(org.id, body.url);
    res.status(201).json({
      id: webhook.id,
      url: webhook.url,
      secret: webhook.secret,
      note: "Verify x-policyvault-signature (HMAC-SHA256 of raw body with this secret) and dedupe on x-policyvault-delivery.",
    });
  }, { ownerOnly: true }),
);

app.get(
  "/v1/guardian/webhooks",
  guardianRoute((org, _req, res) => {
    res.json({
      webhooks: store
        .listWebhooks(org.id)
        .map(({ secret: _s, ...rest }) => ({ ...rest, secret: "pv_whsec_***" })),
    });
  }),
);

app.delete(
  "/v1/guardian/webhooks/:id",
  guardianRoute((org, req, res) => {
    const deleted = store.deleteWebhook(req.params.id, org.id);
    if (!deleted) return res.status(404).json({ error: { code: "NOT_FOUND" } });
    res.json({ ok: true });
  }, { ownerOnly: true }),
);

app.get(
  "/v1/guardian/webhooks/deliveries",
  guardianRoute((org, _req, res) => {
    res.json({ deliveries: store.listDeliveries(org.id) });
  }),
);

/** Fire a signed test event so receivers can verify their integration. */
app.post(
  "/v1/guardian/webhooks/:id/test",
  guardianRoute((org, req, res) => {
    const webhook = store.getWebhook(req.params.id);
    if (!webhook || webhook.orgId !== org.id) {
      return res.status(404).json({ error: { code: "NOT_FOUND" } });
    }
    emitEvent(org.id, "payment.succeeded", {
      test: true,
      intentId: "int_test",
      receiptId: "rcpt_test",
      amountUsdc: "0",
      destination: "test",
      note: "Test delivery fired from the guardian console",
    });
    res.json({ ok: true, note: "Test event dispatched to all endpoints — check deliveries." });
  }, { ownerOnly: true }),
);

// ---------------------------------------------------------------------------
// Agent routes (Bearer pv_agent_...)
// ---------------------------------------------------------------------------

app.get("/v1/agent/budget", (req, res) => {
  const auth = authAgent(req);
  if (!auth) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
  const map = store.getAccountMap(auth.orgId);
  const av = map.get(`agent:${auth.agentId}:available`);
  const held = map.get(`agent:${auth.agentId}:held`);
  const rules = rulesFor(auth.agentId, auth.orgId);
  const spent = store.spentLast24h(auth.agentId);
  const remaining = rules.dailyMaxMicro - spent;
  res.json({
    availableUsdc: formatMicroToUsdc(av?.balanceMicro ?? 0n),
    heldUsdc: formatMicroToUsdc(held?.balanceMicro ?? 0n),
    dailyRemainingUsdc: formatMicroToUsdc(remaining < 0n ? 0n : remaining),
    frozen: rules.agentFrozen || rules.orgFrozen,
  });
});

const payBody = z.object({
  amountUsdc: z.string(),
  destination: z.string(),
  idempotencyKey: z.string().min(8),
  jobId: z.string().optional(),
  memo: z.string().optional(),
});

async function handlePay(req: express.Request, res: express.Response, tool: "pay" | "pay_api") {
  const auth = authAgent(req);
  if (!auth) {
    res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    return;
  }
  const parsed = payBody.parse(req.body);
  await handleIntent(res, {
    orgId: auth.orgId,
    agentId: auth.agentId,
    tool,
    amountMicro: parseUsdcToMicro(parsed.amountUsdc),
    amountUsdc: parsed.amountUsdc,
    destination: parsed.destination,
    jobId: parsed.jobId,
    memo: parsed.memo,
    idempotencyKey: parsed.idempotencyKey,
  });
}

app.post("/v1/agent/pay_api", asyncRoute((req, res) => handlePay(req, res, "pay_api")));
app.post("/v1/agent/pay", asyncRoute((req, res) => handlePay(req, res, "pay")));

app.post("/v1/agent/simulate", (req, res) => {
  const auth = authAgent(req);
  if (!auth) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
  const body = z
    .object({
      tool: z.enum(["pay", "pay_api", "escrow_lock"]),
      amountUsdc: z.string(),
      destination: z.string(),
      jobId: z.string().optional(),
    })
    .parse(req.body);
  const amountMicro = parseUsdcToMicro(body.amountUsdc);
  const decision = evaluatePolicy(
    {
      agentId: auth.agentId,
      orgId: auth.orgId,
      tool: body.tool,
      amountMicro,
      destination: body.destination,
      jobId: body.jobId,
      idempotencyKey: "simulate",
    },
    rulesFor(auth.agentId, auth.orgId),
  );
  res.json(decision);
});

app.get("/v1/agent/approvals/:id", (req, res) => {
  const auth = authAgent(req);
  if (!auth) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
  sweepApprovalExpiry();
  const approval = store.getApproval(req.params.id, auth.orgId);
  if (!approval || approval.agentId !== auth.agentId) {
    return res.status(404).json({ error: { code: "NOT_FOUND" } });
  }
  res.json({ approval: approvalView(approval) });
});

app.post(
  "/v1/agent/escrow/lock",
  asyncRoute(async (req, res) => {
    const auth = authAgent(req);
    if (!auth) {
      res.status(401).json({ error: { code: "UNAUTHORIZED" } });
      return;
    }
    const body = z
      .object({
        amountUsdc: z.string(),
        payeeAgentId: z.string(),
        idempotencyKey: z.string().min(8),
        jobId: z.string().optional(),
        memo: z.string().optional(),
        timeoutMinutes: z.number().int().positive().max(7 * 24 * 60).optional(),
      })
      .parse(req.body);
    const payee = store.getAgent(body.payeeAgentId);
    if (!payee || payee.orgId !== auth.orgId) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "payeeAgentId not in org" } });
      return;
    }
    if (payee.id === auth.agentId) {
      res
        .status(400)
        .json({ error: { code: "VALIDATION_ERROR", message: "Cannot escrow to self" } });
      return;
    }
    await handleIntent(res, {
      orgId: auth.orgId,
      agentId: auth.agentId,
      tool: "escrow_lock",
      amountMicro: parseUsdcToMicro(body.amountUsdc),
      amountUsdc: body.amountUsdc,
      destination: body.payeeAgentId,
      jobId: body.jobId,
      memo: body.memo,
      idempotencyKey: body.idempotencyKey,
      payeeAgentId: body.payeeAgentId,
      timeoutMinutes: body.timeoutMinutes,
    });
  }),
);

app.get("/v1/agent/escrow/:id", (req, res) => {
  const auth = authAgent(req);
  if (!auth) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
  sweepEscrowTimeouts();
  const escrow = store.getEscrow(req.params.id, auth.orgId);
  if (!escrow) return res.status(404).json({ error: { code: "NOT_FOUND" } });
  res.json({ escrow: escrowView(escrow) });
});

app.post("/v1/agent/escrow/:id/release", (req, res) => {
  const auth = authAgent(req);
  if (!auth) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
  const escrow = store.getEscrow(req.params.id, auth.orgId);
  if (!escrow) return res.status(404).json({ error: { code: "NOT_FOUND" } });
  if (escrow.payerAgentId !== auth.agentId) {
    return res.status(403).json({
      error: { code: "UNAUTHORIZED", message: "Only the payer agent can release escrow" },
    });
  }
  // Releasing moves money, so the kill switch must apply here too.
  const rel = rulesFor(auth.agentId, auth.orgId);
  if (rel.agentFrozen || rel.orgFrozen) {
    return res.status(403).json({
      error: { code: "FROZEN", message: "Frozen — escrow release requires a guardian" },
    });
  }
  const result = settleEscrow(escrow, "release", `agent:${auth.agentId}`);
  if (!result.ok) return res.status(result.status).json(result.payload);
  return res.json({ ok: true, escrow: escrowView(store.getEscrow(req.params.id, auth.orgId)!) });
});

app.post("/v1/agent/escrow/:id/refund", (req, res) => {
  const auth = authAgent(req);
  if (!auth) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
  const escrow = store.getEscrow(req.params.id, auth.orgId);
  if (!escrow) return res.status(404).json({ error: { code: "NOT_FOUND" } });
  if (escrow.payerAgentId !== auth.agentId && escrow.payeeAgentId !== auth.agentId) {
    return res.status(403).json({
      error: { code: "UNAUTHORIZED", message: "Only escrow parties can refund" },
    });
  }
  const result = settleEscrow(escrow, "refund", `agent:${auth.agentId}`);
  if (!result.ok) return res.status(result.status).json(result.payload);
  return res.json({ ok: true, escrow: escrowView(store.getEscrow(req.params.id, auth.orgId)!) });
});

// ---------------------------------------------------------------------------
// Background sweeps + reconciliation watchdog
// ---------------------------------------------------------------------------

/**
 * Terminal error handler: guarantees every failure leaves as the documented
 * JSON envelope. Without it a Zod throw escapes as Express's HTML 500 page,
 * which SDK clients cannot parse.
 */
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return;
  if (err instanceof z.ZodError) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
    });
  }
  if (isInvalidUsdcAmount(err)) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid USDC amount" },
    });
  }
  console.error("unhandled route error:", err);
  res.status(500).json({ error: { code: "RAIL_FAILED", message: "Internal error" } });
});

/**
 * Charge due subscriptions. Each run goes through the same policy engine as
 * any other agent payment — a recurring charge gets no special authority, so a
 * frozen agent or a blown cap stops it exactly like a one-off.
 */
async function runDueSubscriptions(): Promise<void> {
  for (const sub of store.listDueSubscriptions()) {
    if (sub.maxTotalMicro && sub.spentMicro >= sub.maxTotalMicro) {
      store.setSubscriptionStatus(sub.id, "exhausted");
      continue;
    }
    const nextRunAt = new Date(Date.now() + sub.intervalHours * 3600_000).toISOString();
    // Claim the due slot BEFORE awaiting the rail — otherwise a 10s sweep can
    // overlap an in-flight charge and double-spend.
    if (!store.claimSubscriptionRun(sub.id, sub.nextRunAt, nextRunAt)) continue;

    const intentId = id("int");
    const decision = evaluatePolicy(
      {
        agentId: sub.agentId,
        orgId: sub.orgId,
        tool: "pay_api",
        amountMicro: sub.amountMicro,
        destination: sub.vendor,
        idempotencyKey: `sub_${sub.id}_${sub.runs}`,
      },
      rulesFor(sub.agentId, sub.orgId),
      "subscription",
    );
    recordDecision({
      intentId,
      orgId: sub.orgId,
      agentId: sub.agentId,
      outcome: decision.outcome,
      ruleIds: decision.ruleIds,
      reasons: decision.reasons,
      tool: "pay_api",
      amountUsdc: formatMicroToUsdc(sub.amountMicro),
      destination: sub.vendor,
    });

    if (decision.outcome !== "allow") {
      store.recordSubscriptionRun({
        subId: sub.id,
        chargedMicro: 0n,
        nextRunAt,
        error: `${decision.outcome}: ${decision.reasons[0] ?? ""}`,
      });
      continue;
    }
    const result = await executeIntent({
      orgId: sub.orgId,
      agentId: sub.agentId,
      tool: "pay_api",
      amountMicro: sub.amountMicro,
      amountUsdc: formatMicroToUsdc(sub.amountMicro),
      destination: sub.vendor,
      intentId,
      memo: sub.memo ?? `subscription ${sub.id}`,
    });
    store.recordSubscriptionRun({
      subId: sub.id,
      chargedMicro: result.ok ? sub.amountMicro : 0n,
      nextRunAt,
      error: result.ok ? undefined : JSON.stringify(result.payload.error),
    });
  }
}

setInterval(() => {
  sweepEscrowTimeouts();
  sweepApprovalExpiry();
  for (const orgId of store.listOrgIds()) store.sweepOverdueInvoices(orgId);
  void runDueSubscriptions().catch((e) => console.error("subscription sweep failed:", e));
}, 10_000).unref();

setInterval(() => {
  for (const orgId of store.listOrgIds()) {
    const result = store.reconcileOrg(orgId);
    if (!result.ok) {
      console.error(`RECONCILE DRIFT org=${orgId}:`, JSON.stringify(result.drift));
    }
  }
}, 60_000).unref();

startTelegramPolling();

app.listen(PORT, () => {
  console.log(`PolicyVault API on http://localhost:${PORT} (SQLite-backed)`);
  console.log(LEGAL_FOOTER);
});
