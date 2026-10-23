/**
 * Self-signup orgs on testnet must start in sandbox so simulated deposits and
 * remote MCP work for first-time users.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-signup-sandbox-"));
process.env.POLICYVAULT_DB = join(dir, "signup.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_KEK = Buffer.alloc(32, 7).toString("base64");
process.env.CHAIN = "base-sepolia";

const { store } = await import("../store.js");
const { hashPassword } = await import("./password.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("self-signup ledger mode", () => {
  before(() => {
    process.env.CHAIN = "base-sepolia";
  });

  it("creates a sandbox org on testnet when ledgerMode is requested", async () => {
    const created = store.createAccountWithOrg({
      email: `sandbox-${Date.now()}@example.com`,
      name: "Sandbox User",
      orgName: "Sandbox Co",
      passwordHash: await hashPassword("correct-horse-battery"),
      verificationToken: "tok-sandbox",
      verificationTtlMs: 60_000,
      ledgerMode: "sandbox",
    });
    assert.equal(created.status, "created");
    if (created.status !== "created") return;
    assert.equal(store.getOrgLedgerMode(created.orgId), "sandbox");
  });

  it("can still create a live empty org when explicitly requested", async () => {
    const created = store.createAccountWithOrg({
      email: `live-${Date.now()}@example.com`,
      name: "Live User",
      orgName: "Live Co",
      passwordHash: await hashPassword("correct-horse-battery"),
      verificationToken: "tok-live",
      verificationTtlMs: 60_000,
      ledgerMode: "live",
    });
    assert.equal(created.status, "created");
    if (created.status !== "created") return;
    assert.equal(store.getOrgLedgerMode(created.orgId), "live");
  });

  it("marks email verified when markEmailVerified is set", async () => {
    const created = store.createAccountWithOrg({
      email: `verified-${Date.now()}@example.com`,
      name: "Verified User",
      orgName: "Verified Co",
      passwordHash: await hashPassword("correct-horse-battery"),
      verificationToken: "tok-verified",
      verificationTtlMs: 60_000,
      ledgerMode: "sandbox",
      markEmailVerified: true,
    });
    assert.equal(created.status, "created");
    if (created.status !== "created") return;
    assert.ok(created.user.emailVerifiedAt);
  });
});
