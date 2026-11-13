import type express from "express";
const actions: Record<string, string> = {
  "/v1/auth/login": "buyer_login",
  "/v1/auth/signup": "buyer_signup",
  "/v1/partner/auth/login": "seller_login",
  "/v1/partner/auth/signup": "seller_signup",
};
export function challengeConfig() {
  const sitekey = process.env.TURNSTILE_SITEKEY?.trim();
  return { enabled: Boolean(sitekey || process.env.TURNSTILE_SECRET), sitekey: sitekey ?? null };
}
export async function verifyBotChallenge(
  token: unknown,
  action: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET?.trim();
  const hosts = (process.env.TURNSTILE_HOSTNAMES ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (
    !secret ||
    !hosts.length ||
    typeof token !== "string" ||
    token.length < 1 ||
    token.length > 2048
  )
    return false;
  if (
    process.env.NODE_ENV === "production" &&
    hosts.some((h) => h === "localhost" || h === "127.0.0.1")
  )
    return false;
  try {
    const res = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    const result = (await res.json()) as { success?: boolean; action?: string; hostname?: string };
    return (
      result.success === true &&
      result.action === action &&
      typeof result.hostname === "string" &&
      hosts.includes(result.hostname)
    );
  } catch {
    return false;
  }
}
export function registerBotChallenge(app: express.Express) {
  app.get("/v1/auth/challenge", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(challengeConfig());
  });
  app.use((req, res, next) => {
    const action = actions[req.path];
    if (req.method !== "POST" || !action || !challengeConfig().enabled) return next();
    void verifyBotChallenge(req.body?.challengeToken, action)
      .then((ok) => {
        if (!ok)
          return res
            .status(403)
            .json({
              error: {
                code: "BOT_VERIFICATION_REQUIRED",
                message: "Complete the security check and try again.",
              },
            });
        // Siteverify consumes each token. The browser resets its widget after every attempt.
        next();
      })
      .catch(next);
  });
}
