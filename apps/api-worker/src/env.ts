/**
 * Copy Worker bindings into process.env so the existing Express/API code
 * (which reads process.env) keeps working inside the Durable Object.
 *
 * NODE_ENV is always forced to production here; never set it to development.
 */

const STRING_KEYS = [
  "CHAIN",
  "ABI_CONSOLE_URL",
  "ABI_PUBLIC_API_URL",
  "ABI_CORS_ORIGINS",
  "ABI_NOTIFY_EMAIL_FROM",
  "ABI_RUNTIME",
  "ABI_NO_LISTEN",
  "ABI_RUN_JOBS",
  "POLICYVAULT_ALLOW_BOOTSTRAP",
  "POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE",
  "BREVO_API_KEY",
  "RESEND_API_KEY",
  "ABI_KEK",
  "ABI_KEY_PEPPER",
  "ABI_SIGNUP_TOKEN",
  "CHAIN_RPC_URL",
  "ABI_ALLOW_UNVERIFIED_SIGNUP",
  "ABI_ALLOW_LOCAL_TARGETS",
  "ABI_SPIKE_ROUTES",
  "RATE_LIMIT_PER_MIN",
  "RATE_LIMIT_READ_PER_MIN",
  "ABI_GIT_COMMIT",
  "OPENAI_API_KEY",
  "ABI_CHAT_LLM",
  "ABI_CHAT_AGENT",
  "POLICYVAULT_MOCK_TRANSFER",
  "X402_FACILITATOR_URL",
] as const;

export function applyWorkerEnv(env: Env): void {
  const bag = env as unknown as Record<string, unknown>;
  for (const key of STRING_KEYS) {
    const value = bag[key];
    if (typeof value === "string" && value.length > 0) {
      process.env[key] = value;
    }
  }
  // Worker runtime flags — always set for the DO-hosted API.
  // NODE_ENV must be set at runtime: wrangler only rewrites the literal
  // `process.env.NODE_ENV` at build time, but config.ts parses the whole
  // process.env object, so without this the deployed Worker ran in
  // non-production mode (production guards off, demo flags auto-on,
  // /v1/demo/status reported productionSafe:false).
  process.env.NODE_ENV = "production";
  process.env.ABI_RUNTIME = "cloudflare-workers";
  process.env.ABI_NO_LISTEN = "1";
  process.env.ABI_RUN_JOBS = "0";
  // SMTP is Node-only (#63). Clear so resolveEmailProvider never picks smtp
  // inside the Worker even if a stray var leaked in.
  delete process.env.SMTP_URL;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
}
