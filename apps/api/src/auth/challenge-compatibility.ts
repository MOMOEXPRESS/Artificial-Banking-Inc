import type express from "express";

/** Historical deployed clients ask this before sign-in. CAPTCHA is removed. */
export function registerAuthChallengeCompatibility(app: express.Express) {
  app.get("/v1/auth/challenge", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ enabled: false, sitekey: null });
  });
}
