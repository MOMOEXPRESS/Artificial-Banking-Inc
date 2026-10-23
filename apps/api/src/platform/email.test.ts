import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  allowUnverifiedSignup,
  emailDeliveryConfigured,
  resolveConsoleUrl,
} from "./email.js";

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
});

describe("emailDeliveryConfigured", () => {
  it("is true when SMTP_URL is set", () => {
    delete process.env.RESEND_API_KEY;
    process.env.SMTP_URL = "smtp://user:pass@localhost:1025";
    assert.equal(emailDeliveryConfigured(), true);
  });

  it("is true when SMTP_HOST is set", () => {
    delete process.env.SMTP_URL;
    delete process.env.RESEND_API_KEY;
    process.env.SMTP_HOST = "smtp.gmail.com";
    assert.equal(emailDeliveryConfigured(), true);
  });

  it("is true when RESEND_API_KEY is set", () => {
    delete process.env.SMTP_URL;
    delete process.env.SMTP_HOST;
    process.env.RESEND_API_KEY = "re_test";
    assert.equal(emailDeliveryConfigured(), true);
  });

  it("is false when nothing is configured", () => {
    delete process.env.SMTP_URL;
    delete process.env.SMTP_HOST;
    delete process.env.RESEND_API_KEY;
    assert.equal(emailDeliveryConfigured(), false);
  });
});

describe("allowUnverifiedSignup", () => {
  it("defaults off", () => {
    delete process.env.ABI_ALLOW_UNVERIFIED_SIGNUP;
    assert.equal(allowUnverifiedSignup(), false);
  });

  it("allows the flag on testnet", () => {
    process.env.ABI_ALLOW_UNVERIFIED_SIGNUP = "1";
    process.env.CHAIN = "base-sepolia";
    assert.equal(allowUnverifiedSignup(), true);
  });

  it("refuses the flag on mainnet", () => {
    process.env.ABI_ALLOW_UNVERIFIED_SIGNUP = "1";
    process.env.CHAIN = "base";
    assert.equal(allowUnverifiedSignup(), false);
  });
});

describe("resolveConsoleUrl", () => {
  it("uses ABI_CONSOLE_URL when set", () => {
    process.env.ABI_CONSOLE_URL = "https://console.example/";
    assert.deepEqual(resolveConsoleUrl(), {
      ok: true,
      url: "https://console.example",
    });
  });

  it("fails loudly in production when unset", () => {
    delete process.env.ABI_CONSOLE_URL;
    process.env.NODE_ENV = "production";
    const result = resolveConsoleUrl();
    assert.equal(result.ok, false);
  });

  it("falls back to localhost outside production", () => {
    delete process.env.ABI_CONSOLE_URL;
    process.env.NODE_ENV = "test";
    assert.deepEqual(resolveConsoleUrl(), { ok: true, url: "http://localhost:3000" });
  });
});
