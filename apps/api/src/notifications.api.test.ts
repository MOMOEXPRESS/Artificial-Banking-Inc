/**
 * Notification history: every emitted event lands in `notifications` (with or
 * without a webhook endpoint), the guardian feed + mark-read routes, action
 * events that never existed before, and Brevo notification email.
 * Mock rail only — no chain, no spend, no real email.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-notify-"));
process.env.POLICYVAULT_DB = join(dir, "notify.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";

const { store } = await import("./store.js");
const { app } = await import("./index.js");
const { emitEvent } = await import("./webhooks.js");
const notifications = await import("./notifications.js");
const { hashPassword } = await import("./auth/password.js");
const Database = (await import("better-sqlite3")).default;

let base = "";
let server: ReturnType<typeof app.listen>;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

type J = Record<string, any>;
async function call(
  path: string,
  key: string | null,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      "content-type": "application/json",
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as J };
}
const tick = () => new Promise((r) => setTimeout(r, 30));

let n = 0;
function newOrg() {
  return store.createOrg(`Notify Co ${++n}`, 1_000_000_000n);
}
const kinds = (orgId: string) => store.listNotifications(orgId, { limit: 100 }).map((r) => r.kind);

describe("notifications table", () => {
  it("emitEvent records a notification even with no webhook endpoint", () => {
    const org = newOrg();
    assert.equal(store.listWebhooks(org.id).length, 0);
    emitEvent(org.id, "payment.failed", {
      amountUsdc: "5",
      destination: "api.example.com",
      error: "rail down",
    });
    const [row] = store.listNotifications(org.id);
    assert.equal(row!.kind, "payment.failed");
    assert.equal(row!.severity, "bad");
    assert.equal(row!.link, "payments");
    assert.match(row!.title, /Payment failed · \$5/);
    assert.equal(row!.readAt, null);
  });

  it("records before webhook fan-out and still creates the delivery", () => {
    const org = newOrg();
    store.createWebhook(org.id, "https://hooks.example.com/abi");
    emitEvent(org.id, "policy.denied", { amountUsdc: "9", destination: "x.com" });
    assert.deepEqual(kinds(org.id), ["policy.denied"]);
    assert.equal(store.listDeliveries(org.id).length, 1);
  });

  it("dedupes the same event fired twice by notify() + emitEvent", () => {
    const org = newOrg();
    emitEvent(org.id, "approval.pending", {
      approvalId: "apr_1",
      amountUsdc: "3",
      destination: "a.com",
    });
    emitEvent(org.id, "approval.pending", {
      approvalId: "apr_1",
      amountUsdc: "3",
      destination: "a.com",
    });
    assert.equal(kinds(org.id).length, 1);
    assert.equal(store.listNotifications(org.id)[0]!.ref, "apr_1");
  });

  it("skips webhook test pings", () => {
    const org = newOrg();
    emitEvent(org.id, "payment.succeeded", { test: true, amountUsdc: "0" });
    assert.equal(kinds(org.id).length, 0);
  });

  it("describes expired approvals as expired, not as a vanished item", () => {
    const d = notifications.describeEvent("approval.resolved", {
      approvalId: "apr_9",
      status: "expired",
      resolvedBy: "system",
    });
    assert.equal(d.title, "Approval expired");
    assert.equal(d.severity, "info");
    assert.equal(d.link, "approvals");
  });

  it("describes unknown kinds without throwing", () => {
    const d = notifications.describeEvent("something.new", null);
    assert.equal(d.title, "something.new");
  });
});

describe("GET /v1/guardian/notifications", () => {
  it("paginates newest first with an unread count", async () => {
    const org = newOrg();
    for (let i = 0; i < 5; i++) emitEvent(org.id, "invoice.created", { amountUsdc: String(i + 1) });
    const p1 = await call("/v1/guardian/notifications?limit=2", org.guardianKey);
    assert.equal(p1.status, 200);
    assert.equal(p1.body.notifications.length, 2);
    assert.equal(p1.body.unreadCount, 5);
    assert.match(p1.body.notifications[0].title, /\$5/);
    const p2 = await call(
      `/v1/guardian/notifications?limit=2&before=${p1.body.nextBefore}`,
      org.guardianKey,
    );
    assert.match(p2.body.notifications[0].title, /\$3/);
  });

  it("marks one read, then all read", async () => {
    const org = newOrg();
    emitEvent(org.id, "invoice.created", { amountUsdc: "1" });
    emitEvent(org.id, "invoice.created", { amountUsdc: "2" });
    const list = await call("/v1/guardian/notifications", org.guardianKey);
    const one = await call(
      `/v1/guardian/notifications/${list.body.notifications[0].id}/read`,
      org.guardianKey,
      {},
    );
    assert.equal(one.status, 200);
    assert.equal(one.body.unreadCount, 1);
    const unread = await call("/v1/guardian/notifications?unread=1", org.guardianKey);
    assert.equal(unread.body.notifications.length, 1);
    const all = await call("/v1/guardian/notifications/read-all", org.guardianKey, {});
    assert.equal(all.body.marked, 1);
    const after2 = await call("/v1/guardian/notifications", org.guardianKey);
    assert.equal(after2.body.unreadCount, 0);
  });

  it("is org-scoped: another org cannot read or mark it", async () => {
    const a = newOrg();
    const b = newOrg();
    emitEvent(a.id, "invoice.created", { amountUsdc: "7" });
    const id = store.listNotifications(a.id)[0]!.id;
    const feed = await call("/v1/guardian/notifications", b.guardianKey);
    assert.equal(feed.body.notifications.length, 0);
    const mark = await call(`/v1/guardian/notifications/${id}/read`, b.guardianKey, {});
    assert.equal(mark.status, 404);
    assert.equal(store.countUnreadNotifications(a.id), 1);
  });

  it("requires a guardian credential", async () => {
    const r = await call("/v1/guardian/notifications", null);
    assert.equal(r.status, 401);
  });
});

describe("action events", () => {
  it("agent created, key rotated, key revoked", async () => {
    const org = newOrg();
    const budget = store.createDepartment(org.id, "Ops");
    const created = await call("/v1/guardian/agents", org.guardianKey, {
      name: "Scout",
      budgetId: budget.id,
    });
    assert.equal(created.status, 201);
    const agentId = created.body.agentId as string;
    assert.equal(
      (await call(`/v1/guardian/agents/${agentId}/rotate-key`, org.guardianKey, {})).status,
      200,
    );
    assert.equal(
      (await call(`/v1/guardian/agents/${agentId}/revoke-key`, org.guardianKey, {})).status,
      200,
    );
    await tick();
    const k = kinds(org.id);
    assert.ok(k.includes("agent.created"), k.join());
    assert.ok(k.includes("api_key.created"), k.join());
    assert.ok(k.includes("api_key.revoked"), k.join());
    const created1 = store.listNotifications(org.id).find((r) => r.kind === "agent.created")!;
    assert.match(created1.title, /Scout/);
  });

  it("failed requests raise nothing", async () => {
    const org = newOrg();
    const r = await call("/v1/guardian/agents", org.guardianKey, { name: "NoBudget" });
    assert.equal(r.status, 400);
    await tick();
    assert.equal(kinds(org.id).includes("agent.created"), false);
  });

  it("buyer policy changed (template)", async () => {
    const org = newOrg();
    const r = await call("/v1/guardian/policy/apply-template", org.guardianKey, {
      templateId: "swarm",
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await tick();
    assert.ok(kinds(org.id).includes("policy.changed"));
  });

  it("member invited (guardian key invite)", async () => {
    const org = newOrg();
    const r = await call("/v1/guardian/guardians", org.guardianKey, {
      name: "Ada",
      role: "viewer",
    });
    assert.equal(r.status, 201);
    await tick();
    const row = store.listNotifications(org.id).find((x) => x.kind === "member.invited");
    assert.ok(row);
    assert.match(row!.title, /viewer/);
  });

  it("playground run finished is raised once, on the transition", async () => {
    const org = newOrg();
    const run = (status: string) =>
      call(
        "/v1/guardian/runs/run_notify_1",
        org.guardianKey,
        {
          missionId: "m1",
          title: "Price check",
          status,
          startedAt: new Date().toISOString(),
          costUsdc: "0.10",
        },
        "PUT",
      );
    assert.equal((await run("running")).status, 200);
    assert.equal((await run("complete")).status, 200);
    assert.equal((await run("complete")).status, 200);
    await tick();
    const runs = store
      .listNotifications(org.id)
      .filter((x) => x.kind === "playground.run.finished");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.severity, "ok");
  });

  it("sign-in raises auth.signin for each of the user's orgs", async () => {
    const org = newOrg();
    const email = `owner${Date.now()}@example.com`;
    const user = store.createUser({
      email,
      name: "Owner",
      passwordHash: await hashPassword("correct horse battery"),
    });
    assert.ok(!("conflict" in user));
    store.addMembership((user as { id: string }).id, org.id, "owner");
    const raw = new Database(process.env.POLICYVAULT_DB!);
    raw.prepare("UPDATE users SET email_verified_at = created_at WHERE email = ?").run(email);
    raw.close();
    const r = await call("/v1/auth/login", null, { email, password: "correct horse battery" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await tick();
    assert.ok(kinds(org.id).includes("auth.signin"));
  });
});

describe("notification email (Brevo)", () => {
  it("defaults to the owner's email, honours the setting, sends only important kinds", async () => {
    const org = newOrg();
    const email = `boss${Date.now()}@example.com`;
    const user = store.createUser({ email, name: "Boss", passwordHash: "x" }) as { id: string };
    store.addMembership(user.id, org.id, "owner");
    assert.equal(notifications.notificationRecipient(org.id), email);

    const put = await call(
      "/v1/guardian/notification-settings",
      org.guardianKey,
      { email: "Alerts@Example.com" },
      "PUT",
    );
    assert.equal(put.status, 200);
    assert.equal(put.body.settings.effectiveRecipient, "alerts@example.com");

    const saved = { ...process.env };
    const realFetch = globalThis.fetch;
    const sent: { url: string; body: J }[] = [];
    const logs: string[] = [];
    const realWarn = console.warn;
    process.env.NODE_ENV = "test";
    process.env.ABI_EMAIL_TEST_SEND = "1";
    process.env.BREVO_API_KEY = "brevo-test-key-not-real";
    process.env.ABI_NOTIFY_EMAIL_FROM = "ABI <alerts@abi.example>";
    process.env.ABI_CONSOLE_URL = "https://console.example.com";
    console.warn = (...a: unknown[]) => void logs.push(a.join(" "));
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("https://api.brevo.com")) {
        sent.push({ url: u, body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ messageId: "m1" }), { status: 201 });
      }
      return realFetch(url, init);
    }) as typeof fetch;
    try {
      emitEvent(org.id, "payment.failed", { amountUsdc: "4", destination: "z.com" });
      emitEvent(org.id, "invoice.created", { amountUsdc: "4" });
      await tick();
      assert.equal(sent.length, 1, "only the important kind emails");
      assert.equal(sent[0]!.body.to[0].email, "alerts@example.com");
      assert.match(sent[0]!.body.subject, /Payment failed/);
      assert.match(sent[0]!.body.textContent ?? sent[0]!.body.htmlContent ?? "", /view=payments/);

      await call(
        "/v1/guardian/notification-settings",
        org.guardianKey,
        { emailEnabled: false },
        "PUT",
      );
      emitEvent(org.id, "policy.denied", { amountUsdc: "8", destination: "q.com" });
      await tick();
      assert.equal(sent.length, 1, "disabled = no email");
      assert.ok(!logs.join("\n").includes("brevo-test-key-not-real"));
    } finally {
      globalThis.fetch = realFetch;
      console.warn = realWarn;
      for (const k of [
        "NODE_ENV",
        "ABI_EMAIL_TEST_SEND",
        "BREVO_API_KEY",
        "ABI_NOTIFY_EMAIL_FROM",
        "ABI_CONSOLE_URL",
      ]) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  it("settings are owner-only to change", async () => {
    const org = newOrg();
    const viewer = store.createGuardian(org.id, "V", "viewer");
    const r = await call(
      "/v1/guardian/notification-settings",
      viewer.guardianKey,
      { emailEnabled: false },
      "PUT",
    );
    assert.equal(r.status, 403);
  });
});
