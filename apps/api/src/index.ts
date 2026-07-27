import {
  LEGAL_FOOTER,
  accountId,
  formatMicroToUsdc,
  parseUsdcToMicro,
} from "@policyvault/common";
import { DevLocalProvider, SelfCustodyVaultProvider, cdpEnvConfigured, getCustodyProvider, setCustodyProvider } from "@policyvault/custody";
import { recogniseRevenue, transferAvailable } from "@policyvault/ledger";
import { evaluatePolicy, matchedAutomationRules } from "@policyvault/policy";
import { timingSafeEqual } from "node:crypto";
import cors from "cors";
import express from "express";
import { privateKeyToAccount } from "viem/accounts";
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
  vendorLedger,
} from "./analytics.js";
import { answerQuestion, buildSummary } from "./insights.js";
import { runAbiAgent, resolveExternalProposal } from "./abi-agent/index.js";
import {
  store,
  type ApprovalRow,
  type EscrowRow,
  type InvoiceRow,
  type OrgRow,
  type RunRow,
} from "./store.js";
import { reconcileOrgOnchain } from "./treasury-backing.js";
import { startTelegramPolling, telegramEnabled, registerTelegramNotifier } from "./telegram.js";
import { notify, registerInAppNotifier, registerNotifier } from "./platform/notifier.js";
import { presentAnswer, setFactRephraser } from "./platform/ai.js";
import {
  AI_EGRESS_DISCLOSURE,
  AiSettingsError,
  aiSettingsView,
  resolveAiEgress,
  updateAiSettings,
} from "./abi-agent/ai-settings.js";
import { createOpenAiFactRephraser } from "./platform/openai-rephraser.js";
import { recordObs, setObservabilitySink, PrometheusSink, getObservabilitySink } from "./platform/observability.js";
import { emitEvent } from "./webhooks.js";
import { openApiDocument } from "./platform/openapi.js";
import { webhookUrlProblem } from "./outbound-url.js";
import { hashSecret } from "./secrets.js";
import { csrfProblem } from "./auth/session.js";
import { currentUser, registerAuthRoutes } from "./routes/auth-routes.js";
import { registerMfaRoutes, stepUpThresholdMicro } from "./routes/mfa-routes.js";
import { registerAgentRoutes } from "./routes/agent-routes.js";
import { startScheduler } from "./jobs/scheduler.js";
import { registerPaymentRoutes } from "./routes/payment-routes.js";
import { registerPlatformRoutes } from "./routes/platform-routes.js";
import { registerPolicyRoutes } from "./routes/policy-routes.js";
import { registerTreasuryRoutes } from "./routes/treasury-routes.js";

const app = express();
/**
 * CORS.
 *
 * `cors()` with no options replies `Access-Control-Allow-Origin: *`, which
 * browsers refuse to combine with credentials — so cookie auth would silently
 * fail cross-origin. The console calls same-origin `/abi-api` and needs no
 * CORS at all; anything else must be named explicitly in ABI_CORS_ORIGINS.
 */
const corsOrigins = (process.env.ABI_CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins.length ? corsOrigins : false,
    credentials: corsOrigins.length > 0,
  }),
);
// Behind the Next proxy / a load balancer, so req.ip must come from
// X-Forwarded-For or every caller shares one rate-limit bucket.
app.set("trust proxy", true);
app.use(express.json());

const PORT = Number(process.env.PORT ?? 8787);
const STARTED_AT = Date.now();

registerInAppNotifier();
registerTelegramNotifier();

/** Prometheus + optional console JSON — scrape GET /metrics. */
const promSink = new PrometheusSink({ consoleAlso: true });
setObservabilitySink(promSink);

function notifyOrgId(payload: Parameters<Parameters<typeof registerNotifier>[1]>[0]): string | undefined {
  if (payload.kind === "approval.pending") return payload.approval.orgId;
  if ("orgId" in payload) return payload.orgId as string;
  return undefined;
}

function formatNotifyText(payload: Parameters<Parameters<typeof registerNotifier>[1]>[0]): string {
  if (payload.kind === "approval.pending") {
    return `ABI approval pending · $${payload.approval.amountUsdc} → ${payload.approval.destination}`;
  }
  if ("title" in payload) return `${payload.title}: ${payload.body}`;
  return `ABI ${payload.kind}`;
}

/** Email — Resend API when RESEND_API_KEY + ABI_NOTIFY_EMAIL_TO set; else log stub. */
registerNotifier("email", (payload) => {
  const orgId = notifyOrgId(payload);
  const to = process.env.ABI_NOTIFY_EMAIL_TO?.trim();
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const text = formatNotifyText(payload);
  if (resendKey && to) {
    void fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.ABI_NOTIFY_EMAIL_FROM ?? "ABI <onboarding@resend.dev>",
        to: [to],
        subject: `[ABI] ${payload.kind}`,
        text,
      }),
    }).catch((e) => console.error("email notify failed:", e));
    return;
  }
  console.log(JSON.stringify({ type: "abi.notify.email", kind: payload.kind, orgId, stub: true }));
});

/** Slack — incoming webhook when SLACK_WEBHOOK_URL set; else log stub. */
registerNotifier("slack", (payload) => {
  const orgId = notifyOrgId(payload);
  const url = process.env.SLACK_WEBHOOK_URL?.trim();
  const text = formatNotifyText(payload);
  if (url) {
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `*ABI* ${text}` }),
    }).catch((e) => console.error("slack notify failed:", e));
    return;
  }
  console.log(JSON.stringify({ type: "abi.notify.slack", kind: payload.kind, orgId, stub: true }));
});

/** Optional phrasing layer — facts stay deterministic; LLM may polish wording. */
if (process.env.ABI_FACT_REPHRASER === "echo") {
  setFactRephraser(() => ({
    name: "echo",
    async rewrite({ facts }) {
      return facts;
    },
  }));
} else if (process.env.ABI_FACT_REPHRASER !== "off") {
  // Per organization, resolved at call time. An org that has not opted into
  // model egress gets no rephraser and reads the deterministic facts — which
  // is the same answer, in plainer language. See abi-agent/ai-settings.ts.
  setFactRephraser((orgId) => {
    const egress = resolveAiEgress(orgId);
    return egress ? createOpenAiFactRephraser(egress) : null;
  });
  console.log(
    JSON.stringify({
      type: "abi.ai",
      rephraser: "per-org",
      note: "Model egress is off by default; each org opts in under Settings.",
    }),
  );
}

/** Webhook channel — fans notify payloads into the existing signed delivery path. */
registerNotifier("webhook", (payload) => {
  if (payload.kind === "approval.pending") {
    emitEvent(payload.approval.orgId, "approval.pending", {
      approvalId: payload.approval.id,
      agentId: payload.approval.agentId,
      amountUsdc: payload.approval.amountUsdc,
      destination: payload.approval.destination,
    });
    return;
  }
  if (payload.kind === "approval.resolved") {
    emitEvent(payload.orgId, "approval.resolved", {
      approvalId: payload.approvalId,
      status: payload.status,
      resolvedBy: payload.resolvedBy,
    });
    return;
  }
  if (payload.kind === "policy.denied") {
    emitEvent(payload.orgId, "policy.denied", { title: payload.title, body: payload.body, ...payload.meta });
    return;
  }
  if (payload.kind === "agent.frozen") {
    emitEvent(payload.orgId, "agent.frozen", { title: payload.title, body: payload.body, ...payload.meta });
    return;
  }
  if (payload.kind === "compliance.flagged") {
    emitEvent(payload.orgId, "compliance.flagged", { title: payload.title, body: payload.body, ...payload.meta });
  }
});

/**
 * Custody selection.
 *
 * Both branches are SELF-CUSTODY: the org's private key is read from the
 * database and signed with locally. CDP credentials only pick the
 * production-mode label; they are not used to call Coinbase. Real CDP Server
 * Wallet custody is roadmap P4-T1.
 */
{
  const lookup = (orgId: string) => {
    const privateKey = store.getVaultPrivateKey(orgId);
    const address = store.getVaultAddress(orgId);
    if (!privateKey || !address) return null;
    return {
      address: address as `0x${string}`,
      privateKey,
      network: (process.env.CHAIN === "base" ? "base" : "base-sepolia") as "base" | "base-sepolia",
    };
  };
  const sign = async (
    privateKey: `0x${string}`,
    typedData: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    },
  ) => {
    const account = privateKeyToAccount(privateKey);
    return account.signTypedData({
      domain: typedData.domain as Parameters<typeof account.signTypedData>[0]["domain"],
      types: typedData.types as Parameters<typeof account.signTypedData>[0]["types"],
      primaryType: typedData.primaryType,
      message: typedData.message as Parameters<typeof account.signTypedData>[0]["message"],
    });
  };
  if (cdpEnvConfigured()) {
    setCustodyProvider(
      new SelfCustodyVaultProvider(lookup, sign, {
        apiKeyId: process.env.CDP_API_KEY_ID!,
        network: process.env.CHAIN === "base" ? "base" : "base-sepolia",
      }),
    );
    console.log(
      JSON.stringify({
        type: "abi.custody",
        provider: "self-custody",
        note:
          "Production mode. Keys are held by this application, NOT by Coinbase CDP. " +
          "Fund vaultAddress shown in Treasury → Fund.",
      }),
    );
  } else {
    setCustodyProvider(new DevLocalProvider(lookup, sign));
  }
}

// ---------------------------------------------------------------------------
// Rate limiting: sliding window per bearer key (falls back to IP).
// Generous dev default — this is abuse protection, not throttling.
// ---------------------------------------------------------------------------
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN ?? 5000);
/** Credential-minting routes get their own, far tighter budget per IP. */
const SIGNUP_LIMIT_PER_HOUR = Number(process.env.ABI_SIGNUP_LIMIT_PER_HOUR ?? 10);
/** Cap the window map so a key-rotating caller cannot exhaust memory. */
const RATE_MAX_KEYS = 50_000;

const rateWindows = new Map<string, number[]>();

/**
 * Bucket key.
 *
 * This used to be the raw `Authorization` header, which is attacker-controlled:
 * rotating the header on each request produced a fresh full budget, so the
 * limiter only ever slowed down honest clients. Bucket on the *hash* of the
 * credential when one is presented — identifying the caller without holding the
 * secret in memory — and fall back to the source IP otherwise.
 */
function rateKey(req: express.Request): string {
  const cred = bearer(req);
  if (cred) return `k:${hashSecret(cred)}`;
  return `i:${req.ip ?? "anon"}`;
}

function overLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (rateWindows.get(key) ?? []).filter((t) => t > now - windowMs);
  hits.push(now);
  // Evict oldest-inserted keys rather than growing without bound.
  if (!rateWindows.has(key) && rateWindows.size >= RATE_MAX_KEYS) {
    const oldest = rateWindows.keys().next().value;
    if (oldest !== undefined) rateWindows.delete(oldest);
  }
  rateWindows.set(key, hits);
  return hits.length > limit;
}

const SIGNUP_PATHS = new Set(["/v1/guardian/orgs", "/v1/demo/bootstrap"]);

app.use((req, res, next) => {
  if (req.path === "/health" || req.path === "/metrics") return next();

  // Routes that mint a root credential are limited per IP per hour, so a token
  // leak or an open dev instance cannot be farmed for organizations.
  if (SIGNUP_PATHS.has(req.path) && req.method === "POST") {
    if (overLimit(`signup:${req.ip ?? "anon"}`, SIGNUP_LIMIT_PER_HOUR, 3_600_000)) {
      return res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: `Over ${SIGNUP_LIMIT_PER_HOUR} organizations/hour from this address`,
        },
      });
    }
  }

  if (overLimit(rateKey(req), RATE_LIMIT_PER_MIN, 60_000)) {
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

/**
 * Invite gate for the two routes that mint a root guardian key without an
 * existing credential (org creation, demo seeding).
 *
 * When `ABI_SIGNUP_TOKEN` is set, callers must present it via
 * `x-abi-signup-token`. Unset means open, which is correct for local
 * development and wrong for anything reachable by others — so production
 * refuses to serve these routes at all unless a token is configured.
 *
 * Returns a problem string, or null when the caller may proceed.
 */
function signupTokenProblem(req: express.Request): string | null {
  const expected = process.env.ABI_SIGNUP_TOKEN?.trim();
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return "Self-serve organization creation requires ABI_SIGNUP_TOKEN to be configured.";
    }
    return null;
  }
  const presented = req.header("x-abi-signup-token")?.trim();
  if (!presented || !timingSafeEqualStr(presented, expected)) {
    return "Missing or invalid x-abi-signup-token.";
  }
  return null;
}

/** Constant-time string compare so the token cannot be probed byte by byte. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

type AgentAuth = { orgId: string; agentId: string; scopes: string[] };

function authAgent(req: express.Request): AgentAuth | null {
  const key = bearer(req);
  if (!key) return null;
  if (key.startsWith("pv_sess_")) {
    const session = store.getSessionByToken(key);
    if (!session) return null;
    // Frozen / archived agents still authenticate: their intents hit the policy
    // engine and produce an explainable agent_frozen/org_frozen deny in the trace.
    return {
      orgId: session.agent.orgId,
      agentId: session.agent.id,
      scopes: session.scopes,
    };
  }
  if (key.startsWith("pv_agent_")) {
    const agent = store.getAgentByKey(key);
    if (!agent) return null;
    // Full agent keys carry all scopes.
    return { orgId: agent.orgId, agentId: agent.id, scopes: ["read", "pay", "escrow"] };
  }
  return null;
}

/** Returns true when the caller may proceed; otherwise writes 403 and returns false. */
function requireAgentScope(auth: AgentAuth, scope: string, res: express.Response): boolean {
  if (auth.scopes.includes(scope)) return true;
  res.status(403).json({
    error: {
      code: "INSUFFICIENT_SCOPE",
      message: `Session key lacks scope '${scope}'`,
      required: scope,
      scopes: auth.scopes,
    },
  });
  return false;
}

/**
 * Guardian auth. The org is always derived from the credential, never from the
 * request body.
 *
 * Two credential types, deliberately:
 *   - **Session cookie** — a signed-in human. Carries a real user identity, so
 *     approval votes and the audit trail can name a person rather than whatever
 *     display string the client chose to send.
 *   - **Bearer `pv_guardian_` key** — machine access and the pre-identity
 *     migration path. Retained so existing integrations keep working; roadmap
 *     P3-T5 narrows it to service accounts only.
 *
 * A session picks its org from `x-abi-org` (or the caller's only membership),
 * and the membership row decides the role — so one person can hold different
 * roles in different organizations, which a single key could never express.
 */
type GuardianRole = "owner" | "approver" | "viewer";
type GuardianCtx = {
  org: OrgRow;
  role: GuardianRole;
  /** Stable identity for quorum counting and vote attribution. */
  guardianId: string;
  /** Present when the caller is a signed-in human. */
  user?: { id: string; email: string; name: string };
  via: "session" | "key";
};

function authGuardianCtx(req: express.Request): GuardianCtx | null {
  // Prefer the session: it is the stronger identity when both are present.
  const me = currentUser(req);
  if (me) {
    const memberships = store.listMembershipsForUser(me.user.id);
    if (memberships.length === 0) return null;
    const requested = req.header("x-abi-org")?.trim();
    const membership = requested
      ? memberships.find((m) => m.orgId === requested)
      : memberships.length === 1
        ? memberships[0]
        : undefined;
    if (!membership) return null;
    const org = store.getOrg(membership.orgId);
    if (!org) return null;
    return {
      org,
      role: membership.role,
      // Prefixed so a user id can never collide with a guardian-seat id when
      // quorum counts distinct approvers.
      guardianId: `user:${me.user.id}`,
      user: { id: me.user.id, email: me.user.email, name: me.user.name },
      via: "session",
    };
  }

  const key = bearer(req);
  if (!key || !key.startsWith("pv_guardian_")) return null;
  const founder = store.findOrgByGuardianKey(key);
  if (founder) return { org: founder, role: "owner", guardianId: "owner", via: "key" };
  const invited = store.findGuardianByKey(key);
  if (!invited || invited.revokedAt) return null;
  const org = store.getOrg(invited.orgId);
  if (!org) return null;
  return { org, role: invited.role, guardianId: invited.id, via: "key" };
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
    // Cookies are sent by the browser automatically, so a cookie-authenticated
    // mutation needs a token the attacker's origin cannot read. Bearer callers
    // are exempt: nothing attaches those headers on their behalf.
    if (ctx.via === "session") {
      const problem = csrfProblem(req);
      if (problem) {
        return res.status(403).json({ error: { code: "CSRF_FAILED", message: problem } });
      }
    }
    // Stash for handlers that need role (e.g. GET /org actor).
    (req as express.Request & { guardianCtx?: GuardianCtx }).guardianCtx = ctx;
    // Viewers may read (GET/HEAD) only — mutates require approver or owner.
    const method = req.method.toUpperCase();
    const isRead = method === "GET" || method === "HEAD";
    if (ctx.role === "viewer" && !isRead) {
      return res.status(403).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Viewer guardians have read-only access",
        },
      });
    }
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

registerAuthRoutes(app);
registerMfaRoutes(app);
registerTreasuryRoutes(app, { guardianRoute, guardianIdentity });
registerAgentRoutes(app, { guardianRoute });
registerPolicyRoutes(app, { guardianRoute });
registerPaymentRoutes(app, { guardianRoute });
registerPlatformRoutes(app, { guardianRoute });

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

/** Fire notify / freeze_agent actions for matched automation rules. */
function applyAutomationSideEffects(
  input: Omit<ExecInput, "intentId" | "payeeAgentId" | "timeoutMinutes"> & {
    intentId: string;
    idempotencyKey: string;
    decisionRuleIds: string[];
  },
): void {
  const rules = rulesFor(input.agentId, input.orgId, input.destination);
  const matched = matchedAutomationRules(
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
    rules,
  );
  for (const rule of matched) {
    if (rule.then.kind === "notify") {
      const channel = rule.then.channel;
      void notify(
        {
          kind: "info",
          orgId: input.orgId,
          title: `Automation: ${rule.name}`,
          body: `${input.tool} $${input.amountUsdc} → ${input.destination}`,
          meta: { ruleId: rule.id, intentId: input.intentId, agentId: input.agentId },
        },
        channel ? [channel] : undefined,
      );
    }
    if (
      rule.then.kind === "freeze_agent" &&
      input.decisionRuleIds.includes(`automation:${rule.id}`)
    ) {
      store.setAgentStatus(input.agentId, "frozen");
      store.addFreeze(input.orgId, input.agentId, `automation:${rule.id}`);
      emitEvent(input.orgId, "agent.frozen", {
        agentId: input.agentId,
        reason: `automation:${rule.id}`,
        intentId: input.intentId,
      });
      void notify({
        kind: "agent.frozen",
        orgId: input.orgId,
        title: "Agent frozen by automation",
        body: `Rule “${rule.name}” froze agent ${input.agentId}`,
        meta: { ruleId: rule.id, agentId: input.agentId },
      });
      recordObs({
        name: "agent.frozen",
        orgId: input.orgId,
        agentId: input.agentId,
        attrs: { ruleId: rule.id },
      });
    }
  }
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
    rulesFor(input.agentId, input.orgId, input.destination),
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

  // Automation side-effects (notify / freeze) — money outcome already decided.
  applyAutomationSideEffects({
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
    decisionRuleIds: decision.ruleIds,
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
    void notify({
      kind: "policy.denied",
      orgId: input.orgId,
      title: "Policy denied",
      body: decision.reasons.join("; "),
      meta: { intentId, agentId: input.agentId, ruleIds: decision.ruleIds },
    });
    recordObs({
      name: "policy.denied",
      orgId: input.orgId,
      agentId: input.agentId,
      attrs: { ruleIds: decision.ruleIds },
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

/** Prometheus text exposition (Observability pillar). */
app.get("/metrics", (_req, res) => {
  const sink = getObservabilitySink();
  const text =
    typeof sink.prometheusText === "function"
      ? sink.prometheusText()
      : "# no prometheus sink\n";
  res.type("text/plain; version=0.0.4; charset=utf-8").send(text);
});

app.get("/v1/openapi.json", (_req, res) => {
  res.json(openApiDocument(`http://localhost:${PORT}`));
});

/**
 * Seed a demo organization.
 *
 * This route used to be DESTRUCTIVE: it wiped every org in the database, and
 * it required no authentication, so any anonymous request could erase every
 * tenant's ledger, audit trail and vault private keys. It now creates a *new*
 * org and touches nothing that already exists. The global wipe survives only
 * as a local script (`npm run db:reset`) and is not reachable over HTTP.
 *
 * Still gated, because it mints a root guardian key: an open endpoint that
 * hands out credentials is an abuse vector even when it is non-destructive.
 */
const ALLOW_DEMO_SEED =
  process.env.POLICYVAULT_ALLOW_BOOTSTRAP === "1" ||
  (process.env.NODE_ENV !== "production" && process.env.POLICYVAULT_ALLOW_BOOTSTRAP !== "0");

app.post("/v1/demo/bootstrap", (req, res) => {
  if (!ALLOW_DEMO_SEED) {
    return res.status(403).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Demo seeding is disabled. Set POLICYVAULT_ALLOW_BOOTSTRAP=1 to enable.",
      },
    });
  }
  const gate = signupTokenProblem(req);
  if (gate) {
    return res.status(403).json({ error: { code: "UNAUTHORIZED", message: gate } });
  }
  try {
    const demo = store.seedDemoOrg();
    res.json({
      ...demo,
      legal: LEGAL_FOOTER,
      note: "Demo org seeded. agentApiKey = agent Bearer token; guardianKey = guardian Bearer token. Existing organizations were not modified.",
    });
  } catch (e) {
    console.error("demo seed failed:", e);
    return res.status(500).json({
      error: {
        code: "BOOTSTRAP_FAILED",
        message: e instanceof Error ? e.message : String(e),
      },
    });
  }
});

// ---------------------------------------------------------------------------
// Guardian routes (Bearer pv_guardian_... — org derived from the key)
// ---------------------------------------------------------------------------

/**
 * Create a real org (empty agent roster).
 *
 * This route returns a root guardian key to an otherwise unauthenticated
 * caller, so it is gated twice: by the feature flag, and by the signup token
 * (mandatory in production). Roadmap P3-T1 replaces both with real accounts.
 *
 * Ledger `depositUsdc` is optional mock float; live USDC comes from on-chain
 * vault funding + auto-credit.
 */
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
  const gate = signupTokenProblem(req);
  if (gate) {
    return res.status(403).json({ error: { code: "UNAUTHORIZED", message: gate } });
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

app.get(
  "/v1/guardian/org",
  guardianRoute((org, req, res) => {
    const accounts = [...store.getAccountMap(org.id).values()];
    const agents = store.listAgents(org.id);
    const template = store.getPolicyTemplate(org.id);
    const actor = (req as express.Request & { guardianCtx?: GuardianCtx }).guardianCtx;
    res.json({
      org: { id: org.id, name: org.name, status: org.status, settings: org.settings },
      actor: actor
        ? { role: actor.role, guardianId: actor.guardianId }
        : { role: "owner", guardianId: "owner" },
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
      // Live orgs hold real money and cannot mint; sandbox orgs can, and every
      // surface that shows their balance says so.
      ledgerMode: store.getOrgLedgerMode(org.id),
      unbackedUsdc: formatMicroToUsdc(store.getUnbackedMicro(org.id)),
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
      owner: { name: org.name, role: "owner" as const },
    });
  }),
);

/** Update secondary guardian role / HITL conditions. */
app.patch(
  "/v1/guardian/guardians/:id",
  guardianRoute((org, req, res) => {
    const body = z
      .object({
        role: z.enum(["approver", "viewer"]).optional(),
        conditions: z
          .object({
            restricted: z.boolean().optional(),
            maxApproveUsdc: z.string().optional(),
            note: z.string().max(200).optional(),
          })
          .nullable()
          .optional(),
      })
      .parse(req.body);
    const updated = store.updateGuardian(org.id, req.params.id, body);
    if (!updated) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Guardian not found" } });
    }
    const { guardianKey: _k, ...rest } = updated;
    res.json({ guardian: { ...rest, guardianKey: "pv_guardian_***" } });
  }, { ownerOnly: true }),
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

/** How many distinct approvals a payment needs before it executes — see policy-routes. */

// ------------------------------------------------------------- analytics

app.get(
  "/v1/guardian/vendors",
  guardianRoute((org, _req, res) => {
    res.json(vendorLedger(org.id));
  }),
);

/** Merchant directory metadata layered on known counterparties. */
app.get(
  "/v1/guardian/merchants",
  guardianRoute((org, _req, res) => {
    res.json({ merchants: store.listMerchants(org.id) });
  }),
);

app.post(
  "/v1/guardian/merchants",
  guardianRoute((org, req, res) => {
    const body = z
      .object({
        key: z.string().min(1),
        label: z.string().optional(),
        category: z.string().optional(),
        meta: z.record(z.unknown()).optional(),
      })
      .parse(req.body);
    const merchant = store.upsertMerchant({ orgId: org.id, ...body });
    store.addKnownCounterparty(org.id, body.key);
    res.json({ merchant });
  }, { ownerOnly: true }),
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

/** Replay real history against a proposed ruleset — see policy-routes. */

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
  guardianRoute(async (org, req, res) => {
    const body = z.object({ question: z.string().max(400) }).parse(req.body);
    const raw = answerQuestion(org.id, body.question);
    const answer = await presentAnswer(org.id, body.question, raw.answer);
    res.json({ answer, goto: raw.goto });
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
  guardianRoute(async (org, req, res) => {
    const body = z.object({ message: z.string().min(1).max(800) }).parse(req.body);
    // Load history before appending so follow-ups see prior assistant toolsUsed.
    const prior = store.listChatMessages(org.id, 24).map((m) => ({
      role: m.role,
      body: m.body,
      meta: m.meta,
    }));
    store.appendChatMessage({
      orgId: org.id,
      role: "user",
      kind: "text",
      body: body.message,
    });
    // ABI agent: read-only org survey + HITL external proposals. ABI_CHAT_AGENT=0 → legacy Q&A.
    const useAgent = process.env.ABI_CHAT_AGENT !== "0";
    const raw = useAgent
      ? await runAbiAgent(org.id, body.message, prior)
      : { ...answerQuestion(org.id, body.message), toolsUsed: [] as string[] };
    const text = await presentAnswer(org.id, body.message, raw.answer);
    const reply = store.appendChatMessage({
      orgId: org.id,
      role: "assistant",
      kind: "text",
      body: text,
      meta: {
        ...(raw.goto ? { goto: raw.goto } : {}),
        ...(raw.toolsUsed?.length ? { toolsUsed: raw.toolsUsed } : {}),
        ...("externalAction" in raw && raw.externalAction
          ? { externalAction: raw.externalAction }
          : {}),
        ...("via" in raw && raw.via ? { via: raw.via } : {}),
        ...("scratchpad" in raw && raw.scratchpad ? { scratchpad: raw.scratchpad } : {}),
        ...("intent" in raw && raw.intent ? { intent: raw.intent } : {}),
      },
    });
    res.json({
      reply,
      goto: raw.goto,
      toolsUsed: raw.toolsUsed ?? [],
      externalAction: "externalAction" in raw ? raw.externalAction : undefined,
      intent: "intent" in raw ? raw.intent : undefined,
      messages: store.listChatMessages(org.id),
    });
  }),
);

/** Resolve a HITL-gated external web action (queue stub — no browser yet). */
app.post(
  "/v1/guardian/chat/external-actions/:id/resolve",
  guardianRoute((org, req, res) => {
    const body = z.object({ approve: z.boolean(), messageId: z.string().optional() }).parse(req.body);
    const proposal = resolveExternalProposal(org.id, req.params.id, body.approve);
    if (!proposal) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "External action not found" } });
      return;
    }
    if (body.messageId) {
      store.patchChatMessageMeta(org.id, body.messageId, { externalAction: proposal });
    }
    const note = store.appendChatMessage({
      orgId: org.id,
      role: "assistant",
      kind: "system",
      body: body.approve
        ? `Approved ${proposal.action} on ${proposal.platform} — queued for browser execution (stub; nothing posted yet).`
        : `Rejected ${proposal.action} on ${proposal.platform} — no action taken.`,
      meta: { externalAction: proposal },
    });
    res.json({ proposal, note, messages: store.listChatMessages(org.id) });
  }),
);

/** Policy versions + restore — see policy-routes. */

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
        transferAvailable({
          orgId: org.id,
          journalId: id("j"),
          fromAvailableId: accountId("org", org.id),
          toAvailableId: accountId("agent", body.agentId),
          amountMicro: amount,
          memo: "allocate_stipend",
        }),
      ]);
      res.json({ ok: true, amountUsdc: body.amountUsdc });
    } catch (e) {
      res.status(400).json({ error: { code: "INSUFFICIENT_STIPEND", message: String(e) } });
    }
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
    const available = accounts.get(accountId("agent", body.agentId))?.balanceMicro ?? 0n;
    const held = accounts.get(accountId("agent", body.agentId, "held"))?.balanceMicro ?? 0n;
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
      transferAvailable({
        orgId: org.id,
        journalId: id("j"),
        fromAvailableId: accountId("agent", body.agentId),
        toAvailableId: accountId("org", org.id),
        amountMicro: amount,
        memo: "reclaim_stipend",
      }),
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
    const available = accounts.get(accountId("agent", body.fromAgentId))?.balanceMicro ?? 0n;
    const held = accounts.get(accountId("agent", body.fromAgentId, "held"))?.balanceMicro ?? 0n;
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
      transferAvailable({
        orgId: org.id,
        journalId: id("j"),
        fromAvailableId: accountId("agent", body.fromAgentId),
        toAvailableId: accountId("agent", body.toAgentId),
        amountMicro: amount,
        memo: "transfer_stipend",
      }),
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
      emitEvent(org.id, "agent.frozen", { agentId: body.agentId, reason: body.reason });
      void notify({
        kind: "agent.frozen",
        orgId: org.id,
        title: "Agent frozen",
        body: `${agent.name} frozen — ${body.reason}`,
        meta: { agentId: body.agentId },
      });
    } else {
      store.setOrgStatus(org.id, "frozen");
      void notify({
        kind: "agent.frozen",
        orgId: org.id,
        title: "Organization frozen",
        body: body.reason,
      });
    }
    store.addFreeze(org.id, body.agentId, body.reason);
    recordObs({ name: "freeze", orgId: org.id, agentId: body.agentId, attrs: { reason: body.reason } });
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
      emitEvent(org.id, "agent.unfrozen", { agentId: body.agentId });
    } else {
      store.setOrgStatus(org.id, "active");
      emitEvent(org.id, "agent.unfrozen", { org: true });
    }
    res.json({ ok: true });
  }, { ownerOnly: true }),
);

app.get(
  "/v1/guardian/activity",
  guardianRoute((org, req, res) => {
    const raw = typeof req.query.limit === "string" ? Number(req.query.limit) : 80;
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 200) : 80;
    res.json({ decisions: store.listDecisions(org.id, limit) });
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

/**
 * Books against the chain, rather than books against themselves.
 * See treasury-backing.ts for what "expected" means.
 */
/**
 * Where this org's financial data may go (P8-T2).
 *
 * The disclosure list is served alongside the setting so the console cannot
 * show a consent toggle without showing what is being consented to.
 */
app.get(
  "/v1/guardian/settings/ai",
  guardianRoute((org, _req, res) => {
    res.json({ ai: aiSettingsView(org.id), discloses: AI_EGRESS_DISCLOSURE });
  }),
);

app.put(
  "/v1/guardian/settings/ai",
  guardianRoute(
    (org, req, res) => {
      const body = z
        .object({
          mode: z.enum(["off", "platform", "byo"]).optional(),
          apiKey: z.string().max(200).nullable().optional(),
          baseUrl: z.string().max(300).nullable().optional(),
          model: z.string().max(80).nullable().optional(),
        })
        .parse(req.body);
      try {
        const ai = updateAiSettings(org.id, body);
        // Turning egress on or off is a data-protection decision. It belongs in
        // the audit trail next to policy changes, not only in a settings blob.
        recordObs({
          name: "ai.egress.changed",
          orgId: org.id,
          attrs: { mode: ai.mode, host: ai.egressHost ?? "none" },
        });
        res.json({ ai, discloses: AI_EGRESS_DISCLOSURE });
      } catch (e) {
        if (e instanceof AiSettingsError) {
          return res
            .status(400)
            .json({ error: { code: "VALIDATION_ERROR", message: e.message } });
        }
        throw e;
      }
    },
    { ownerOnly: true },
  ),
);

app.get(
  "/v1/guardian/reconcile/onchain",
  guardianRoute(async (org, _req, res) => {
    res.json({ backing: await reconcileOrgOnchain(org.id) });
  }),
);

/**
 * Integration / go-live status for the Settings screen.
 *
 * This endpoint is the product's own disclosure surface, so it must not
 * overstate. It previously reported `custody: "cdp"` and `cdpWired: true`
 * whenever CDP env vars were present, while the signer was a locally-held
 * private key — the console, and therefore the customer, were told their keys
 * were in Coinbase custody. The fields below say what is actually true.
 */
app.get(
  "/v1/guardian/setup",
  guardianRoute((_org, _req, res) => {
    let custodyName = "none";
    try {
      custodyName = getCustodyProvider().name;
    } catch {
      /* unregistered */
    }
    const network = process.env.CHAIN === "base" ? "base" : "base-sepolia";
    const productionMode = cdpEnvConfigured();
    res.json({
      setup: {
        custody: custodyName,
        // Every provider shipped today holds the key in this application.
        custodyModel: "self-custody",
        managedCustodyProvider: null,
        custodyDisclosure:
          "Vault keys are generated and held by this application, encrypted at rest under " +
          "ABI_KEK. They are NOT in Coinbase CDP, an HSM, or MPC custody: a compromise of both " +
          "the database and this process's environment still exposes them. Treat this deployment " +
          "as self-custodied.",
        network,
        settlement:
          custodyName === "self-custody"
            ? `onchain (self-custodied signer) · ${network}`
            : "mock (dev facilitator / transfer-mock)",
        productionMode,
        // Retained so older console builds keep rendering, but always false:
        // no Coinbase integration exists in this codebase.
        cdpApiKeyConfigured: productionMode,
        cdpWired: false,
        keysHashedAtRest: true,
        // AES-256-GCM under ABI_KEK, with the org id as authenticated data.
        vaultKeysEncryptedAtRest: true,
        // Serialised per vault so concurrent agent payments cannot collide on
        // the nonce and silently replace one another.
        outboundTransactionsSerialized: true,
        note:
          custodyName === "dev-local"
            ? "Dev custody. Set CDP_API_KEY_ID + CDP_API_KEY_SECRET to switch to production mode — still self-custodied."
            : "Production mode, self-custodied. Managed custody (Coinbase CDP Server Wallets) is not yet implemented.",
        telegram: telegramEnabled,
        rateLimitPerMin: RATE_LIMIT_PER_MIN,
        approvalTtlMinutes: APPROVAL_TTL_MINUTES,
      },
    });
  }),
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

    // Step-up: approving a large payment must require more than possession of
    // a live session. Only approvals are gated — a deny is always allowed to
    // proceed, because making it harder to stop money is the wrong asymmetry.
    if (body.approve) {
      const ctx = (req as express.Request & { guardianCtx?: GuardianCtx }).guardianCtx;
      const approval = store.getApproval(req.params.id, org.id);
      const threshold = stepUpThresholdMicro();
      if (
        approval &&
        threshold > 0n &&
        approval.amountMicro >= threshold &&
        ctx?.via === "session" &&
        !store.hasLiveStepUp(currentUser(req)?.sessionId ?? "")
      ) {
        return res.status(403).json({
          error: {
            code: "STEP_UP_REQUIRED",
            message:
              `Approving $${approval.amountUsdc} requires re-confirming your identity. ` +
              "POST /v1/auth/step-up, then retry.",
          },
          stepUp: {
            thresholdUsdc: (Number(threshold) / 1e6).toString(),
            amountUsdc: approval.amountUsdc,
          },
        });
      }
    }

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
      case "forbidden":
        return res.status(403).json({
          error: { code: "GUARDIAN_FORBIDDEN", message: outcome.message },
          approval: approvalView(outcome.approval),
        });
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

app.post(
  "/v1/guardian/webhooks/:id/rotate",
  guardianRoute((org, req, res) => {
    const secret = store.rotateWebhookSecret(req.params.id, org.id);
    if (!secret) return res.status(404).json({ error: { code: "NOT_FOUND" } });
    res.json({
      id: req.params.id,
      secret,
      note: "New signing secret shown once — update receivers before the next delivery.",
    });
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
  if (!requireAgentScope(auth, "read", res)) return;
  const map = store.getAccountMap(auth.orgId);
  const av = map.get(`agent:${auth.agentId}:available`);
  const held = map.get(`agent:${auth.agentId}:held`);
  const rules = rulesFor(auth.agentId, auth.orgId);
  const spent = store.spentLast24h(auth.agentId);
  const remaining = rules.dailyMaxMicro - spent;
  res.json({
    agentId: auth.agentId,
    agentName: store.getAgent(auth.agentId)?.name ?? auth.agentId,
    availableUsdc: formatMicroToUsdc(av?.balanceMicro ?? 0n),
    heldUsdc: formatMicroToUsdc(held?.balanceMicro ?? 0n),
    dailyRemainingUsdc: formatMicroToUsdc(remaining < 0n ? 0n : remaining),
    frozen: rules.agentFrozen || rules.orgFrozen,
  });
});

app.get("/v1/agent/activity", (req, res) => {
  const auth = authAgent(req);
  if (!auth) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
  if (!requireAgentScope(auth, "read", res)) return;
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  res.json({
    decisions: store.listDecisionsForAgent(auth.orgId, auth.agentId, limit),
  });
});

app.get("/v1/agent/decisions/:intentId", (req, res) => {
  const auth = authAgent(req);
  if (!auth) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
  if (!requireAgentScope(auth, "read", res)) return;
  const decision = store.getDecision(auth.orgId, req.params.intentId);
  if (!decision || decision.agentId !== auth.agentId) {
    return res.status(404).json({ error: { code: "NOT_FOUND" } });
  }
  res.json({ decision });
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
  if (!requireAgentScope(auth, "pay", res)) return;
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
  if (!requireAgentScope(auth, "read", res)) return;
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
    rulesFor(auth.agentId, auth.orgId, body.destination),
  );
  res.json(decision);
});

app.get("/v1/agent/approvals/:id", (req, res) => {
  const auth = authAgent(req);
  if (!auth) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
  if (!requireAgentScope(auth, "read", res)) return;
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
    if (!requireAgentScope(auth, "escrow", res)) return;
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
  if (!requireAgentScope(auth, "read", res)) return;
  sweepEscrowTimeouts();
  const escrow = store.getEscrow(req.params.id, auth.orgId);
  if (!escrow) return res.status(404).json({ error: { code: "NOT_FOUND" } });
  res.json({ escrow: escrowView(escrow) });
});

app.post("/v1/agent/escrow/:id/release", (req, res) => {
  const auth = authAgent(req);
  if (!auth) return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
  if (!requireAgentScope(auth, "escrow", res)) return;
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
  if (!requireAgentScope(auth, "escrow", res)) return;
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

/** Exported so tests can drive the API over an ephemeral port. */
export { app };

/**
 * Tests import `app` to drive it over an ephemeral port, so they suppress the
 * listener. Everything else — including every deployment — listens.
 */
const noListen = process.env.ABI_NO_LISTEN === "1";

/**
 * Background jobs run in-process by default, which is correct for the
 * single-instance topology. Set ABI_RUN_JOBS=0 when running `apps/worker`
 * alongside the API so the two do not compete for the same leases.
 */
const runJobsInProcess = process.env.ABI_RUN_JOBS !== "0";

if (!noListen) {
  if (runJobsInProcess) {
    startScheduler();
    startTelegramPolling();
  } else {
    console.log(
      JSON.stringify({
        type: "abi.jobs.delegated",
        note: "ABI_RUN_JOBS=0 — background jobs are expected from the worker process.",
      }),
    );
  }

  app.listen(PORT, () => {
    console.log(`ABI API on http://localhost:${PORT} (SQLite-backed, persistent process)`);
    console.log(LEGAL_FOOTER);
  });
}

export { closeDb, getDbPath } from "./store.js";
