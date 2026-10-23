interface Env {
  ABI: DurableObjectNamespace;
  CHAIN: string;
  ABI_CONSOLE_URL: string;
  ABI_CORS_ORIGINS: string;
  ABI_NOTIFY_EMAIL_FROM: string;
  ABI_RUNTIME: string;
  ABI_NO_LISTEN: string;
  ABI_RUN_JOBS: string;
  POLICYVAULT_ALLOW_BOOTSTRAP: string;
  BREVO_API_KEY?: string;
  RESEND_API_KEY?: string;
  ABI_KEK?: string;
  ABI_KEY_PEPPER?: string;
  ABI_SIGNUP_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_ALLOWED_USER_IDS?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  CHAIN_RPC_URL?: string;
  ABI_ALLOW_UNVERIFIED_SIGNUP?: string;
}
