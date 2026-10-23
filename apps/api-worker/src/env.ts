/**
 * Copy Worker bindings into process.env so the existing Express/API code
 * (which reads process.env) keeps working inside the Durable Object.
 *
 * Never force NODE_ENV=development — wrangler deploy freezes production at build.
 */

const STRING_KEYS = [
  "CHAIN",
  "ABI_CONSOLE_URL",
  "ABI_CORS_ORIGINS",
  "ABI_NOTIFY_EMAIL_FROM",
  "ABI_RUNTIME",
  "ABI_NO_LISTEN",
  "ABI_RUN_JOBS",
  "POLICYVAULT_ALLOW_BOOTSTRAP",
  "BREVO_API_KEY",
  "RESEND_API_KEY",
  "ABI_KEK",
  "ABI_KEY_PEPPER",
  "ABI_SIGNUP_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "TELEGRAM_ALLOWED_USER_IDS",
  "TELEGRAM_WEBHOOK_SECRET",
  "CHAIN_RPC_URL",
  "ABI_ALLOW_UNVERIFIED_SIGNUP",
  "ABI_ALLOW_LOCAL_TARGETS",
  "ABI_SPIKE_ROUTES",
  "RATE_LIMIT_PER_MIN",
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
