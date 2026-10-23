import { afterEach, describe, expect, it } from "vitest";
import { applyWorkerEnv } from "../src/env.js";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("applyWorkerEnv", () => {
  it("forces production so the API's production guards apply on Workers", () => {
    process.env.NODE_ENV = "development";
    applyWorkerEnv({ POLICYVAULT_ALLOW_BOOTSTRAP: "0" } as unknown as Env);
    expect(process.env.NODE_ENV).toBe("production");
    expect(process.env.ABI_RUNTIME).toBe("cloudflare-workers");
    expect(process.env.POLICYVAULT_ALLOW_BOOTSTRAP).toBe("0");
  });

  it("copies deploy metadata and drops Node-only SMTP settings", () => {
    process.env.SMTP_URL = "smtp://leak";
    applyWorkerEnv({ ABI_GIT_COMMIT: "a".repeat(40) } as unknown as Env);
    expect(process.env.ABI_GIT_COMMIT).toBe("a".repeat(40));
    expect(process.env.SMTP_URL).toBeUndefined();
  });

  it("does not forward Telegram bindings", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    applyWorkerEnv({ TELEGRAM_BOT_TOKEN: "x" } as unknown as Env);
    expect(process.env.TELEGRAM_BOT_TOKEN).toBeUndefined();
  });
});
