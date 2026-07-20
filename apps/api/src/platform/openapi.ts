/**
 * Minimal OpenAPI 3.1 document for the ABI HTTP surface.
 * Kept hand-authored beside the live Express routes so future SDK generators
 * (TypeScript / Python / Go / Rust) have a stable contract to target.
 * Expand fields as routes mature — do not invent endpoints that do not exist.
 */
export function openApiDocument(baseUrl = "http://localhost:8787") {
  return {
    openapi: "3.1.0",
    info: {
      title: "Artificial Banking Incorporated API",
      version: "0.1.0",
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
      "/health": {
        get: {
          tags: ["platform"],
          summary: "Liveness",
          responses: { "200": { description: "OK" } },
        },
      },
      "/v1/openapi.json": {
        get: {
          tags: ["platform"],
          summary: "OpenAPI document",
          responses: { "200": { description: "OpenAPI 3.1 JSON" } },
        },
      },
      "/v1/agent/budget": {
        get: {
          tags: ["agent"],
          summary: "Agent stipend + daily remaining",
          security: [{ agentBearer: [] }],
          responses: { "200": { description: "Budget snapshot" } },
        },
      },
      "/v1/agent/simulate": {
        post: {
          tags: ["agent"],
          summary: "Dry-run policy evaluation",
          security: [{ agentBearer: [] }],
          responses: { "200": { description: "Policy decision" } },
        },
      },
      "/v1/agent/pay": {
        post: {
          tags: ["agent"],
          summary: "Pay an address / vendor under policy",
          security: [{ agentBearer: [] }],
          responses: {
            "200": { description: "Settled" },
            "202": { description: "Needs approval" },
            "403": { description: "Denied" },
          },
        },
      },
      "/v1/agent/pay_api": {
        post: {
          tags: ["agent"],
          summary: "Pay an HTTP / x402 resource under policy",
          security: [{ agentBearer: [] }],
          responses: {
            "200": { description: "Settled" },
            "202": { description: "Needs approval" },
            "403": { description: "Denied" },
          },
        },
      },
      "/v1/guardian/org": {
        get: {
          tags: ["guardian"],
          summary: "Org, agents, balances",
          security: [{ guardianBearer: [] }],
          responses: { "200": { description: "Org view" } },
        },
      },
      "/v1/guardian/chat": {
        get: {
          tags: ["guardian"],
          summary: "In-app ABI Assistant transcript",
          security: [{ guardianBearer: [] }],
          responses: { "200": { description: "Chat messages" } },
        },
        post: {
          tags: ["guardian"],
          summary: "Ask the assistant / post a chat message",
          security: [{ guardianBearer: [] }],
          responses: { "200": { description: "Assistant reply" } },
        },
      },
      "/v1/guardian/approvals/{id}/resolve": {
        post: {
          tags: ["guardian"],
          summary: "Approve or deny a parked payment",
          security: [{ guardianBearer: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Resolved" } },
        },
      },
      "/v1/guardian/policy/versions": {
        get: {
          tags: ["guardian"],
          summary: "Policy version history",
          security: [{ guardianBearer: [] }],
          responses: { "200": { description: "Versions newest-first" } },
        },
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
        notifier: "apps/api/src/platform/notifier.ts",
        compliance: "apps/api/src/platform/compliance.ts",
        rails: "apps/api/src/rails/*",
        automation: "PolicyRules.automation",
        wallets: "WalletScope + LedgerAccountKind dept_/shared_",
      },
    },
  };
}
