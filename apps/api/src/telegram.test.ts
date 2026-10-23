/**
 * Telegram approval path must enforce the same seat / allowlist / step-up
 * rules as the console — a bare tg: stub used to bypass all of them.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-tg-"));
process.env.POLICYVAULT_DB = join(dir, "tg.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_KEK = "test-kek";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_CHAT_ID = "1001";
process.env.TELEGRAM_ALLOWED_USER_IDS = "";
process.env.ABI_STEP_UP_ABOVE_USDC = "100";

const { store } = await import("./store.js");
const { resolveApproval, guardianApproveGate, id } = await import("./engine.js");
const {
  escapeTelegramText,
  resolveTelegramVoter,
  telegramChatForOrg,
  notifyApprovalPending,
} = await import("./telegram.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function orgWithApproval(amountMicro = 10_000_000n) {
  const org = store.createOrg("TG Co", 1_000_000_000n);
  const agent = store.createAgent(org.id, "Bot");
  const approval = {
    id: id("apr"),
    orgId: org.id,
    intentId: id("int"),
    agentId: agent.agentId,
    tool: "pay",
    amountUsdc: (Number(amountMicro) / 1e6).toString(),
    amountMicro,
    destination: "0x1111111111111111111111111111111111111111",
    memo: "hello *bold* [link](http://evil)",
    reasons: ["hitl"],
    ruleIds: ["hitl"],
    status: "pending" as const,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    idempotencyKey: id("idem"),
  };
  store.createApproval(approval);
  return { org, agent, approval };
}

describe("Telegram approval security", () => {
  it("refuses bare tg: guardian ids at the approve gate", () => {
    const { org, approval } = orgWithApproval();
    const gate = guardianApproveGate(org.id, "tg:999", true, approval);
    assert.equal(gate.ok, false);
  });

  it("fail-closes when no allowlist and no linked guardian", () => {
    const { org } = orgWithApproval();
    const voter = resolveTelegramVoter(org.id, "4242");
    assert.equal(voter.ok, false);
    if (!voter.ok) assert.match(voter.message, /allowlist|linked/i);
  });

  it("maps a linked telegram user onto the guardian seat (role + max-approve)", async () => {
    const { org, approval } = orgWithApproval(60_000_000n);
    const g = store.createGuardian(org.id, "Eve", "approver");
    store.updateGuardian(org.id, g.id, {
      conditions: { restricted: true, maxApproveUsdc: "10", telegramUserId: "555" },
    });

    const voter = resolveTelegramVoter(org.id, "555");
    assert.equal(voter.ok, true);
    if (!voter.ok) return;

    const outcome = await resolveApproval(org.id, approval.id, true, "telegram:eve", voter.guardianId);
    assert.equal(outcome.kind, "forbidden");
  });

  it("blocks a viewer-linked telegram user from approving", async () => {
    const { org, approval } = orgWithApproval();
    const g = store.createGuardian(org.id, "Dana", "viewer");
    store.updateGuardian(org.id, g.id, { conditions: { telegramUserId: "777" } });
    const voter = resolveTelegramVoter(org.id, "777");
    assert.equal(voter.ok, true);
    if (!voter.ok) return;
    const outcome = await resolveApproval(org.id, approval.id, true, "telegram:dana", voter.guardianId);
    assert.equal(outcome.kind, "forbidden");
  });

  it("uses per-org telegram chat ids instead of a global cross-tenant chat", () => {
    const a = store.createOrg("A", 1_000_000_000n);
    const b = store.createOrg("B", 1_000_000_000n);
    store.setOrgSettings(a.id, { telegramChatId: "111" });
    store.setOrgSettings(b.id, { telegramChatId: "222" });
    assert.equal(telegramChatForOrg(a.id), "111");
    assert.equal(telegramChatForOrg(b.id), "222");
  });

  it("escapes markdown metacharacters for any formatted path", () => {
    assert.equal(escapeTelegramText("a_b*c"), "a\\_b\\*c");
  });

  it("sends plain-text notifications with org-scoped callback data", async () => {
    const { org, approval } = orgWithApproval();
    store.setOrgSettings(org.id, { telegramChatId: "333" });
    const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const url = String(_url);
      const method = url.split("/").pop()!;
      const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ method, payload });
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      notifyApprovalPending(approval);
      // notify is fire-and-forget; give the microtask a tick.
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.method, "sendMessage");
      assert.equal(calls[0]!.payload.chat_id, "333");
      assert.equal(calls[0]!.payload.parse_mode, undefined);
      const markup = calls[0]!.payload.reply_markup as {
        inline_keyboard: Array<Array<{ callback_data: string }>>;
      };
      assert.match(markup.inline_keyboard[0]![0]!.callback_data, new RegExp(`^apr:${org.id}:`));
      assert.match(String(calls[0]!.payload.text), /\*bold\*/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
