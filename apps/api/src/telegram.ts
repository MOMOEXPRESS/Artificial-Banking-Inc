import { resolveApproval } from "./engine.js";
import { stepUpThresholdMicro } from "./routes/mfa-routes.js";
import { registerNotifier } from "./platform/notifier.js";
import { scopedStore, store, type ApprovalRow, type OrgRow } from "./store.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
/** Process-wide fallback chat. Prefer per-org `settings.telegramChatId`. */
const GLOBAL_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
const GLOBAL_ALLOWED_USERS = new Set(
  (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const API = `https://api.telegram.org/bot${TOKEN}`;

export const telegramEnabled = Boolean(TOKEN);

type TelegramOrgSettings = {
  telegramChatId?: string;
  telegramAllowedUserIds?: string[];
};

function orgTelegramSettings(org: OrgRow | undefined): TelegramOrgSettings {
  const settings = (org?.settings ?? {}) as TelegramOrgSettings;
  return {
    telegramChatId:
      typeof settings.telegramChatId === "string" ? settings.telegramChatId.trim() : undefined,
    telegramAllowedUserIds: Array.isArray(settings.telegramAllowedUserIds)
      ? settings.telegramAllowedUserIds.map((s) => String(s).trim()).filter(Boolean)
      : undefined,
  };
}

/** Chat id that should receive approvals for this org, if any. */
export function telegramChatForOrg(orgId: string): string | null {
  if (!TOKEN) return null;
  const org = store.getOrg(orgId);
  const perOrg = orgTelegramSettings(org).telegramChatId;
  if (perOrg) return perOrg;
  // Global fallback is single-tenant / demo only. Multi-tenant deployments
  // must set settings.telegramChatId per org so amounts never cross tenants.
  return GLOBAL_CHAT_ID || null;
}

function allowedUsersForOrg(orgId: string): Set<string> {
  const org = store.getOrg(orgId);
  const perOrg = orgTelegramSettings(org).telegramAllowedUserIds;
  if (perOrg && perOrg.length > 0) return new Set(perOrg);
  return GLOBAL_ALLOWED_USERS;
}

/**
 * Strip Telegram Markdown / MarkdownV2 metacharacters.
 * Notifications are sent as plain text (no parse_mode); this helper remains
 * for any future formatted path and for unit tests.
 */
export function escapeTelegramText(value: string): string {
  return value.replace(/[_*`[\]()~>#+\-=|{}.!\\]/g, "\\$&");
}

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
  const chatId = telegramChatForOrg(approval.orgId);
  if (!chatId) return;
  const agent = scopedStore(approval.orgId).getAgent(approval.agentId);
  // Plain text only — no parse_mode — so agent-controlled memo/destination
  // cannot inject Telegram Markdown that misleads the approver.
  const text = [
    "Approval needed",
    `Org: ${approval.orgId}`,
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
  // Callback embeds org id so the poller never needs a cross-tenant lookup.
  tg("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Approve", callback_data: `apr:${approval.orgId}:${approval.id}:approve` },
          { text: "Deny", callback_data: `apr:${approval.orgId}:${approval.id}:deny` },
        ],
      ],
    },
  }).catch((e) => console.error("telegram notify failed:", e));
}

/** Register Telegram as one channel on the shared notifier bus. */
export function registerTelegramNotifier(): void {
  if (!telegramEnabled) return;
  registerNotifier("telegram", (payload) => {
    if (payload.kind === "approval.pending") {
      notifyApprovalPending(payload.approval);
    }
  });
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

/**
 * Resolve a Telegram user to a guardian seat in the approval's org.
 * Prefer an explicit seat link; fall back to allowlist + founding owner only
 * when the allowlist is non-empty (fail-closed otherwise).
 */
export function resolveTelegramVoter(
  orgId: string,
  telegramUserId: string,
): { ok: true; guardianId: string; label: string } | { ok: false; message: string } {
  if (!telegramUserId) {
    return { ok: false, message: "Telegram user id missing" };
  }
  const linked = store.findGuardianByTelegramUserId(orgId, telegramUserId);
  if (linked) {
    return { ok: true, guardianId: linked.id, label: linked.name };
  }
  const allowed = allowedUsersForOrg(orgId);
  if (allowed.size === 0) {
    return {
      ok: false,
      message:
        "No Telegram allowlist and no guardian linked to this user. " +
        "Set TELEGRAM_ALLOWED_USER_IDS, org settings.telegramAllowedUserIds, " +
        "or conditions.telegramUserId on a guardian seat.",
    };
  }
  if (!allowed.has(telegramUserId)) {
    return { ok: false, message: "Not an authorised guardian" };
  }
  // Allowlisted but unlinked: treat as founding owner only when the allowlist
  // is the sole gate (demo). Prefer linking seats in multi-guardian orgs.
  return { ok: true, guardianId: "owner", label: `telegram:${telegramUserId}` };
}

/** Exported for tests — process one batch of Telegram updates. */
export async function pollOnce(): Promise<void> {
  if (!TOKEN) return;
  const updates = (await tg("getUpdates", {
    offset,
    timeout: 0,
    allowed_updates: ["callback_query"],
  })) as TgUpdate[];
  for (const update of updates) {
    offset = Math.max(offset, update.update_id + 1);
    const cq = update.callback_query;
    if (!cq?.data?.startsWith("apr:")) continue;
    const parts = cq.data.split(":");
    // New format: apr:<orgId>:<approvalId>:<action>
    // Legacy format: apr:<approvalId>:<action> — rejected (cross-tenant risk).
    if (parts.length !== 4) {
      await tg("answerCallbackQuery", {
        callback_query_id: cq.id,
        text: "Stale approval button — request a new notification",
      }).catch(() => {});
      continue;
    }
    const [, orgId, approvalId, action] = parts;
    if (!orgId || !approvalId || (action !== "approve" && action !== "deny")) {
      await tg("answerCallbackQuery", {
        callback_query_id: cq.id,
        text: "Malformed approval callback",
      }).catch(() => {});
      continue;
    }

    const expectedChat = telegramChatForOrg(orgId);
    if (!expectedChat || !cq.message || String(cq.message.chat.id) !== String(expectedChat)) {
      await tg("answerCallbackQuery", {
        callback_query_id: cq.id,
        text: "Wrong chat — ignored",
      }).catch(() => {});
      continue;
    }

    const fromId = cq.from?.id != null ? String(cq.from.id) : "";
    const voter = resolveTelegramVoter(orgId, fromId);
    if (!voter.ok) {
      await tg("answerCallbackQuery", {
        callback_query_id: cq.id,
        text: voter.message.slice(0, 180),
      }).catch(() => {});
      continue;
    }

    const approval = store.getApproval(approvalId, orgId);
    let answer: string;
    if (!approval) {
      answer = "Approval not found";
    } else if (action === "approve") {
      const threshold = stepUpThresholdMicro();
      if (threshold > 0n && approval.amountMicro >= threshold) {
        answer =
          `Approving $${approval.amountUsdc} requires MFA step-up in the console ` +
          `(threshold $${(Number(threshold) / 1e6).toFixed(2)}). Telegram cannot satisfy step-up.`;
      } else {
        const resolvedBy = `telegram:${cq.from?.username ?? fromId}`;
        const outcome = await resolveApproval(
          orgId,
          approvalId,
          true,
          resolvedBy,
          voter.guardianId,
        );
        answer =
          outcome.kind === "resolved"
            ? "Approved"
            : outcome.kind === "pending_quorum"
              ? `Vote recorded — ${outcome.have} of ${outcome.need}`
              : outcome.kind === "forbidden"
                ? outcome.message
                : `No action: ${outcome.kind}`;
      }
    } else {
      const resolvedBy = `telegram:${cq.from?.username ?? fromId}`;
      const outcome = await resolveApproval(
        orgId,
        approvalId,
        false,
        resolvedBy,
        voter.guardianId,
      );
      answer =
        outcome.kind === "resolved"
          ? "Denied"
          : outcome.kind === "forbidden"
            ? outcome.message
            : `No action: ${outcome.kind}`;
    }
    if (cq.message) {
      tg("editMessageText", {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        text: `Approval ${approvalId}: ${answer} (by telegram:${cq.from?.username ?? fromId})`,
      }).catch(() => {});
    }
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: answer.slice(0, 180) }).catch(
      () => {},
    );
  }
}

export function startTelegramPolling(): void {
  if (!telegramEnabled) {
    console.log("Telegram approvals disabled (set TELEGRAM_BOT_TOKEN).");
    return;
  }
  if (!GLOBAL_CHAT_ID) {
    console.log(
      "Telegram bot token set — per-org settings.telegramChatId required to deliver approvals " +
        "(or set TELEGRAM_CHAT_ID as a single-tenant fallback).",
    );
  }
  if (polling) return;
  polling = true;
  console.log("Telegram approvals enabled — polling for guardian button presses.");
  setInterval(() => {
    pollOnce().catch((e) => console.error("telegram poll failed:", e));
  }, 4_000).unref();
}
