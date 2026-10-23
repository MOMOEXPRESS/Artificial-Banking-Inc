/**
 * Console-side env reads. Server-only values must never be NEXT_PUBLIC_*.
 */
import { z } from "zod";

const serverSchema = z.object({
  ABI_API_ORIGIN: z.string().url().optional(),
  POLICYVAULT_API_URL: z.string().url().optional(),
  ABI_SIGNUP_TOKEN: z.string().optional(),
  VERCEL: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
});

export type WebServerEnv = z.infer<typeof serverSchema>;

/** Validate server env used by the /abi-api proxy (fail soft — proxy has its own messages). */
export function readWebServerEnv(env: NodeJS.ProcessEnv = process.env): WebServerEnv {
  const parsed = serverSchema.safeParse(env);
  if (!parsed.success) {
    // Do not throw at import time on Vercel — missing origin is a 503 from the proxy.
    return {
      ABI_API_ORIGIN: env.ABI_API_ORIGIN,
      POLICYVAULT_API_URL: env.POLICYVAULT_API_URL,
      ABI_SIGNUP_TOKEN: env.ABI_SIGNUP_TOKEN,
      VERCEL: env.VERCEL,
      NODE_ENV: env.NODE_ENV as WebServerEnv["NODE_ENV"],
    };
  }
  return parsed.data;
}
