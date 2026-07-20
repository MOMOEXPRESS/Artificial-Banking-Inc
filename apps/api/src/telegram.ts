/**
 * Telegram guardian approvals: when an approval lands, DM the ops chat with
 * Approve/Deny buttons; button presses resolve the approval through the same
 * engine path as the REST route.
 *
 * Enabled when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set (create a bot
 * with @BotFather, message it once, read the chat id from getUpdates).
 * Without them this module is a silent no-op.
 */
import { resolveApproval } from "./engine.js";
import { store, type ApprovalRow } from "./store.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
const API = `https://api.telegram.org/bot${TOKEN}`;

export const telegramEnabled = Boolean(TOKEN && CHAT_ID);

async function tg(method: string, payload: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!body.ok) throw new Error(`telegram ${method}: ${body.description}`);
  return body.result;
}

export function notifyApprovalPending(approval: ApprovalRow): void {
  if (!telegramEnabled) return;
  const agent = store.getAgent(approval.agentId);
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
  tg("sendMessage", {
    chat_id: CHAT_ID,
    text,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Approve", callback_data: `apr:${approval.id}:approve` },
          { text: "🛑 Deny", callback_data: `apr:${approval.id}:deny` },
        ],
      ],
    },
  }).catch((e) => console.error("telegram notify failed:", e));
}

interface TgUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
    from?: { username?: string; id: number };
  };
}

let offset = 0;
let polling = false;

async function pollOnce(): Promise<void> {
  const updates = (await tg("getUpdates", {
    offset,
    timeout: 0,
    allowed_updates: ["callback_query"],
  })) as TgUpdate[];
  for (const update of updates) {
    offset = Math.max(offset, update.update_id + 1);
    const cq = update.callback_query;
    if (!cq?.data?.startsWith("apr:")) continue;
    const [, approvalId, action] = cq.data.split(":");
    const approval = store.getApprovalAnyOrg(approvalId);
    let answer: string;
    if (!approval) {
      answer = "Approval not found";
    } else {
      const resolvedBy = `telegram:${cq.from?.username ?? cq.from?.id ?? "guardian"}`;
      const outcome = await resolveApproval(
        approval.orgId,
        approvalId,
        action === "approve",
        resolvedBy,
      );
      answer =
        outcome.kind === "resolved"
          ? `${action === "approve" ? "Approved" : "Denied"} ✔`
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
}

export function startTelegramPolling(): void {
  if (!telegramEnabled) {
    console.log("Telegram approvals disabled (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID).");
    return;
  }
  if (polling) return;
  polling = true;
  console.log("Telegram approvals enabled — polling for guardian button presses.");
  setInterval(() => {
    pollOnce().catch((e) => console.error("telegram poll failed:", e));
  }, 4_000).unref();
}
