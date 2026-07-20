/**
 * OpenAPI 3.1 document for the ABI HTTP surface.
 * Hand-authored beside live Express routes so future SDK generators
 * (TypeScript / Python / Go / Rust) have a stable contract to target.
 * Paths listed here must exist — do not invent endpoints.
 */
export function openApiDocument(baseUrl = "http://localhost:8787") {
  const bearer = (scheme: "agentBearer" | "guardianBearer") => [{ [scheme]: [] }];
  const ok = (description: string) => ({ "200": { description } });
  const stub = (
    tags: string[],
    summary: string,
    security: "agentBearer" | "guardianBearer" | null,
    responses: Record<string, { description: string }> = ok("OK"),
  ) => ({
    tags,
    summary,
    ...(security ? { security: bearer(security) } : {}),
    responses,
  });

  return {
    openapi: "3.1.0",
    info: {
      title: "Artificial Banking Incorporated API",
      version: "0.2.0",
      description:
        "Financial operating system for AI agents — policy-gated payments, budgets, approvals, and audit.",
    },
    servers: [{ url: baseUrl }],
    tags: [
      { name: "agent", description: "Agent money verbs (Bearer pv_agent_…)" },
      { name: "guardian", description: "Org operator surface (Bearer pv_guardian_…)" },
      { name: "platform", description: "Health, OpenAPI, demo bootstrap" },
    ],
    paths: {
      "/health": { get: stub(["platform"], "Liveness", null) },
      "/v1/openapi.json": { get: stub(["platform"], "OpenAPI document", null) },
      "/v1/demo/bootstrap": { post: stub(["platform"], "Create demo org", null, { "201": { description: "Created" } }) },

      "/v1/agent/budget": { get: stub(["agent"], "Agent stipend + daily remaining", "agentBearer") },
      "/v1/agent/simulate": { post: stub(["agent"], "Dry-run policy evaluation", "agentBearer") },
      "/v1/agent/pay": {
        post: stub(["agent"], "Pay an address / vendor under policy", "agentBearer", {
          "200": { description: "Settled" },
          "202": { description: "Needs approval" },
          "403": { description: "Denied" },
        }),
      },
      "/v1/agent/pay_api": {
        post: stub(["agent"], "Pay an HTTP / x402 resource under policy", "agentBearer", {
          "200": { description: "Settled" },
          "202": { description: "Needs approval" },
          "403": { description: "Denied" },
        }),
      },
      "/v1/agent/escrow/lock": { post: stub(["agent"], "Lock stipend into escrow", "agentBearer") },
      "/v1/agent/escrow/{id}/release": { post: stub(["agent"], "Release escrow to payee", "agentBearer") },
      "/v1/agent/escrow/{id}/refund": { post: stub(["agent"], "Refund escrow to payer", "agentBearer") },
      "/v1/agent/approvals/{id}": { get: stub(["agent"], "Poll parked approval", "agentBearer") },

      "/v1/guardian/org": { get: stub(["guardian"], "Org, agents, balances, settings", "guardianBearer") },
      "/v1/guardian/agents": {
        get: stub(["guardian"], "List agents (roster)", "guardianBearer"),
        post: stub(["guardian"], "Create agent", "guardianBearer", { "201": { description: "Created" } }),
      },
      "/v1/guardian/agents/{id}": {
        get: stub(["guardian"], "Agent detail — balances, activity, runs", "guardianBearer"),
        patch: stub(["guardian"], "Rename agent and/or merge profile", "guardianBearer"),
      },
      "/v1/guardian/agents/{id}/profile": { patch: stub(["guardian"], "Update agent profile JSON", "guardianBearer") },
      "/v1/guardian/agents/{id}/archive": { post: stub(["guardian"], "Archive agent (non-spendable)", "guardianBearer") },
      "/v1/guardian/agents/{id}/unarchive": { post: stub(["guardian"], "Restore archived agent + new key", "guardianBearer") },
      "/v1/guardian/agents/{id}/rotate-key": { post: stub(["guardian"], "Rotate agent API key", "guardianBearer") },
      "/v1/guardian/agents/{id}/revoke-key": { post: stub(["guardian"], "Revoke API key + session keys", "guardianBearer") },
      "/v1/guardian/agents/{id}/analytics": { get: stub(["guardian"], "Per-agent spend analytics", "guardianBearer") },
      "/v1/guardian/agents/{id}/freeze": { post: stub(["guardian"], "Freeze agent", "guardianBearer") },
      "/v1/guardian/agents/{id}/unfreeze": { post: stub(["guardian"], "Unfreeze agent", "guardianBearer") },
      "/v1/guardian/agents/{id}/session-keys": {
        post: stub(["guardian"], "Mint short-lived session key", "guardianBearer", { "201": { description: "Created" } }),
      },
      "/v1/guardian/agent-groups": {
        get: stub(["guardian"], "List agent groups", "guardianBearer"),
        post: stub(["guardian"], "Create agent group", "guardianBearer", { "201": { description: "Created" } }),
      },
      "/v1/guardian/agent-groups/{id}/archive": { post: stub(["guardian"], "Archive agent group", "guardianBearer") },
      "/v1/guardian/agent-groups/{id}/assign": { post: stub(["guardian"], "Assign agents to group", "guardianBearer") },
      "/v1/guardian/session-keys": { get: stub(["guardian"], "List session keys", "guardianBearer") },
      "/v1/guardian/session-keys/{id}/revoke": { post: stub(["guardian"], "Revoke session key", "guardianBearer") },
      "/v1/guardian/freezes": { get: stub(["guardian"], "Freeze / key-rotation audit log", "guardianBearer") },
      "/v1/guardian/runs": {
        get: stub(["guardian"], "List agent runs / missions", "guardianBearer"),
        put: stub(["guardian"], "Upsert run archive row", "guardianBearer"),
      },
      "/v1/guardian/runs/{id}": { get: stub(["guardian"], "Get run", "guardianBearer") },
      "/v1/guardian/allocate": { post: stub(["guardian"], "Allocate stipend org→agent", "guardianBearer") },
      "/v1/guardian/reclaim": { post: stub(["guardian"], "Reclaim stipend agent→org", "guardianBearer") },
      "/v1/guardian/transfer": { post: stub(["guardian"], "Transfer stipend agent→agent", "guardianBearer") },
      "/v1/guardian/freeze": { post: stub(["guardian"], "Freeze agent or org", "guardianBearer") },
      "/v1/guardian/unfreeze": { post: stub(["guardian"], "Unfreeze agent or org", "guardianBearer") },
      "/v1/guardian/policy": {
        get: stub(["guardian"], "Get active policy", "guardianBearer"),
        post: stub(["guardian"], "Update policy (incl. automation)", "guardianBearer"),
      },
      "/v1/guardian/policy/versions": { get: stub(["guardian"], "Policy version history", "guardianBearer") },
      "/v1/guardian/policy/versions/{id}/restore": {
        post: stub(["guardian"], "Restore a prior policy version", "guardianBearer"),
      },
      "/v1/guardian/policy/simulate": { post: stub(["guardian"], "Simulate proposed rules on history", "guardianBearer") },
      "/v1/guardian/policy/templates": { get: stub(["guardian"], "List starter policy templates", "guardianBearer") },
      "/v1/guardian/policy/apply-template": {
        post: stub(["guardian"], "Apply a starter policy template", "guardianBearer"),
      },
      "/v1/guardian/quorum": {
        get: stub(["guardian"], "Approval quorum settings", "guardianBearer"),
        post: stub(["guardian"], "Set approval quorum", "guardianBearer"),
      },
      "/v1/guardian/approvals": { get: stub(["guardian"], "List approvals", "guardianBearer") },
      "/v1/guardian/approvals/{id}/resolve": { post: stub(["guardian"], "Approve or deny parked payment", "guardianBearer") },
      "/v1/guardian/activity": { get: stub(["guardian"], "Decision / audit log", "guardianBearer") },
      "/v1/guardian/journals": { get: stub(["guardian"], "Ledger journals", "guardianBearer") },
      "/v1/guardian/metrics": { get: stub(["guardian"], "Treasury metrics", "guardianBearer") },
      "/v1/guardian/reconcile": { get: stub(["guardian"], "Reconciliation report", "guardianBearer") },
      "/v1/guardian/vendors": { get: stub(["guardian"], "Vendor spend ledger", "guardianBearer") },
      "/v1/guardian/merchants": {
        get: stub(["guardian"], "Merchant directory", "guardianBearer"),
        post: stub(["guardian"], "Upsert merchant metadata", "guardianBearer"),
      },
      "/v1/guardian/burn": { get: stub(["guardian"], "Burn-rate forecast", "guardianBearer") },
      "/v1/guardian/anomalies": { get: stub(["guardian"], "Spend anomalies", "guardianBearer") },
      "/v1/guardian/economics": { get: stub(["guardian"], "Job economics", "guardianBearer") },
      "/v1/guardian/summary": { get: stub(["guardian"], "Natural-language summary facts", "guardianBearer") },
      "/v1/guardian/ask": { post: stub(["guardian"], "Ask deterministic Q&A", "guardianBearer") },
      "/v1/guardian/chat": {
        get: stub(["guardian"], "ABI Chat transcript", "guardianBearer"),
        post: stub(["guardian"], "Post to ABI Chat", "guardianBearer"),
      },
      "/v1/guardian/webhooks": {
        get: stub(["guardian"], "List webhooks", "guardianBearer"),
        post: stub(["guardian"], "Register webhook", "guardianBearer"),
      },
      "/v1/guardian/subscriptions": {
        get: stub(["guardian"], "List subscriptions", "guardianBearer"),
        post: stub(["guardian"], "Create subscription", "guardianBearer"),
      },
      "/v1/guardian/invoices": {
        get: stub(["guardian"], "List invoices", "guardianBearer"),
        post: stub(["guardian"], "Create invoice", "guardianBearer"),
      },
      "/v1/guardian/setup": { get: stub(["guardian"], "Environment / custody setup hints", "guardianBearer") },
      "/v1/guardian/wallets": { get: stub(["guardian"], "Multi-wallet registry (org/dept/agent/shared)", "guardianBearer") },
      "/v1/guardian/wallets/move": { post: stub(["guardian"], "Unified treasury move (HITL above threshold)", "guardianBearer") },
      "/v1/guardian/departments": {
        get: stub(["guardian"], "List department treasuries", "guardianBearer"),
        post: stub(["guardian"], "Create department treasury", "guardianBearer", { "201": { description: "Created" } }),
      },
      "/v1/guardian/shared-wallets": {
        get: stub(["guardian"], "List shared wallets", "guardianBearer"),
        post: stub(["guardian"], "Create shared wallet", "guardianBearer", { "201": { description: "Created" } }),
      },
      "/v1/guardian/shared-wallets/{id}/members": {
        post: stub(["guardian"], "Set shared wallet members", "guardianBearer"),
      },
      "/v1/guardian/assets": { get: stub(["guardian"], "Asset registry (USDC)", "guardianBearer") },
      "/v1/guardian/treasury/deposit": { post: stub(["guardian"], "Deposit into org treasury", "guardianBearer") },
      "/v1/guardian/treasury/withdraw": { post: stub(["guardian"], "Withdraw from org treasury", "guardianBearer") },
      "/v1/guardian/treasury/cashflow": { get: stub(["guardian"], "Cash-flow series", "guardianBearer") },
      "/v1/guardian/treasury/forecast": { get: stub(["guardian"], "Treasury runway forecast", "guardianBearer") },
      "/v1/guardian/treasury/moves": { get: stub(["guardian"], "List treasury moves", "guardianBearer") },
      "/v1/guardian/treasury/moves/{id}/resolve": {
        post: stub(["guardian"], "Multi-sig resolve treasury move", "guardianBearer"),
      },
      "/v1/guardian/treasury/recovery": { get: stub(["guardian"], "Recovery log + vault address", "guardianBearer") },
      "/v1/guardian/treasury/recovery/rotate-vault": {
        post: stub(["guardian"], "Rotate org custody key", "guardianBearer"),
      },
      "/v1/guardian/treasury/recovery/rotate-agent-key": {
        post: stub(["guardian"], "Rotate agent API key (recovery)", "guardianBearer"),
      },
    },
    components: {
      securitySchemes: {
        agentBearer: { type: "http", scheme: "bearer", bearerFormat: "pv_agent_…" },
        guardianBearer: { type: "http", scheme: "bearer", bearerFormat: "pv_guardian_…" },
      },
    },
    "x-abi-platform": {
      pillars: [
        "treasury",
        "agents",
        "policies",
        "payments",
        "observability",
        "security",
        "ai",
        "developer",
        "enterprise",
        "ecosystem",
        "notifications",
        "automation",
        "compliance",
      ],
      extensionPoints: {
        custody: "@policyvault/custody CustodyProvider",
        rails: "apps/api/src/rails/types.ts PaymentRail",
        notifier: "apps/api/src/platform/notifier.ts",
        compliance: "apps/api/src/platform/compliance.ts CompositeScreener",
        automation: "PolicyRules.automation + matchedAutomationRules",
        wallets: "WalletScope + accountId() + transferAvailable()",
        observability: "apps/api/src/platform/observability.ts ObservabilitySink",
        ai: "apps/api/src/platform/ai.ts FactRephraser",
        merchants: "MerchantRecord / GET|POST /v1/guardian/merchants",
        orgSettings: "OrgRow.settings JSON",
      },
      moneySpine:
        "handleIntent → evaluatePolicy → executeIntent → PaymentRail.settle → ledger finalize",
    },
  };
}
