interface Env {
  ABI: DurableObjectNamespace;
  CHAIN: string;
  ABI_CONSOLE_URL: string;
  ABI_PUBLIC_API_URL: string;
  ABI_CORS_ORIGINS: string;
  ABI_NOTIFY_EMAIL_FROM: string;
  ABI_RUNTIME: string;
  ABI_NO_LISTEN: string;
  ABI_RUN_JOBS: string;
  POLICYVAULT_ALLOW_BOOTSTRAP: string;
  POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE?: string;
  ABI_GIT_COMMIT?: string;
  RATE_LIMIT_READ_PER_MIN?: string;
  BREVO_API_KEY?: string;
  RESEND_API_KEY?: string;
  ABI_KEK?: string;
  ABI_KEY_PEPPER?: string;
  ABI_SIGNUP_TOKEN?: string;
  CHAIN_RPC_URL?: string;
  ABI_ALLOW_UNVERIFIED_SIGNUP?: string;
  ABI_SPIKE_ROUTES?: string;
}

declare module "cloudflare:node" {
  export function handleAsNodeRequest(
    port: number | { port: number },
    request: Request,
  ): Promise<Response>;
  export function httpServerHandler(server: unknown): {
    fetch(request: Request, env?: unknown, ctx?: unknown): Promise<Response>;
  };
}
