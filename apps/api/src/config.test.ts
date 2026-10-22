import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ConfigError, loadConfig, resetConfigForTests } from "./config.js";

afterEach(() => {
  resetConfigForTests();
});

describe("loadConfig", () => {
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
      { NODE_ENV: "production", ABI_KEY_PEPPER: "p", ABI_KEK: "k" },
      { reload: true },
    );
    assert.equal(prod.rateLimitPerMin, 120);
  });
});
