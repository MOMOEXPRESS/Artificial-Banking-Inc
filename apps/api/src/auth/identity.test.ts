/**
 * Identity: accounts, sessions, memberships, invitations, CSRF.
 *
 * Before this there were no users. "Signing in" meant pasting a bearer key that
 * never expired, lived in browser localStorage, and could not be rotated — so
 * any XSS was permanent total compromise, a lost key was a lost organization,
 * and approvals recorded whatever display name the client sent.
 *
 * Driven over real HTTP so the cookie and CSRF behaviour is exercised as a
 * browser would meet it.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-identity-"));
process.env.POLICYVAULT_DB = join(dir, "identity.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";

const { app } = await import("../index.js");
const { hashPassword, passwordProblem, verifyPassword } = await import("./password.js");

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

/** Minimal cookie jar — enough to behave like a browser for these flows. */
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

  get(name: string) {
    return this.jar.get(name);
  }

  get csrf() {
    return decodeURIComponent(this.jar.get("abi_csrf") ?? "");
  }
}

async function call(
  path: string,
  opts: { method?: string; body?: unknown; jar?: Jar; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json", ...opts.headers };
  if (opts.jar) {
    const cookie = opts.jar.header();
    if (cookie) headers.cookie = cookie;
    if (opts.jar.csrf) headers["x-abi-csrf"] = opts.jar.csrf;
  }
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
const uniqueEmail = () => `user${++seq}-${Date.now()}@example.com`;

async function signup(jar: Jar, email = uniqueEmail(), orgName = "Acme") {
  const res = await call("/v1/auth/signup", {
    method: "POST",
    jar,
    body: { email, name: "Test User", password: PASSWORD, orgName },
  });
  return { res, email };
}

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const stored = await hashPassword(PASSWORD);
    assert.equal(await verifyPassword(PASSWORD, stored), true);
    assert.equal(await verifyPassword("wrong", stored), false);
  });

  it("produces a different hash each time (salted)", async () => {
    assert.notEqual(await hashPassword(PASSWORD), await hashPassword(PASSWORD));
  });

  it("returns false for malformed stored values instead of throwing", async () => {
    for (const bad of ["", "garbage", "s2:only:three", "s9:16384:8:1:aa:bb"]) {
      assert.equal(await verifyPassword(PASSWORD, bad), false);
    }
  });

  it("enforces a minimum length and rejects obvious passwords", () => {
    assert.ok(passwordProblem("short"));
    assert.ok(passwordProblem("password123"));
    assert.equal(passwordProblem(PASSWORD), null);
  });
});

describe("signup and login", () => {
  it("creates an account, an org, and an owner membership", async () => {
    const jar = new Jar();
    const { res } = await signup(jar);
    assert.equal(res.status, 201);
    const body = (await res.json()) as { org: { role: string } };
    assert.equal(body.org.role, "owner");
    assert.ok(jar.get("abi_session"), "session cookie issued");
    assert.ok(jar.get("abi_csrf"), "csrf cookie issued");
  });

  it("refuses a duplicate email", async () => {
    const jar = new Jar();
    const { email } = await signup(jar);
    const dup = await call("/v1/auth/signup", {
      method: "POST",
      body: { email, name: "Impostor", password: PASSWORD, orgName: "Other" },
    });
    assert.equal(dup.status, 409);
  });

  it("refuses a weak password", async () => {
    const res = await call("/v1/auth/signup", {
      method: "POST",
      body: { email: uniqueEmail(), name: "X", password: "short", orgName: "Y" },
    });
    assert.equal(res.status, 400);
  });

  it("gives the same answer for a wrong password and a missing account", async () => {
    // Distinguishing them turns the login form into an account-existence oracle.
    const jar = new Jar();
    const { email } = await signup(jar);

    const wrongPw = await call("/v1/auth/login", {
      method: "POST",
      body: { email, password: "not-the-password" },
    });
    const noSuchUser = await call("/v1/auth/login", {
      method: "POST",
      body: { email: uniqueEmail(), password: PASSWORD },
    });

    assert.equal(wrongPw.status, 401);
    assert.equal(noSuchUser.status, 401);
    assert.deepEqual(await wrongPw.json(), await noSuchUser.json());
  });

  it("signs in and reports memberships", async () => {
    const setup = new Jar();
    const { email } = await signup(setup, uniqueEmail(), "Sign In Co");

    const jar = new Jar();
    const res = await call("/v1/auth/login", { method: "POST", jar, body: { email, password: PASSWORD } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { orgs: { name: string; role: string }[] };
    assert.equal(body.orgs.length, 1);
    assert.equal(body.orgs[0]!.role, "owner");
  });
});

describe("malformed identity requests", () => {
  /**
   * These used to hang and then kill the process: Express 4 does not await an
   * `async` handler, so the Zod rejection escaped as an unhandled rejection and
   * Node exited. Any unauthenticated caller could restart the API at will.
   */
  const badLogins: [string, RequestInit][] = [
    ["missing password", { body: JSON.stringify({ email: "a@example.com" }) }],
    ["empty object", { body: "{}" }],
    ["email is not an email", { body: JSON.stringify({ email: "nope", password: "x" }) }],
    ["password is not a string", { body: JSON.stringify({ email: "a@example.com", password: 7 }) }],
    ["truncated JSON", { body: '{"email":' }],
    ["no body at all", {}],
  ];

  for (const [label, init] of badLogins) {
    it(`answers 400 for a login body with ${label}`, async () => {
      const res = await fetch(`${base}/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...init,
      });
      assert.equal(res.status, 400, label);
      const body = (await res.json()) as { error: { code: string; message?: string } };
      assert.equal(body.error.code, "VALIDATION_ERROR", label);
    });
  }

  it("answers 400 for a form-encoded login rather than parsing it", async () => {
    const res = await fetch(`${base}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=a@example.com&password=hunter2",
    });
    assert.equal(res.status, 400);
  });

  it("answers 400 for a malformed signup body", async () => {
    const res = await call("/v1/auth/signup", { method: "POST", body: { email: uniqueEmail() } });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "VALIDATION_ERROR");
  });

  it("still serves a real login afterwards", async () => {
    // The point of the block: the process is still up and the store intact.
    const setup = new Jar();
    const { email } = await signup(setup, uniqueEmail(), "Survivor Co");
    const res = await call("/v1/auth/login", { method: "POST", body: { email, password: PASSWORD } });
    assert.equal(res.status, 200);
  });
});

describe("sessions", () => {
  it("authorizes guardian routes with a cookie, no bearer key", async () => {
    const jar = new Jar();
    await signup(jar, uniqueEmail(), "Cookie Co");

    const res = await call("/v1/guardian/org", { jar });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { actor: { role: string } };
    assert.equal(body.actor.role, "owner");
  });

  it("rejects a request with no credential at all", async () => {
    assert.equal((await call("/v1/guardian/org")).status, 401);
  });

  it("stops working after logout", async () => {
    const jar = new Jar();
    await signup(jar, uniqueEmail(), "Logout Co");
    assert.equal((await call("/v1/guardian/org", { jar })).status, 200);

    await call("/v1/auth/logout", { method: "POST", jar });
    assert.equal((await call("/v1/guardian/org", { jar })).status, 401);
  });

  it("revokes every session when the password changes", async () => {
    const jar = new Jar();
    const { email } = await signup(jar, uniqueEmail(), "Rotate Co");

    // A second, independent session for the same user.
    const other = new Jar();
    await call("/v1/auth/login", { method: "POST", jar: other, body: { email, password: PASSWORD } });
    assert.equal((await call("/v1/guardian/org", { jar: other })).status, 200);

    const changed = await call("/v1/auth/change-password", {
      method: "POST",
      jar,
      body: { currentPassword: PASSWORD, newPassword: "a-brand-new-password-1" },
    });
    assert.equal(changed.status, 200);

    // A stolen session must not survive the action taken to contain it.
    assert.equal((await call("/v1/guardian/org", { jar: other })).status, 401);
  });

  it("refuses a password change without the current password", async () => {
    const jar = new Jar();
    await signup(jar, uniqueEmail(), "Guarded Co");
    const res = await call("/v1/auth/change-password", {
      method: "POST",
      jar,
      body: { currentPassword: "wrong", newPassword: "another-valid-password" },
    });
    assert.equal(res.status, 403);
  });
});

describe("CSRF", () => {
  it("rejects a cookie-authenticated mutation with no CSRF header", async () => {
    const jar = new Jar();
    await signup(jar, uniqueEmail(), "CSRF Co");

    // Cookies ride along automatically on a cross-site form post; the header
    // cannot be forged, so its absence must be fatal.
    const res = await fetch(`${base}/v1/guardian/freeze`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.header() },
      body: JSON.stringify({ reason: "csrf-attempt" }),
    });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "CSRF_FAILED");
  });

  it("allows the same mutation when the header matches the cookie", async () => {
    const jar = new Jar();
    await signup(jar, uniqueEmail(), "CSRF OK Co");
    const res = await call("/v1/guardian/freeze", { method: "POST", jar, body: { reason: "legit" } });
    assert.equal(res.status, 200);
  });

  it("does not require CSRF for reads", async () => {
    const jar = new Jar();
    await signup(jar, uniqueEmail(), "Read Co");
    const res = await fetch(`${base}/v1/guardian/org`, { headers: { cookie: jar.header() } });
    assert.equal(res.status, 200);
  });
});

describe("invitations and membership", () => {
  it("invites a colleague, who joins with the role they were given", async () => {
    const ownerJar = new Jar();
    const signupRes = await signup(ownerJar, uniqueEmail(), "Invite Co");
    const orgId = ((await signupRes.res.json()) as { org: { id: string } }).org.id;

    const inviteeEmail = uniqueEmail();
    const invite = await call(`/v1/auth/orgs/${orgId}/invitations`, {
      method: "POST",
      jar: ownerJar,
      body: { email: inviteeEmail, role: "viewer" },
    });
    assert.equal(invite.status, 201);
    const token = ((await invite.json()) as { invitationToken: string }).invitationToken;

    const inviteeJar = new Jar();
    const joined = await call("/v1/auth/signup", {
      method: "POST",
      jar: inviteeJar,
      body: {
        email: inviteeEmail,
        name: "Invited",
        password: PASSWORD,
        invitationToken: token,
      },
    });
    assert.equal(joined.status, 201);
    assert.equal(((await joined.json()) as { org: { role: string } }).org.role, "viewer");

    // The role is enforced, not merely recorded: viewers cannot move money.
    const denied = await call("/v1/guardian/freeze", {
      method: "POST",
      jar: inviteeJar,
      body: { reason: "should be refused" },
    });
    assert.equal(denied.status, 403);
  });

  it("refuses an invitation redeemed by a different email", async () => {
    const ownerJar = new Jar();
    const signupRes = await signup(ownerJar, uniqueEmail(), "Strict Invite Co");
    const orgId = ((await signupRes.res.json()) as { org: { id: string } }).org.id;

    const invite = await call(`/v1/auth/orgs/${orgId}/invitations`, {
      method: "POST",
      jar: ownerJar,
      body: { email: uniqueEmail(), role: "approver" },
    });
    const token = ((await invite.json()) as { invitationToken: string }).invitationToken;

    const res = await call("/v1/auth/signup", {
      method: "POST",
      body: { email: uniqueEmail(), name: "Wrong Person", password: PASSWORD, invitationToken: token },
    });
    assert.equal(res.status, 400);
  });

  it("refuses an unknown invitation token", async () => {
    const res = await call("/v1/auth/signup", {
      method: "POST",
      body: {
        email: uniqueEmail(),
        name: "Nobody",
        password: PASSWORD,
        invitationToken: "not-a-real-token",
      },
    });
    assert.equal(res.status, 400);
  });

  it("refuses to remove the last owner", async () => {
    const jar = new Jar();
    const signupRes = await signup(jar, uniqueEmail(), "Last Owner Co");
    const body = (await signupRes.res.json()) as { org: { id: string }; user: { id: string } };

    const res = await call(`/v1/auth/orgs/${body.org.id}/members/${body.user.id}`, {
      method: "DELETE",
      jar,
    });
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "LAST_OWNER");
  });

  it("keeps one org's members invisible to another org's owner", async () => {
    const a = new Jar();
    const aRes = await signup(a, uniqueEmail(), "Org A");
    const aOrg = ((await aRes.res.json()) as { org: { id: string } }).org.id;

    const b = new Jar();
    await signup(b, uniqueEmail(), "Org B");

    const res = await call(`/v1/auth/orgs/${aOrg}/members`, { jar: b });
    assert.equal(res.status, 403, "a non-member must not read another org's roster");
  });
});
