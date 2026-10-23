/**
 * Webhook dispatcher: signed, at-least-once, with bounded retries.
 *
 * Every event POST carries:
 *   x-policyvault-event:     event name (e.g. payment.succeeded)
 *   x-policyvault-delivery:  delivery id (dedupe key for receivers)
 *   x-policyvault-signature: sha256=<hex HMAC of raw body with endpoint secret>
 *
 * Receivers must verify the signature and dedupe on the delivery id.
 */
import { createHmac } from "node:crypto";
import { store } from "./store.js";
import { webhookUrlProblem } from "./outbound-url.js";
import { unrefTimer } from "./platform/timers.js";

export type WebhookEvent =
  | "payment.succeeded"
  | "payment.failed"
  | "policy.denied"
  | "approval.pending"
  | "approval.resolved"
  | "escrow.locked"
  | "escrow.released"
  | "escrow.refunded"
  | "agent.frozen"
  | "agent.unfrozen"
  | "invoice.created"
  | "invoice.paid"
  | "subscription.charged"
  | "compliance.flagged"
  | "treasury.move.pending"
  | "treasury.move.executed"
  | "treasury.recovery"
  | "treasury.onchain_deposit"
  | "treasury.drift.detected";

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2_000, 10_000];

export function signPayload(secret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

async function attemptDelivery(args: {
  deliveryId: number;
  url: string;
  secret: string;
  event: WebhookEvent;
  body: string;
  attempt: number;
}): Promise<void> {
  try {
    const problem = webhookUrlProblem(args.url);
    if (problem) {
      throw new Error(`SSRF_BLOCKED: ${problem}`);
    }
    // Built-in demo sink — no network hop. Playground + console Test use this.
    if (args.url === "abi://demo-inbox") {
      store.updateDelivery(args.deliveryId, {
        status: "delivered",
        attempts: args.attempt,
        deliveredAt: new Date().toISOString(),
      });
      return;
    }
    const res = await fetch(args.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-policyvault-event": args.event,
        "x-policyvault-delivery": String(args.deliveryId),
        "x-policyvault-signature": signPayload(args.secret, args.body),
      },
      body: args.body,
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      store.updateDelivery(args.deliveryId, {
        status: "delivered",
        attempts: args.attempt,
        deliveredAt: new Date().toISOString(),
      });
      return;
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    const failedForGood = args.attempt >= MAX_ATTEMPTS;
    store.updateDelivery(args.deliveryId, {
      status: failedForGood ? "failed" : "pending",
      attempts: args.attempt,
      lastError: String(e),
    });
    if (!failedForGood) {
      // Workers: Durable Object alarm re-drives pending rows (no setTimeout).
      // Node/Render: keep in-process delayed retry; PR #61 moves this fully to DB.
      if (process.env.ABI_RUNTIME === "cloudflare-workers") {
        return;
      }
      const delay = RETRY_DELAYS_MS[args.attempt - 1] ?? 10_000;
      const timer = setTimeout(() => {
        void attemptDelivery({ ...args, attempt: args.attempt + 1 });
      }, delay);
      unrefTimer(timer);
    }
  }
}

/** Fire an event to every webhook endpoint registered for the org. Non-blocking. */
export function emitEvent(orgId: string, event: WebhookEvent, payload: unknown): void {
  const endpoints = store.listWebhooks(orgId);
  if (endpoints.length === 0) return;
  const envelope = {
    event,
    orgId,
    at: new Date().toISOString(),
    data: payload,
  };
  for (const endpoint of endpoints) {
    const deliveryId = store.createDelivery({
      orgId,
      webhookId: endpoint.id,
      event,
      payload: envelope,
      url: endpoint.url,
    });
    const body = JSON.stringify({ ...envelope, deliveryId });
    void attemptDelivery({
      deliveryId,
      url: endpoint.url,
      secret: endpoint.secret,
      event,
      body,
      attempt: 1,
    });
  }
}

/**
 * Re-drive pending deliveries.
 *
 * Seam for PR #61: that branch adds `next_attempt_at` + `store.listDueWebhookDeliveries`.
 * On main we sweep `status='pending'` rows and skip setTimeout when running under
 * the Workers Durable Object alarm (`ABI_RUNTIME=cloudflare-workers`).
 */
export async function retryPendingWebhookDeliveries(): Promise<{ attempted: number }> {
  const storeAny = store as unknown as {
    listDueWebhookDeliveries?: (limit: number) => Array<{
      id: number;
      webhookId: string;
      url: string;
      event: string;
      attempts: number;
      payload: unknown;
    }>;
    listPendingWebhookDeliveries?: (limit: number) => Array<{
      id: number;
      webhookId: string;
      url: string;
      event: string;
      attempts: number;
      payload: unknown;
    }>;
  };

  const due =
    storeAny.listDueWebhookDeliveries?.(50) ??
    storeAny.listPendingWebhookDeliveries?.(50) ??
    listPendingDeliveriesFallback(50);

  let attempted = 0;
  for (const row of due) {
    const endpoint = store.getWebhookAnyOrg(row.webhookId);
    if (!endpoint) {
      store.updateDelivery(row.id, {
        status: "failed",
        attempts: row.attempts,
        lastError: "Webhook endpoint deleted",
      });
      continue;
    }
    const payload =
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : { data: row.payload };
    const body = JSON.stringify({ ...payload, deliveryId: row.id });
    attempted += 1;
    await attemptDelivery({
      deliveryId: row.id,
      url: row.url,
      secret: endpoint.secret,
      event: row.event as WebhookEvent,
      body,
      attempt: Math.max(1, row.attempts + 1),
    });
  }
  return { attempted };
}

function listPendingDeliveriesFallback(limit: number): Array<{
  id: number;
  webhookId: string;
  url: string;
  event: string;
  attempts: number;
  payload: unknown;
}> {
  // Use public store surface: scan recent deliveries per org.
  const out: Array<{
    id: number;
    webhookId: string;
    url: string;
    event: string;
    attempts: number;
    payload: unknown;
  }> = [];
  for (const orgId of store.listOrgIds()) {
    for (const row of store.listDeliveries(orgId, 100)) {
      if (row.status !== "pending") continue;
      out.push({
        id: row.id,
        webhookId: row.webhookId,
        url: row.url,
        event: row.event,
        attempts: row.attempts,
        payload: row.payload,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
