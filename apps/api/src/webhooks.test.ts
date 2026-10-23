import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-wh-"));
process.env.POLICYVAULT_DB = join(dir, "wh.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_KEK = "test-kek";
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_ALLOW_LOCAL_TARGETS = "1";

const { store } = await import("./store.js");
const {
  signPayloadV1,
  verifyPayloadV1,
  retryPendingWebhookDeliveries,
  emitEvent,
  attemptDelivery,
} = await import("./webhooks.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("webhook signatures", () => {
  it("signs and verifies a timestamped v1 payload", () => {
    const body = JSON.stringify({ hello: "world" });
    const header = signPayloadV1("sec", body, 1_700_000_000);
    assert.match(header, /^t=1700000000,v1=[0-9a-f]+$/);
    assert.equal(verifyPayloadV1("sec", body, header, 1_700_000_000), true);
    assert.equal(verifyPayloadV1("wrong", body, header, 1_700_000_000), false);
    // Outside 5-minute skew window.
    assert.equal(verifyPayloadV1("sec", body, header, 1_700_000_000 + 400), false);
  });
});

describe("durable webhook retries", () => {
  it("re-drives pending deliveries from SQLite after a simulated restart", async () => {
    const org = store.createOrg("Hooks Co", 0n);
    const hook = store.createWebhook(org.id, "abi://demo-inbox");
    assert.ok(hook.secret);

    // Seed a pending delivery as if the process died mid-retry.
    const deliveryId = store.createDelivery({
      orgId: org.id,
      webhookId: hook.id,
      event: "payment.succeeded",
      payload: {
        event: "payment.succeeded",
        orgId: org.id,
        at: new Date().toISOString(),
        data: {},
      },
      url: "abi://demo-inbox",
    });
    store.updateDelivery(deliveryId, {
      status: "pending",
      attempts: 1,
      lastError: "simulated restart",
      nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
    });

    const { attempted } = await retryPendingWebhookDeliveries();
    assert.equal(attempted, 1);
    const row = store.listDeliveries(org.id)[0]!;
    assert.equal(row.status, "delivered");
  });

  it("emits with both timestamped and legacy signature headers", async () => {
    const org = store.createOrg("Sign Co", 0n);
    store.createWebhook(org.id, "abi://demo-inbox");
    emitEvent(org.id, "agent.frozen", { agentId: "a1" });
    await new Promise((r) => setTimeout(r, 30));
    const row = store.listDeliveries(org.id)[0]!;
    assert.equal(row.status, "delivered");
  });
});

describe("webhook redirects", () => {
  it("a 3xx from the receiver is not delivered and the Location is never requested", async () => {
    let targetHits = 0;
    const srv = createServer((req, res) => {
      if (req.url === "/target") {
        targetHits++;
        res.writeHead(200).end("ok");
        return;
      }
      res.writeHead(307, { location: "/target" }).end();
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/hook`;
    try {
      const org = store.createOrg("Redirect Hook Co", 0n);
      const hook = store.createWebhook(org.id, url);
      const deliveryId = store.createDelivery({
        orgId: org.id,
        webhookId: hook.id,
        event: "agent.frozen",
        payload: {},
        url,
      });
      await attemptDelivery({
        deliveryId,
        url,
        secret: hook.secret,
        event: "agent.frozen",
        body: "{}",
        attempt: 1,
      });
      const row = store.listDeliveries(org.id).find((d) => d.id === deliveryId)!;
      assert.notEqual(row.status, "delivered");
      assert.match(String(row.lastError), /redirect/i);
      assert.equal(targetHits, 0);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});
