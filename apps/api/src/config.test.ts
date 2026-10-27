import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ConfigError, loadConfig, resetConfigForTests } from "./config.js";

afterEach(() => {
  resetConfigForTests();
});

const PROD_BASE = {
  NODE_ENV: "production",
  ABI_KEY_PEPPER: "p",
  ABI_KEK: "k",
  ABI_PUBLIC_API_URL: "https://api.abi.test",
} as const;

describe("loadConfig", () => {
  it("refuses production without a public https API URL", () => {
    const { ABI_PUBLIC_API_URL: _unset, ...withoutUrl } = PROD_BASE;
    for (const env of [
      withoutUrl,
      { ...PROD_BASE, ABI_PUBLIC_API_URL: "http://api.abi.test" },
      { ...PROD_BASE, ABI_PUBLIC_API_URL: "https://localhost:4000" },
    ]) {
      resetConfigForTests();
      assert.throws(
        () => loadConfig(env, { reload: true }),
        (e: unknown) => e instanceof ConfigError && /ABI_PUBLIC_API_URL/.test(e.message),
      );
    }
  });

  it("fails fast in production without pepper and KEK", () => {
    assert.throws(
      () =>
        loadConfig(
          {
            NODE_ENV: "production",
            PORT: "8787",
          },
          { reload: true },
        ),
      (e: unknown) => e instanceof ConfigError && /ABI_KEY_PEPPER/.test(e.message),
    );
  });

  it("refuses demo bootstrap in production without the unsafe escape hatch", () => {
    assert.throws(
      () =>
        loadConfig(
          {
            NODE_ENV: "production",
            ABI_KEY_PEPPER: "pepper",
            ABI_KEK: "kek",
            POLICYVAULT_ALLOW_BOOTSTRAP: "1",
          },
          { reload: true },
        ),
      (e: unknown) => e instanceof ConfigError && /BOOTSTRAP/.test(e.message),
    );
  });

  it("refuses mock transfer and local targets in production", () => {
    assert.throws(
      () =>
        loadConfig(
          {
            NODE_ENV: "production",
            ABI_KEY_PEPPER: "pepper",
            ABI_KEK: "kek",
            POLICYVAULT_MOCK_TRANSFER: "1",
          },
          { reload: true },
        ),
      ConfigError,
    );
    resetConfigForTests();
    assert.throws(
      () =>
        loadConfig(
          {
            NODE_ENV: "production",
            ABI_KEY_PEPPER: "pepper",
            ABI_KEK: "kek",
            ABI_ALLOW_LOCAL_TARGETS: "1",
          },
          { reload: true },
        ),
      ConfigError,
    );
  });

  it("allows disposable demo when ABI_ALLOW_UNSAFE_PROD=1", () => {
    const cfg = loadConfig(
      {
        NODE_ENV: "production",
        ABI_KEY_PEPPER: "pepper",
        ABI_KEK: "kek",
        POLICYVAULT_ALLOW_BOOTSTRAP: "1",
        ABI_ALLOW_UNSAFE_PROD: "1",
      },
      { reload: true },
    );
    assert.equal(cfg.allowBootstrap, true);
    assert.equal(cfg.isProduction, true);
  });

  it("uses a sensible default rate limit and approval TTL", () => {
    const dev = loadConfig({ NODE_ENV: "development" }, { reload: true });
    assert.equal(dev.rateLimitPerMin, 5000);
    assert.equal(dev.APPROVAL_TTL_MINUTES, 10);
    assert.equal(dev.allowBootstrap, true);
    resetConfigForTests();
    const prod = loadConfig(
      { ...PROD_BASE },
      { reload: true },
    );
    assert.equal(prod.rateLimitPerMin, 120);
    // Reads get their own, larger budget so console polling cannot starve itself.
    assert.equal(prod.rateLimitReadPerMin, 600);
    resetConfigForTests();
    const tuned = loadConfig(
      { ...PROD_BASE, RATE_LIMIT_PER_MIN: "200" },
      { reload: true },
    );
    assert.equal(tuned.rateLimitReadPerMin, 1000);
    resetConfigForTests();
    const explicit = loadConfig(
      { ...PROD_BASE, RATE_LIMIT_READ_PER_MIN: "300" },
      { reload: true },
    );
    assert.equal(explicit.rateLimitReadPerMin, 300);
  });
});
