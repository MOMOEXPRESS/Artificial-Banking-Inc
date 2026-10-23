/**
 * Webhook dispatcher: signed, at-least-once, with durable retries.
 *
 * Every event POST carries:
 *   x-policyvault-event:     event name (e.g. payment.succeeded)
 *   x-policyvault-delivery:  delivery id (dedupe key for receivers)
 *   x-abi-signature:         t=<unix>,v1=<hex HMAC of `${t}.${rawBody}`>
 *   x-policyvault-signature: sha256=<hex> (legacy body-only; kept during rotation)
 *
 * Receivers must verify the timestamped signature (reject |now - t| > 5 minutes)
 * and dedupe on the delivery id. During secret rotation, accept either the
 * current or previous secret (`webhook.secret` / `webhook.previousSecret`).
 *
 * Retries are persisted in `webhook_deliveries` and swept by the scheduler so a
 * process restart cannot leave deliveries stuck as `pending` forever.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { store } from "./store.js";
import { webhookUrlProblem } from "./outbound-url.js";

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
const RETRY_DELAYS_MS = [2_000, 10_000, 60_000];
/** Receivers should reject signatures older than this. */
export const WEBHOOK_SIGNATURE_MAX_SKEW_SEC = 5 * 60;

/** Legacy body-only HMAC — kept so existing receivers keep working during rotation. */
export function signPayload(secret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

/** Timestamped signature: `t=<unix>,v1=<hex>`. */
export function signPayloadV1(
  secret: string,
  rawBody: string,
  timestampSec = Math.floor(Date.now() / 1000),
): string {
  const t = String(timestampSec);
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

export function verifyPayloadV1(
  secret: string,
  rawBody: string,
  header: string,
  nowSec = Math.floor(Date.now() / 1000),
  maxSkewSec = WEBHOOK_SIGNATURE_MAX_SKEW_SEC,
): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return i === -1 ? [p, ""] : [p.slice(0, i), p.slice(i + 1)];
    }),
  ) as Record<string, string>;
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowSec - ts) > maxSkewSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(v1, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function nextAttemptAt(attempt: number): string {
  const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
  return new Date(Date.now() + delay).toISOString();
}

export async function attemptDelivery(args: {
  deliveryId: number;
  url: string;
  secret: string;
  previousSecret?: string;
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
    const timestamped = signPayloadV1(args.secret, args.body);
    const res = await fetch(args.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-policyvault-event": args.event,
        "x-policyvault-delivery": String(args.deliveryId),
        "x-abi-signature": timestamped,
        // Legacy header for receivers that have not migrated yet.
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
      nextAttemptAt: failedForGood ? undefined : nextAttemptAt(args.attempt),
    });
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
 * Re-drive pending deliveries whose next_attempt_at has passed.
 * Safe across restarts — state lives in SQLite, not setTimeout.
 */
export async function retryPendingWebhookDeliveries(): Promise<{ attempted: number }> {
  const due = store.listDueWebhookDeliveries(50);
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
