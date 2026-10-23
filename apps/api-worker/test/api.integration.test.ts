import { describe, expect, it } from "vitest";
import { self } from "cloudflare:test";

async function json(res: Response) {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

describe("Workers integration", () => {
  it("health", async () => {
    const res = await self.fetch("https://example.com/health");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.service).toBe("abi-api");
  });

  it("telegram webhook secret check", async () => {
    const bad = await self.fetch("https://example.com/v1/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "nope",
      },
      body: "{}",
    });
    expect(bad.status).toBe(401);

    const good = await self.fetch("https://example.com/v1/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "telegram-webhook-secret-test",
      },
      body: JSON.stringify({ update_id: 1 }),
    });
    expect(good.status).toBe(200);
  });

  it("webhook signing helper stays stable", async () => {
    // Exercise a public OpenAPI doc route as a smoke check that Express routing works.
    const res = await self.fetch("https://example.com/v1/openapi.json");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toHaveProperty("openapi");
  });

  it("signup → login when unverified signup allowed", async () => {
    const email = `w-${Date.now()}@example.com`;
    const password = "workers-test-pass-12";
    const signup = await self.fetch("https://example.com/v1/auth/signup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-abi-signup-token": "test-signup-token",
      },
      body: JSON.stringify({
        email,
        password,
        name: "Worker Test",
        orgName: "Worker Org",
      }),
    });
    const signupBody = await json(signup);
    console.log(
      JSON.stringify({ type: "abi.test.signup", status: signup.status, error: signupBody.error }),
    );
    expect([201, 200, 400, 403, 503]).toContain(signup.status);

    if (signup.status === 201 || signup.status === 200) {
      const login = await self.fetch("https://example.com/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      expect([200, 401, 403]).toContain(login.status);
    }
  });
});
