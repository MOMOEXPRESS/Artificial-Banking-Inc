/**
 * Typed, validated process configuration.
 *
 * Loaded once at boot. In production, missing required secrets and unsafe
 * demo flags fail fast so a misconfigured deploy cannot mint credentials or
 * settle mock payments by accident.
 */
import { z } from "zod";

const bool01 = z
  .enum(["0", "1"])
  .optional()
  .transform((v) => v === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  POLICYVAULT_DB: z.string().min(1).optional(),
  ABI_KEY_PEPPER: z.string().optional(),
  POLICYVAULT_KEY_PEPPER: z.string().optional(),
  ABI_KEK: z.string().optional(),
  ABI_SIGNUP_TOKEN: z.string().optional(),
  ABI_CORS_ORIGINS: z.string().optional().default(""),
  ABI_CONSOLE_URL: z.string().optional(),
  ABI_RUN_JOBS: z.enum(["0", "1"]).optional(),
  ABI_NO_LISTEN: bool01,
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_READ_PER_MIN: z.coerce.number().int().positive().optional(),
  APPROVAL_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  CHAIN: z.string().default("base-sepolia"),
  CHAIN_RPC_URL: z.string().optional(),
  ABI_ONCHAIN_ENABLED: bool01,
  ABI_X402_NETWORKS: z.string().optional(),
  ABI_ALLOW_LOCAL_TARGETS: z.enum(["0", "1"]).optional(),
  ABI_COMPLIANCE_FAIL_CLOSED: z.enum(["0", "1"]).optional(),
  ABI_COMPLIANCE_DENYLIST: z.string().optional(),
  ABI_COMPLIANCE_WEBHOOK_URL: z.string().optional(),
  POLICYVAULT_ALLOW_BOOTSTRAP: z.enum(["0", "1"]).optional(),
  POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE: z.enum(["0", "1"]).optional(),
  POLICYVAULT_MOCK_TRANSFER: z.enum(["0", "1"]).optional(),
  ABI_DEMO_DERIVE_FROM_SIGNUP_TOKEN: z.enum(["0", "1"]).optional(),
  /** Escape hatch: allow unsafe demo flags in NODE_ENV=production (never for real funds). */
  ABI_ALLOW_UNSAFE_PROD: z.enum(["0", "1"]).optional(),
  ABI_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_ALLOWED_USER_IDS: z.string().optional(),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(8788),
});

export type AppConfig = z.infer<typeof envSchema> & {
  isProduction: boolean;
  isTest: boolean;
  corsOrigins: string[];
  rateLimitPerMin: number;
  /** Budget for safe (GET/HEAD) requests — the console polls ~15 reads per mutation. */
  rateLimitReadPerMin: number;
  keyPepperConfigured: boolean;
  kekConfigured: boolean;
  allowBootstrap: boolean;
  allowPublicOrgCreate: boolean;
  mockTransfer: boolean;
  runJobsInProcess: boolean;
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function parseEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`Invalid environment: ${detail}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === "production";
  const isTest = e.NODE_ENV === "test";
  const unsafeOk = e.ABI_ALLOW_UNSAFE_PROD === "1";

  const keyPepperConfigured = Boolean(e.ABI_KEY_PEPPER?.trim() || e.POLICYVAULT_KEY_PEPPER?.trim());
  const kekConfigured = Boolean(e.ABI_KEK?.trim());

  // Demo / destructive flags — auto-on only outside production.
  const allowBootstrap =
    e.POLICYVAULT_ALLOW_BOOTSTRAP === "1" ||
    (!isProduction && e.POLICYVAULT_ALLOW_BOOTSTRAP !== "0");
  const allowPublicOrgCreate =
    e.POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE === "1" ||
    (!isProduction && e.POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE !== "0");
  const mockTransfer = e.POLICYVAULT_MOCK_TRANSFER === "1";

  if (isProduction && !unsafeOk) {
    const problems: string[] = [];
    if (!keyPepperConfigured) {
      problems.push("ABI_KEY_PEPPER is required in production");
    }
    if (!kekConfigured) {
      problems.push("ABI_KEK is required in production");
    }
    if (e.POLICYVAULT_ALLOW_BOOTSTRAP === "1") {
      problems.push(
        "POLICYVAULT_ALLOW_BOOTSTRAP=1 is refused in production (set ABI_ALLOW_UNSAFE_PROD=1 to override for disposable demos)",
      );
    }
    if (e.POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE === "1") {
      problems.push(
        "POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE=1 is refused in production without ABI_ALLOW_UNSAFE_PROD=1",
      );
    }
    if (mockTransfer) {
      problems.push(
        "POLICYVAULT_MOCK_TRANSFER=1 is refused in production (would fake settlements)",
      );
    }
    if (e.ABI_ALLOW_LOCAL_TARGETS === "1") {
      problems.push("ABI_ALLOW_LOCAL_TARGETS=1 is refused in production (SSRF risk)");
    }
    if (e.ABI_DEMO_DERIVE_FROM_SIGNUP_TOKEN === "1") {
      problems.push(
        "ABI_DEMO_DERIVE_FROM_SIGNUP_TOKEN=1 is refused in production (one token must not derive pepper+KEK)",
      );
    }
    if (!e.ABI_SIGNUP_TOKEN?.trim() && allowPublicOrgCreate) {
      problems.push("ABI_SIGNUP_TOKEN is required when public org create is enabled");
    }
    if (problems.length) {
      throw new ConfigError(`Production configuration refused:\n- ${problems.join("\n- ")}`);
    }
  }

  const corsOrigins = (e.ABI_CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    ...e,
    ABI_LOG_LEVEL: e.ABI_LOG_LEVEL ?? (isTest ? "silent" : "info"),
    isProduction,
    isTest,
    corsOrigins,
    // Sensible prod default; keep the historical generous default for local/tests.
    rateLimitPerMin: e.RATE_LIMIT_PER_MIN ?? (isProduction ? 120 : 5000),
    // Reads get their own, larger bucket: one console tab polls ~60 reads/min at
    // rest and bursts ~25 after every mutation, which exhausted the shared 120/min
    // bucket and turned every poll into a 429 (the Oct 23 console crashes).
    rateLimitReadPerMin:
      e.RATE_LIMIT_READ_PER_MIN ??
      Math.max(600, (e.RATE_LIMIT_PER_MIN ?? (isProduction ? 120 : 5000)) * 5),
    keyPepperConfigured,
    kekConfigured,
    // In production without unsafe override, force demo flags off even if
    // someone omitted the env var (defaults above only auto-on outside prod).
    allowBootstrap: isProduction && !unsafeOk ? false : allowBootstrap,
    allowPublicOrgCreate: isProduction && !unsafeOk ? false : allowPublicOrgCreate,
    mockTransfer: isProduction && !unsafeOk ? false : mockTransfer,
    runJobsInProcess: e.ABI_RUN_JOBS !== "0",
  };
}

let cached: AppConfig | undefined;

/** Parse and cache config. Throws {@link ConfigError} on invalid/unsafe prod. */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { reload?: boolean },
): AppConfig {
  if (cached && !opts?.reload) return cached;
  cached = parseEnv(env);
  return cached;
}

/** Test helper — clear the memoized config. */
export function resetConfigForTests(): void {
  cached = undefined;
}

export function getConfig(): AppConfig {
  if (!cached) return loadConfig();
  return cached;
}
