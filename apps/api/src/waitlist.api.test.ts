/**
 * Public waitlist: validation, idempotent joins with no enumeration, honeypot,
 * per-IP rate limit, owner alert (once per new signup, capped, never blocking),
 * and the admin-only list + CSV export. No real email is sent: Brevo is
 * stubbed at the fetch layer.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { after, afterEach, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-waitlist-"));
process.env.POLICYVAULT_DB = join(dir, "waitlist.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";
process.env.ABI_WAITLIST_LIMIT_PER_HOUR = "1000";
process.env.ABI_NOTIFY_EMAIL_FROM = "ABI <founder@example.com>";
delete process.env.ABI_WAITLIST_NOTIFY_TO;
delete process.env.ABI_WAITLIST_ADMINS;

const { store } = await import("./store.js");
const { app } = await import("./index.js");
const waitlist = await import("./waitlist.js");

// ---- Brevo stub: record every alert, pass everything else through.
const realFetch = globalThis.fetch;
const sent: { to: string; subject: string; text: string }[] = [];
let brevoMode: "ok" | "fail" | "hang" = "ok";
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  if (u.startsWith("https://api.brevo.com")) {
    const body = JSON.parse(String(init?.body));
    sent.push({ to: body.to[0].email, subject: body.subject, text: body.textContent });
    if (brevoMode === "hang") return new Promise<Response>(() => {});
    if (brevoMode === "fail") return new Response("nope", { status: 500 });
    return new Response("{}", { status: 201 });
  }
  return realFetch(url as string, init);
}) as typeof fetch;

let base = "";
let server: ReturnType<typeof app.listen>;
before(async () => {
  process.env.ABI_EMAIL_TEST_SEND = "1";
  process.env.BREVO_API_KEY = "brevo-test-key-not-real";
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  globalThis.fetch = realFetch;
  delete process.env.ABI_EMAIL_TEST_SEND;
  delete process.env.BREVO_API_KEY;
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  brevoMode = "ok";
  process.env.ABI_WAITLIST_LIMIT_PER_HOUR = "1000";
  delete process.env.ABI_WAITLIST_NOTIFY_PER_HOUR;
  delete process.env.ABI_WAITLIST_NOTIFY_TO;
  waitlist.__resetWaitlistRateLimitForTests();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(
  path: string,
  key: string | null,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: Json; text: string; headers: Headers }> {
  const res = await realFetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(key && { authorization: `Bearer ${key}` }),
      "content-type": "application/json",
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed: Json = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* csv */
  }
  return { status: res.status, body: parsed, text, headers: res.headers };
}

const join_ = (body: Record<string, unknown>) => call("/v1/public/waitlist", null, body);
const tick = () => new Promise((r) => setTimeout(r, 30));
let n = 0;
const addr = (tag = "x") => `${tag}.${++n}.${Date.now()}@Example.COM`;
const rows = () => store.listWaitlist({ limit: 10_000 });

/** Org whose verified owner has `email`. */
function ownedOrg(email: string, verified = true) {
  const org = store.createOrg(`Waitlist Co ${++n}`, 0n);
  const user = store.createUser({ email, name: "Owner", passwordHash: "x" }) as { id: string };
  store.addMembership(user.id, org.id, "owner");
  if (verified) {
    const raw = new Database(process.env.POLICYVAULT_DB!);
    raw.prepare("UPDATE users SET email_verified_at = created_at WHERE id = ?").run(user.id);
    raw.close();
  }
  return org;
}

describe("POST /v1/public/waitlist", () => {
  it("stores a new email lowercased with source and referrer, no auth needed", async () => {
    const email = addr("New");
    const r = await join_({
      email: `  ${email} `,
      source: "landing",
      referrer: "https://news.ycombinator.com/item?id=1",
    });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body, { ...waitlist.WAITLIST_JOINED });
    const row = rows().find((x) => x.email === email.toLowerCase());
    assert.ok(row, "stored lowercased");
    assert.equal(row!.source, "landing");
    assert.equal(row!.referrer, "https://news.ycombinator.com/item?id=1");
    const raw = new Database(process.env.POLICYVAULT_DB!);
    const ipHash = raw.prepare("SELECT ip_hash FROM waitlist WHERE email = ?").get(row!.email) as {
      ip_hash: string;
    };
    raw.close();
    assert.ok(ipHash.ip_hash && !ipHash.ip_hash.includes("127.0.0.1"), "IP kept only as a hash");
  });

  it("re-joining returns the same success and never duplicates (no enumeration)", async () => {
    const email = addr("again");
    const first = await join_({ email });
    const second = await join_({ email: email.toUpperCase() });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, first.body, "identical answer for new and existing");
    assert.equal(rows().filter((x) => x.email === email.toLowerCase()).length, 1);
  });

  it("rejects invalid emails with a clear 400", async () => {
    for (const bad of [
      "",
      "nope",
      "a@b",
      "two@@example.com",
      "x@exa mple.com",
      42,
      `${"a".repeat(250)}@example.com`,
    ]) {
      const r = await join_({ email: bad });
      assert.equal(r.status, 400, `accepted ${String(bad)}`);
      assert.equal(r.body.error.code, "INVALID_EMAIL");
    }
  });

  it("a filled honeypot answers success and stores nothing", async () => {
    const email = addr("bot");
    const before = store.countWaitlist();
    const r = await join_({ email, website: "http://spam.example" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ...waitlist.WAITLIST_JOINED });
    assert.equal(store.countWaitlist(), before);
    assert.ok(!rows().some((x) => x.email === email.toLowerCase()));
  });

  it("rate-limits per IP", async () => {
    process.env.ABI_WAITLIST_LIMIT_PER_HOUR = "3";
    waitlist.__resetWaitlistRateLimitForTests();
    for (let i = 0; i < 3; i++) assert.equal((await join_({ email: addr("rl") })).status, 200);
    const blocked = await join_({ email: addr("rl") });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, "RATE_LIMITED");
  });
});

describe("owner alert email", () => {
  it("emails the operator once per new signup with the total, not on re-joins", async () => {
    sent.length = 0;
    const email = addr("alert");
    await join_({ email });
    await tick();
    await join_({ email });
    await tick();
    const mine = sent.filter((m) => m.subject.includes(email.toLowerCase()));
    assert.equal(mine.length, 1, "one alert, none for the repeat join");
    assert.equal(mine[0]!.to, "founder@example.com", "falls back to the sender address");
    assert.equal(mine[0]!.subject, `New ABI waitlist signup: ${email.toLowerCase()}`);
    assert.match(mine[0]!.text, new RegExp(`Total on the waitlist: ${store.countWaitlist()}`));
    assert.equal(rows().find((x) => x.email === email.toLowerCase())!.notifyStatus, "sent");
  });

  it("uses ABI_WAITLIST_NOTIFY_TO when set", async () => {
    process.env.ABI_WAITLIST_NOTIFY_TO = "alerts@example.org";
    sent.length = 0;
    await join_({ email: addr("to") });
    await tick();
    assert.equal(sent[0]?.to, "alerts@example.org");
  });

  it("caps alerts per hour", async () => {
    process.env.ABI_WAITLIST_NOTIFY_PER_HOUR = String(
      store.countWaitlistNotifiedSince(new Date(Date.now() - 3_600_000).toISOString()) + 1,
    );
    sent.length = 0;
    const a = addr("cap");
    const b = addr("cap");
    await join_({ email: a });
    await tick();
    await join_({ email: b });
    await tick();
    assert.equal(sent.length, 1);
    assert.equal(rows().find((x) => x.email === b.toLowerCase())!.notifyStatus, "capped");
    assert.equal(store.countWaitlist() > 0, true);
  });

  it("a failing or hanging email never fails or blocks the signup", async () => {
    brevoMode = "fail";
    const failed = addr("fail");
    const r1 = await join_({ email: failed });
    assert.equal(r1.status, 200);
    await tick();
    assert.match(rows().find((x) => x.email === failed.toLowerCase())!.notifyStatus!, /^failed:/);

    brevoMode = "hang";
    const started = Date.now();
    const r2 = await join_({ email: addr("hang") });
    assert.equal(r2.status, 200);
    assert.ok(Date.now() - started < 2_000, "the join did not wait for the email");
  });
});

describe("admin list and CSV export", () => {
  it("the verified admin owner sees the total, entries and a CSV", async () => {
    const admin = ownedOrg("founder@example.com");
    await join_({ email: "=cmd@example.com", source: "hn" });
    const access = await call("/v1/guardian/waitlist/access", admin.guardianKey);
    assert.deepEqual(access.body, { allowed: true });

    const list = await call("/v1/guardian/waitlist", admin.guardianKey);
    assert.equal(list.status, 200, list.text);
    assert.equal(list.body.total, store.countWaitlist());
    assert.ok(
      list.body.entries.some((e: Json) => e.email === "=cmd@example.com" && e.source === "hn"),
    );
    assert.ok(list.body.entries[0].createdAt);

    const csv = await call("/v1/guardian/waitlist.csv", admin.guardianKey);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(
      csv.headers.get("content-disposition") ?? "",
      /attachment; filename="abi-waitlist-/,
    );
    const lines = csv.text.trim().split("\n");
    assert.equal(lines[0], "email,joined_at,source,referrer");
    assert.equal(lines.length - 1, store.countWaitlist());
    assert.ok(
      lines.some((l) => l.startsWith(`"'=cmd@example.com"`)),
      "formula neutralised",
    );
  });

  it("other owners, unverified admins, approvers and anonymous callers cannot read it", async () => {
    const other = ownedOrg(`someone${++n}@example.com`);
    const unverified = store.createOrg(`Unverified ${++n}`, 0n);
    const u = store.createUser({ email: "founder2@example.com", name: "x", passwordHash: "x" }) as {
      id: string;
    };
    store.addMembership(u.id, unverified.id, "owner");
    process.env.ABI_WAITLIST_ADMINS = "founder2@example.com";
    try {
      for (const org of [other, unverified]) {
        assert.deepEqual((await call("/v1/guardian/waitlist/access", org.guardianKey)).body, {
          allowed: false,
        });
        assert.equal((await call("/v1/guardian/waitlist", org.guardianKey)).status, 403);
        assert.equal((await call("/v1/guardian/waitlist.csv", org.guardianKey)).status, 403);
      }
    } finally {
      delete process.env.ABI_WAITLIST_ADMINS;
    }
    const admin = ownedOrg(`founder${++n}@example.com`);
    const approver = store.createGuardian(admin.id, "Approver", "approver") as {
      guardianKey: string;
    };
    process.env.ABI_WAITLIST_ADMINS = `founder${n}@example.com`;
    try {
      assert.equal((await call("/v1/guardian/waitlist", approver.guardianKey)).status, 403);
    } finally {
      delete process.env.ABI_WAITLIST_ADMINS;
    }
    assert.equal((await call("/v1/guardian/waitlist", null)).status, 401);
    assert.equal((await call("/v1/guardian/waitlist.csv", null)).status, 401);
  });
});
