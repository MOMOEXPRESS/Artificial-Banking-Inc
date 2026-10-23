import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  allowUnverifiedSignup,
  emailDeliveryConfigured,
  parseFromAddress,
  resolveConsoleUrl,
  resolveEmailProvider,
  sendEmail,
} from "./email.js";

const KEYS = [
  "BREVO_API_KEY",
  "RESEND_API_KEY",
  "SMTP_URL",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "ABI_NOTIFY_EMAIL_FROM",
  "ABI_CONSOLE_URL",
  "ABI_ALLOW_UNVERIFIED_SIGNUP",
  "ABI_EMAIL_TEST_SEND",
  "CHAIN",
  "NODE_ENV",
] as const;

const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

function snapshotEnv() {
  for (const key of KEYS) saved[key] = process.env[key];
}

function restoreEnv() {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

function clearProviders() {
  delete process.env.BREVO_API_KEY;
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_URL;
  delete process.env.SMTP_HOST;
}

snapshotEnv();
afterEach(() => {
  restoreEnv();
});

describe("resolveEmailProvider", () => {
  it("prefers Brevo over Resend and SMTP", () => {
    process.env.BREVO_API_KEY = "brevo-key";
    process.env.RESEND_API_KEY = "resend-key";
    process.env.SMTP_HOST = "smtp.example.com";
    assert.equal(resolveEmailProvider(), "brevo");
  });

  it("uses Resend when Brevo is unset", () => {
    clearProviders();
    process.env.RESEND_API_KEY = "resend-key";
    assert.equal(resolveEmailProvider(), "resend");
  });

  it("uses SMTP when neither HTTP provider is set", () => {
    clearProviders();
    process.env.SMTP_HOST = "smtp-relay.brevo.com";
    assert.equal(resolveEmailProvider(), "smtp");
  });

  it("returns null when nothing is configured", () => {
    clearProviders();
    assert.equal(resolveEmailProvider(), null);
    assert.equal(emailDeliveryConfigured(), false);
  });
});

describe("emailDeliveryConfigured", () => {
  it("is true for Brevo alone", () => {
    clearProviders();
    process.env.BREVO_API_KEY = "x";
    assert.equal(emailDeliveryConfigured(), true);
  });

  it("is true for Resend alone", () => {
    clearProviders();
    process.env.RESEND_API_KEY = "x";
    assert.equal(emailDeliveryConfigured(), true);
  });
});

describe("parseFromAddress", () => {
  it("parses Name <email> and bare email", () => {
    assert.deepEqual(parseFromAddress("ABI <ops@example.com>"), {
      name: "ABI",
      email: "ops@example.com",
    });
    assert.deepEqual(parseFromAddress("ops@example.com"), { email: "ops@example.com" });
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

describe("sendEmail provider selection", () => {
  it("POSTs to Brevo when BREVO_API_KEY is set", async () => {
    clearProviders();
    process.env.ABI_EMAIL_TEST_SEND = "1";
    process.env.BREVO_API_KEY = "brevo-test-key";
    process.env.ABI_NOTIFY_EMAIL_FROM = "ABI <sender@example.com>";

    const calls: { url: string; init: RequestInit }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ messageId: "msg-1" }), { status: 201 });
    }) as typeof fetch;

    try {
      const result = await sendEmail({
        to: "newuser@example.com",
        subject: "Verify",
        text: "Click here",
      });
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.provider, "brevo");
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.url, "https://api.brevo.com/v3/smtp/email");
      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.equal(headers["api-key"], "brevo-test-key");
      const body = JSON.parse(String(calls[0]!.init.body)) as {
        sender: { email: string; name?: string };
        to: { email: string }[];
        textContent: string;
      };
      assert.equal(body.sender.email, "sender@example.com");
      assert.equal(body.sender.name, "ABI");
      assert.equal(body.to[0]!.email, "newuser@example.com");
      assert.equal(body.textContent, "Click here");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("falls back to Resend when Brevo is unset", async () => {
    clearProviders();
    process.env.ABI_EMAIL_TEST_SEND = "1";
    process.env.RESEND_API_KEY = "re_test";
    process.env.ABI_NOTIFY_EMAIL_FROM = "ABI <sender@example.com>";

    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    }) as typeof fetch;

    try {
      const result = await sendEmail({
        to: "newuser@example.com",
        subject: "Verify",
        text: "Click here",
      });
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.provider, "resend");
      assert.equal(calls[0], "https://api.resend.com/emails");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("surfaces Brevo HTTP failures instead of succeeding silently", async () => {
    clearProviders();
    process.env.ABI_EMAIL_TEST_SEND = "1";
    process.env.BREVO_API_KEY = "brevo-test-key";
    process.env.ABI_NOTIFY_EMAIL_FROM = "sender@example.com";

    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: "invalid" }), { status: 401 })) as typeof fetch;

    try {
      const result = await sendEmail({
        to: "newuser@example.com",
        subject: "Verify",
        text: "Click here",
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "DELIVERY_FAILED");
        assert.match(result.error, /Brevo HTTP 401/);
      }
    } finally {
      globalThis.fetch = original;
    }
  });
});
