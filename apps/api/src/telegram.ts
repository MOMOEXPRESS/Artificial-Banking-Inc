import { timingSafeEqual } from "node:crypto";
import type express from "express";
import { resolveApproval } from "./engine.js";
import { registerNotifier } from "./platform/notifier.js";
import { unrefTimer } from "./platform/timers.js";
import { scopedStore, store, type ApprovalRow } from "./store.js";

function botToken(): string {
  return process.env.TELEGRAM_BOT_TOKEN ?? "";
}
function chatId(): string {
  return process.env.TELEGRAM_CHAT_ID ?? "";
}
function webhookSecret(): string {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
}

function allowedUsersGlobal(): Set<string> {
  return new Set(
    (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function apiBase(): string {
  return `https://api.telegram.org/bot${botToken()}`;
}

/** True when Telegram outbound notifications can be sent. */
export function telegramEnabled(): boolean {
  return Boolean(botToken() && chatId());
}

async function tg(method: string, payload: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${apiBase()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!body.ok) throw new Error(`telegram ${method}: ${body.description}`);
  return body.result;
}

/**
 * Per-org chat override seam (PR #61 adds store-backed chat ids).
 * On main: fall back to the process-wide TELEGRAM_CHAT_ID.
 */
export function telegramChatForOrg(_orgId: string): string | null {
  const chat = chatId();
  return chat || null;
}

export function notifyApprovalPending(approval: ApprovalRow): void {
  if (!telegramEnabled()) return;
  const dest = telegramChatForOrg(approval.orgId);
  if (!dest) return;
  const agent = scopedStore(approval.orgId).getAgent(approval.agentId);
  const text = [
    `🔐 *Approval needed*`,
    `Agent: ${agent?.name ?? approval.agentId}`,
    `Tool: ${approval.tool}`,
    `Amount: $${approval.amountUsdc} USDC`,
    `To: ${approval.destination}`,
    approval.memo ? `Memo: ${approval.memo}` : undefined,
    `Reason: ${approval.reasons.join("; ")}`,
    `Expires: ${approval.expiresAt}`,
  ]
    .filter(Boolean)
    .join("\n");
  // Org-scoped callback (PR #61 format) so webhook handlers are tenant-safe.
  tg("sendMessage", {
    chat_id: dest,
    text,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "✅ Approve",
            callback_data: `apr:${approval.orgId}:${approval.id}:approve`,
          },
          {
            text: "🛑 Deny",
            callback_data: `apr:${approval.orgId}:${approval.id}:deny`,
          },
        ],
      ],
    },
  }).catch((e) => console.error("telegram notify failed:", e));
}

/** Register Telegram as one channel on the shared notifier bus. */
export function registerTelegramNotifier(): void {
  if (!telegramEnabled()) return;
  registerNotifier("telegram", (payload) => {
    if (payload.kind === "approval.pending") {
      notifyApprovalPending(payload.approval);
    }
  });
}

export interface TgUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
    from?: { username?: string; id: number };
  };
}

/**
 * Resolve a Telegram user to a guardian seat in the approval's org.
 *
 * Signature matches PR #61. On main (no telegramUserId column yet) we use the
 * allowlist and map allowlisted voters to guardianId `owner`. When #61 merges,
 * its `store.findGuardianByTelegramUserId` path is preferred via the optional
 * call below.
 */
export function resolveTelegramVoter(
  orgId: string,
  telegramUserId: string,
): { ok: true; guardianId: string; label: string } | { ok: false; message: string } {
  if (!telegramUserId) {
    return { ok: false, message: "Telegram user id missing" };
  }
  const storeAny = store as unknown as {
    findGuardianByTelegramUserId?: (
      org: string,
      tgUser: string,
    ) => { id: string; name: string } | undefined;
  };
  const linked = storeAny.findGuardianByTelegramUserId?.(orgId, telegramUserId);
  if (linked) {
    return { ok: true, guardianId: linked.id, label: linked.name };
  }

  const allowed = allowedUsersGlobal();
  if (allowed.size === 0) {
    return {
      ok: false,
      message:
        "No Telegram allowlist and no guardian linked to this user. " +
        "Set TELEGRAM_ALLOWED_USER_IDS or link a guardian seat (PR #61).",
    };
  }
  if (!allowed.has(telegramUserId)) {
    return { ok: false, message: "Not an authorised guardian" };
  }
  return { ok: true, guardianId: "owner", label: `telegram:${telegramUserId}` };
}

/** Process one Telegram update (polling or webhook). */
export async function handleTelegramUpdate(update: TgUpdate): Promise<void> {
  const cq = update.callback_query;
  if (!cq?.data?.startsWith("apr:")) return;

  const parts = cq.data.split(":");
  let orgId: string | undefined;
  let approvalId: string | undefined;
  let action: string | undefined;
  if (parts.length === 4) {
    [, orgId, approvalId, action] = parts;
  } else if (parts.length === 3) {
    // Legacy Render format — accepted until #61's org-scoped buttons are universal.
    [, approvalId, action] = parts;
    orgId = store.getApprovalAnyOrg(approvalId!)?.orgId;
  } else {
    await tg("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Malformed approval callback",
    }).catch(() => {});
    return;
  }

  if (!orgId || !approvalId || (action !== "approve" && action !== "deny")) {
    await tg("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Malformed approval callback",
    }).catch(() => {});
    return;
  }

  const expectedChat = telegramChatForOrg(orgId);
  if (!expectedChat || !cq.message || String(cq.message.chat.id) !== String(expectedChat)) {
    await tg("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Wrong chat — ignored",
    }).catch(() => {});
    return;
  }

  const fromId = cq.from?.id != null ? String(cq.from.id) : "";
  const voter = resolveTelegramVoter(orgId, fromId);
  if (!voter.ok) {
    await tg("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: voter.message.slice(0, 180),
    }).catch(() => {});
    return;
  }

  const approval = store.getApprovalAnyOrg(approvalId);
  let answer: string;
  if (!approval || approval.orgId !== orgId) {
    answer = "Approval not found";
  } else {
    const resolvedBy = `telegram:${cq.from?.username ?? fromId}`;
    const outcome = await resolveApproval(
      approval.orgId,
      approvalId,
      action === "approve",
      resolvedBy,
      voter.guardianId,
    );
    answer =
      outcome.kind === "resolved"
        ? `${action === "approve" ? "Approved" : "Denied"} ✔`
        : outcome.kind === "pending_quorum"
          ? `Vote recorded — ${outcome.have} of ${outcome.need}`
          : outcome.kind === "forbidden"
            ? outcome.message
            : `No action: ${outcome.kind}`;
    if (cq.message) {
      tg("editMessageText", {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        text: `Approval ${approvalId}: ${answer} (by ${resolvedBy})`,
      }).catch(() => {});
    }
  }
  await tg("answerCallbackQuery", { callback_query_id: cq.id, text: answer }).catch(() => {});
}

let offset = 0;
let polling = false;

async function pollOnce(): Promise<void> {
  if (!botToken()) return;
  const updates = (await tg("getUpdates", {
    offset,
    timeout: 0,
    allowed_updates: ["callback_query"],
  })) as TgUpdate[];
  for (const update of updates) {
    offset = Math.max(offset, update.update_id + 1);
    await handleTelegramUpdate(update);
  }
}

/**
 * Long-poll getUpdates — Node/Render only. Workers use the webhook route.
 */
export function startTelegramPolling(): void {
  if (process.env.ABI_RUNTIME === "cloudflare-workers") {
    console.log("Telegram approvals: Workers runtime — use webhook route, not getUpdates polling.");
    return;
  }
  if (!telegramEnabled()) {
    console.log("Telegram approvals disabled (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID).");
    return;
  }
  if (polling) return;
  polling = true;
  console.log("Telegram approvals enabled — polling for guardian button presses.");
  const timer = setInterval(() => {
    pollOnce().catch((e) => console.error("telegram poll failed:", e));
  }, 4_000);
  unrefTimer(timer);
}

/**
 * POST /v1/telegram/webhook — verifies X-Telegram-Bot-Api-Secret-Token.
 */
export function registerTelegramWebhookRoute(app: express.Express): void {
  app.post("/v1/telegram/webhook", async (req, res) => {
    const expected = webhookSecret();
    if (!expected) {
      return res.status(503).json({
        error: {
          code: "TELEGRAM_WEBHOOK_UNCONFIGURED",
          message: "TELEGRAM_WEBHOOK_SECRET is not set.",
        },
      });
    }
    const presented = req.header("x-telegram-bot-api-secret-token") ?? "";
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return res
        .status(401)
        .json({ error: { code: "UNAUTHORIZED", message: "Bad webhook secret" } });
    }
    try {
      await handleTelegramUpdate(req.body as TgUpdate);
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error("telegram webhook failed:", error);
      return res
        .status(500)
        .json({ error: { code: "TELEGRAM_WEBHOOK_FAILED", message: "handler error" } });
    }
  });
}
