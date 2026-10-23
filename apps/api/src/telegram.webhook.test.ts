import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import express from "express";
import { registerTelegramWebhookRoute, resolveTelegramVoter } from "./telegram.js";

describe("Telegram webhook secret + voter seam", () => {
  const prevSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const prevAllow = process.env.TELEGRAM_ALLOWED_USER_IDS;

  before(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "unit-test-telegram-secret";
    process.env.TELEGRAM_ALLOWED_USER_IDS = "4242";
  });

  after(() => {
    if (prevSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
    else process.env.TELEGRAM_WEBHOOK_SECRET = prevSecret;
    if (prevAllow === undefined) delete process.env.TELEGRAM_ALLOWED_USER_IDS;
    else process.env.TELEGRAM_ALLOWED_USER_IDS = prevAllow;
  });

  it("resolveTelegramVoter allowlists configured users", () => {
    const ok = resolveTelegramVoter("org_x", "4242");
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.guardianId, "owner");

    const bad = resolveTelegramVoter("org_x", "9999");
    assert.equal(bad.ok, false);
  });

  it("rejects webhook requests with a bad secret token", async () => {
    const app = express();
    app.use(express.json());
    registerTelegramWebhookRoute(app);

    const server = await new Promise<import("node:http").Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}/v1/telegram/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "wrong",
        },
        body: JSON.stringify({ update_id: 1 }),
      });
      assert.equal(res.status, 401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("accepts webhook requests with the configured secret", async () => {
    const app = express();
    app.use(express.json());
    registerTelegramWebhookRoute(app);

    const server = await new Promise<import("node:http").Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}/v1/telegram/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "unit-test-telegram-secret",
        },
        body: JSON.stringify({ update_id: 1 }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok?: boolean };
      assert.equal(body.ok, true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
