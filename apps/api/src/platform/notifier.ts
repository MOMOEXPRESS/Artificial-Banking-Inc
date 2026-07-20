/**
 * Channel-agnostic notifier.
 *
 * Telegram remains one transport. In-app chat is the default durable channel.
 * Email / Slack / Discord / push / SMS plug in by registering a channel handler
 * — callers always go through `notify`, never through a specific product API.
 */
import type { NotificationChannel } from "@policyvault/common";
import { store, type ApprovalRow, type ChatMessageRow } from "../store.js";

export type NotifyPayload =
  | {
      kind: "approval.pending";
      approval: ApprovalRow;
    }
  | {
      kind: "approval.resolved";
      orgId: string;
      approvalId: string;
      status: string;
      resolvedBy: string;
    }
  | {
      kind: "agent.frozen" | "policy.denied" | "compliance.flagged" | "info";
      orgId: string;
      title: string;
      body: string;
      meta?: Record<string, unknown>;
    };

type ChannelHandler = (payload: NotifyPayload) => void | Promise<void>;

const handlers = new Map<NotificationChannel, ChannelHandler>();

export function registerNotifier(channel: NotificationChannel, handler: ChannelHandler): void {
  handlers.set(channel, handler);
}

/** Fan-out to every registered channel. Failures are isolated per channel. */
export async function notify(
  payload: NotifyPayload,
  channels?: NotificationChannel[],
): Promise<void> {
  const targets = channels ?? [...handlers.keys()];
  await Promise.all(
    targets.map(async (channel) => {
      const handler = handlers.get(channel);
      if (!handler) return;
      try {
        await handler(payload);
      } catch (e) {
        console.error(`notifier:${channel} failed:`, e);
      }
    }),
  );
}

/** Built-in in-app channel — persists to chat so the console Chat view can render it. */
export function registerInAppNotifier(): void {
  registerNotifier("in_app", (payload) => {
    if (payload.kind === "approval.pending") {
      const a = payload.approval;
      store.appendChatMessage({
        orgId: a.orgId,
        role: "assistant",
        kind: "approval_request",
        body: `${a.tool} $${a.amountUsdc} → ${a.destination} needs your approval.`,
        approvalId: a.id,
        meta: {
          amountUsdc: a.amountUsdc,
          destination: a.destination,
          agentId: a.agentId,
          reasons: a.reasons,
        },
      });
      return;
    }
    if (payload.kind === "approval.resolved") {
      store.appendChatMessage({
        orgId: payload.orgId,
        role: "assistant",
        kind: "system",
        body: `Approval ${payload.approvalId} ${payload.status} by ${payload.resolvedBy}.`,
        approvalId: payload.approvalId,
      });
      return;
    }
    store.appendChatMessage({
      orgId: payload.orgId,
      role: "assistant",
      kind: payload.kind === "info" ? "system" : "alert",
      body: `${payload.title} — ${payload.body}`,
      meta: payload.meta,
    });
  });
}

export type { ChatMessageRow };
