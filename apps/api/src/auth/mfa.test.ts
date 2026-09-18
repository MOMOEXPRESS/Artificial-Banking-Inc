/**
 * Second factor, step-up on high-value approvals, and password recovery.
 *
 * Three properties matter most here, and each maps to a real failure:
 *   - A TOTP code must not work twice inside its 30-second window, or a
 *     shoulder-surfed code is reusable.
 *   - Approving a large payment must need more than a live session.
 *   - A reset token must be single-use and must evict existing sessions,
 *     otherwise the attacker who prompted the reset keeps their access.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-mfa-"));
process.env.POLICYVAULT_DB = join(dir, "mfa.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.ABI_STEP_UP_ABOVE_USDC = "100";

const { app } = await import("../index.js");
const { store } = await import("../store.js");
const { currentCode, generateSecret, verifyCode, otpauthUri } = await import("./totp.js");

let base = "";
let server: ReturnType<typeof app.listen>;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

class Jar {
  private jar = new Map<string, string>();
  absorb(res: Response) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const eq = pair!.indexOf("=");
      const k = pair!.slice(0, eq);
      const v = pair!.slice(eq + 1);
      if (v === "") this.jar.delete(k);
      else this.jar.set(k, v);
    }
  }
  header() {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  get csrf() {
    return decodeURIComponent(this.jar.get("abi_csrf") ?? "");
  }
}

async function call(
  path: string,
  opts: { method?: string; body?: unknown; jar?: Jar; orgId?: string } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.jar) {
    const cookie = opts.jar.header();
    if (cookie) headers.cookie = cookie;
    if (opts.jar.csrf) headers["x-abi-csrf"] = opts.jar.csrf;
  }
  if (opts.orgId) headers["x-abi-org"] = opts.orgId;
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  opts.jar?.absorb(res);
  return res;
}

const PASSWORD = "correct-horse-battery";
let seq = 0;
const uniqueEmail = () => `mfa${++seq}-${Date.now()}@example.com`;

async function newAccount(jar: Jar) {
  const email = uniqueEmail();
  const res = await call("/v1/auth/signup", {
    method: "POST",
    jar,
    body: { email, name: "MFA User", password: PASSWORD, orgName: "MFA Co" },
  });
  const body = (await res.json()) as { org: { id: string }; user: { id: string } };
  return { email, orgId: body.org.id, userId: body.user.id };
}

/** Enrol and confirm a factor; returns the shared secret. */
async function enableMfa(jar: Jar) {
  const enroll = await call("/v1/auth/mfa/enroll", { method: "POST", jar });
  const { secret } = (await enroll.json()) as { secret: string };
  const confirm = await call("/v1/auth/mfa/confirm", {
    method: "POST",
    jar,
    body: { code: currentCode(secret) },
  });
  assert.equal(confirm.status, 200);
  const { recoveryCodes } = (await confirm.json()) as { recoveryCodes: string[] };
  return { secret, recoveryCodes };
}

describe("TOTP", () => {
  it("accepts the current code and rejects a wrong one", () => {
    const secret = generateSecret();
    assert.equal(verifyCode(secret, currentCode(secret)).ok, true);
    assert.equal(verifyCode(secret, "000000").ok, false);
    assert.equal(verifyCode(secret, "12345").ok, false, "wrong length");
  });

  it("tolerates one step of clock drift in each direction", () => {
    const secret = generateSecret();
    const now = Date.now();
    assert.equal(verifyCode(secret, currentCode(secret, now - 30_000), { atMs: now }).ok, true);
    assert.equal(verifyCode(secret, currentCode(secret, now + 30_000), { atMs: now }).ok, true);
    assert.equal(verifyCode(secret, currentCode(secret, now - 120_000), { atMs: now }).ok, false);
  });

  it("refuses to replay a code inside its own window", () => {
    // A code is valid for a whole 30s window; without step tracking, one
    // observed over someone's shoulder works again immediately.
    const secret = generateSecret();
    const first = verifyCode(secret, currentCode(secret));
    assert.equal(first.ok, true);
    const replay = verifyCode(secret, currentCode(secret), {
      lastUsedStep: first.ok ? first.step : undefined,
    });
    assert.equal(replay.ok, false);
  });

  it("emits an otpauth URI an authenticator app can read", () => {
    const uri = otpauthUri("ABCDEFGHIJKLMNOP", "a@b.com");
    assert.match(uri, /^otpauth:\/\/totp\//);
    assert.match(uri, /secret=ABCDEFGHIJKLMNOP/);
    assert.match(uri, /digits=6/);
  });
});

describe("MFA enrolment", () => {
  it("is inactive until a code confirms it", async () => {
    const jar = new Jar();
    await newAccount(jar);

    const enroll = await call("/v1/auth/mfa/enroll", { method: "POST", jar });
    assert.equal(enroll.status, 200);

    const status = (await (await call("/v1/auth/mfa", { jar })).json()) as {
      enabled: boolean;
      pending: boolean;
    };
    assert.equal(status.enabled, false, "must not be active before confirmation");
    assert.equal(status.pending, true);
  });

  it("issues single-use recovery codes on confirmation", async () => {
    const jar = new Jar();
    await newAccount(jar);
    const { recoveryCodes } = await enableMfa(jar);
    assert.equal(recoveryCodes.length, 10);

    const status = (await (await call("/v1/auth/mfa", { jar })).json()) as {
      enabled: boolean;
      recoveryCodesRemaining: number;
    };
    assert.equal(status.enabled, true);
    assert.equal(status.recoveryCodesRemaining, 10);
  });

  it("rejects a bad confirmation code", async () => {
    const jar = new Jar();
    await newAccount(jar);
    await call("/v1/auth/mfa/enroll", { method: "POST", jar });
    const res = await call("/v1/auth/mfa/confirm", { method: "POST", jar, body: { code: "000000" } });
    assert.equal(res.status, 400);
  });

  it("requires the password to disable a factor", async () => {
    const jar = new Jar();
    await newAccount(jar);
    await enableMfa(jar);

    // Exactly what an attacker holding a stolen session would try first.
    const wrong = await call("/v1/auth/mfa/disable", {
      method: "POST",
      jar,
      body: { password: "not-it" },
    });
    assert.equal(wrong.status, 403);

    const right = await call("/v1/auth/mfa/disable", {
      method: "POST",
      jar,
      body: { password: PASSWORD },
    });
    assert.equal(right.status, 200);
  });

  /**
   * The same unhandled-rejection crash as the login route: these three handlers
   * are async, so a body Zod refuses used to take the process down rather than
   * answer 400.
   */
  it("answers 400 rather than dying on a malformed body", async () => {
    const jar = new Jar();
    await newAccount(jar);

    const cases: [string, unknown][] = [
      ["/v1/auth/mfa/disable", {}],
      ["/v1/auth/step-up", { code: 123 }],
      ["/v1/auth/password-reset/confirm", { newPassword: "a-long-enough-password" }],
    ];

    for (const [path, body] of cases) {
      const res = await call(path, { method: "POST", jar, body });
      assert.equal(res.status, 400, path);
      assert.equal(
        ((await res.json()) as { error: { code: string } }).error.code,
        "VALIDATION_ERROR",
        path,
      );
    }

    // Still serving: the process survived all three.
    assert.equal((await call("/v1/auth/mfa", { jar })).status, 200);
  });
});

describe("step-up on high-value approvals", () => {
  const PAYEE = "0x1111111111111111111111111111111111111111";

  /**
   * Park an approval directly so the test does not depend on rail behaviour.
   *
   * The policy must permit the payment, because `resolveApproval` re-evaluates
   * at execution time — otherwise every approval here would be refused by the
   * policy engine and the step-up assertions would pass for the wrong reason.
   */
  function park(orgId: string, amountMicro: bigint) {
    const t = store.getPolicyTemplate(orgId);
    store.setPolicyTemplate(orgId, {
      ...t,
      addressAllowlist: [PAYEE],
      perTxMaxMicro: 1_000_000_000n,
      dailyMaxMicro: 5_000_000_000n,
      hitlAboveMicro: 1_000_000n,
      newCounterpartyCooldownHours: 0,
    });
    store.addKnownCounterparty(orgId, PAYEE);
    const agent = store.createAgent(orgId, `Agent${Math.random().toString(16).slice(2, 8)}`);
    // Fund the agent so a permitted approval can actually settle. Signup
    // creates the org with zero float, so credit from `external` — a contra
    // account that may legitimately go negative.
    store.applyEntries(orgId, [
      {
        id: `j_${Math.random().toString(16).slice(2, 14)}`,
        orgId,
        memo: "seed",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `org:${orgId}:external`, deltaMicro: -amountMicro },
          { accountId: `agent:${agent.agentId}:available`, deltaMicro: amountMicro },
        ],
      },
    ]);
    const approval = {
      id: `apr_${Math.random().toString(16).slice(2, 14)}`,
      orgId,
      agentId: agent.agentId,
      intentId: `int_${Math.random().toString(16).slice(2, 14)}`,
      tool: "pay",
      amountMicro,
      amountUsdc: String(Number(amountMicro) / 1e6),
      destination: PAYEE,
      idempotencyKey: `k_${Math.random().toString(16).slice(2, 14)}`,
      ruleIds: ["hitl_above"],
      reasons: ["needs approval"],
      status: "pending" as const,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
    store.createApproval(approval);
    return approval;
  }

  it("refuses a large approval without a fresh second factor", async () => {
    const jar = new Jar();
    const { orgId } = await newAccount(jar);
    const approval = park(orgId, 500_000_000n); // $500, over the $100 threshold

    const res = await call(`/v1/guardian/approvals/${approval.id}/resolve`, {
      method: "POST",
      jar,
      orgId,
      body: { approve: true },
    });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "STEP_UP_REQUIRED");
    assert.equal(store.getApproval(approval.id, orgId)?.status, "pending", "must stay parked");
  });

  it("allows it after stepping up", async () => {
    const jar = new Jar();
    const { orgId } = await newAccount(jar);
    const approval = park(orgId, 500_000_000n);

    const step = await call("/v1/auth/step-up", {
      method: "POST",
      jar,
      body: { password: PASSWORD },
    });
    assert.equal(step.status, 200);

    const res = await call(`/v1/guardian/approvals/${approval.id}/resolve`, {
      method: "POST",
      jar,
      orgId,
      body: { approve: true },
    });
    assert.notEqual(res.status, 403, "step-up should have unlocked this");
    assert.notEqual(store.getApproval(approval.id, orgId)?.status, "pending");
  });

  it("does not gate small approvals", async () => {
    const jar = new Jar();
    const { orgId } = await newAccount(jar);
    const approval = park(orgId, 5_000_000n); // $5

    const res = await call(`/v1/guardian/approvals/${approval.id}/resolve`, {
      method: "POST",
      jar,
      orgId,
      body: { approve: true },
    });
    assert.notEqual(res.status, 403);
  });

  it("never gates a denial", async () => {
    // Making it harder to stop money is the wrong asymmetry.
    const jar = new Jar();
    const { orgId } = await newAccount(jar);
    const approval = park(orgId, 900_000_000n);

    const res = await call(`/v1/guardian/approvals/${approval.id}/resolve`, {
      method: "POST",
      jar,
      orgId,
      body: { approve: false },
    });
    assert.notEqual(res.status, 403);
    assert.equal(store.getApproval(approval.id, orgId)?.status, "denied");
  });

  it("requires a TOTP code, not a password, once MFA is enrolled", async () => {
    const jar = new Jar();
    await newAccount(jar);
    const { secret } = await enableMfa(jar);

    const withPassword = await call("/v1/auth/step-up", {
      method: "POST",
      jar,
      body: { password: PASSWORD },
    });
    assert.equal(withPassword.status, 400, "password alone must not satisfy step-up");

    // The confirmation code already burned its window, so use the next one —
    // exactly what a user does when the authenticator app rolls over.
    const withCode = await call("/v1/auth/step-up", {
      method: "POST",
      jar,
      body: { code: currentCode(secret, Date.now() + 30_000) },
    });
    assert.equal(withCode.status, 200);
  });

  it("accepts a recovery code, and burns it", async () => {
    const jar = new Jar();
    await newAccount(jar);
    const { recoveryCodes } = await enableMfa(jar);
    const code = recoveryCodes[0]!;

    assert.equal((await call("/v1/auth/step-up", { method: "POST", jar, body: { code } })).status, 200);
    // Single use: the same slip of paper must not work twice.
    assert.equal(
      (await call("/v1/auth/step-up", { method: "POST", jar, body: { code } })).status,
      403,
    );
  });
});

describe("password reset", () => {
  it("does not reveal whether an address is registered", async () => {
    const jar = new Jar();
    const { email } = await newAccount(jar);

    const known = await call("/v1/auth/password-reset/request", {
      method: "POST",
      body: { email },
    });
    const unknown = await call("/v1/auth/password-reset/request", {
      method: "POST",
      body: { email: uniqueEmail() },
    });
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
  });

  it("resets the password, evicts sessions, and burns the token", async () => {
    const jar = new Jar();
    const { email } = await newAccount(jar);
    assert.equal((await call("/v1/guardian/org", { jar })).status, 200);

    const request = await call("/v1/auth/password-reset/request", { method: "POST", body: { email } });
    const token = ((await request.json()) as { devResetToken: string }).devResetToken;
    assert.ok(token, "dev builds return the token since email is not configured");

    const NEW = "a-completely-new-password";
    const confirm = await call("/v1/auth/password-reset/confirm", {
      method: "POST",
      body: { token, newPassword: NEW },
    });
    assert.equal(confirm.status, 200);

    // Whoever prompted the reset must lose their access.
    assert.equal((await call("/v1/guardian/org", { jar })).status, 401);

    // Old password dead, new one works.
    assert.equal(
      (await call("/v1/auth/login", { method: "POST", body: { email, password: PASSWORD } })).status,
      401,
    );
    const fresh = new Jar();
    assert.equal(
      (await call("/v1/auth/login", { method: "POST", jar: fresh, body: { email, password: NEW } }))
        .status,
      200,
    );

    // Single use.
    assert.equal(
      (
        await call("/v1/auth/password-reset/confirm", {
          method: "POST",
          body: { token, newPassword: "yet-another-password" },
        })
      ).status,
      400,
    );
  });

  it("rejects a weak new password and an unknown token", async () => {
    const jar = new Jar();
    const { email } = await newAccount(jar);
    const request = await call("/v1/auth/password-reset/request", { method: "POST", body: { email } });
    const token = ((await request.json()) as { devResetToken: string }).devResetToken;

    assert.equal(
      (
        await call("/v1/auth/password-reset/confirm", {
          method: "POST",
          body: { token, newPassword: "short" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("/v1/auth/password-reset/confirm", {
          method: "POST",
          body: { token: "nope", newPassword: "a-valid-long-password" },
        })
      ).status,
      400,
    );
  });
});
