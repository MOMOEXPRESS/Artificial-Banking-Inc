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
import { webhookUrlProblem } from "./webhook-url.js";

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
  | "invoice.paid"
  | "subscription.charged"
  | "compliance.flagged"
  | "treasury.move.pending"
  | "treasury.move.executed"
  | "treasury.recovery";

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
      const delay = RETRY_DELAYS_MS[args.attempt - 1] ?? 10_000;
      setTimeout(() => {
        void attemptDelivery({ ...args, attempt: args.attempt + 1 });
      }, delay).unref();
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
