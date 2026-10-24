/**
 * The ABI assistant's org memory through the real guardian routes: what one
 * request saves, a later, independent request (a new console session) can
 * recall — and another organization never sees it.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-mem-"));
process.env.POLICYVAULT_DB = join(dir, "mem.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";

const { store } = await import("./store.js");
const { app } = await import("./index.js");

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

async function chat(key: string, message: string) {
  const res = await fetch(`${base}/v1/guardian/chat`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  assert.equal(res.status, 200);
  return (await res.json()) as {
    reply: { body: string };
    messages: { role: string; body: string }[];
  };
}

describe("ABI assistant memory over HTTP", () => {
  it("remember → new session → recall, isolated per org", async () => {
    const a = store.createOrg("Mem A", 10_000_000n);
    const b = store.createOrg("Mem B", 10_000_000n);
    const saved = await chat(a.guardianKey, "Please remember our fiscal year starts in April");
    assert.match(saved.reply.body, /Saved/);

    // New session: a fresh request with nothing carried over client-side.
    const recall = await chat(a.guardianKey, "What do you remember?");
    assert.match(recall.reply.body, /our fiscal year starts in April/);

    const other = await chat(b.guardianKey, "What do you remember?");
    assert.match(other.reply.body, /No saved notes yet/);
    assert.ok(!other.messages.some((m) => /fiscal/.test(m.body)));

    // Overview "Ask" panel shares the same memory.
    const ask = await fetch(`${base}/v1/guardian/ask`, {
      method: "POST",
      headers: { authorization: `Bearer ${a.guardianKey}`, "content-type": "application/json" },
      body: JSON.stringify({ question: "what do you remember?" }),
    });
    assert.match(((await ask.json()) as { answer: string }).answer, /fiscal year/);
  });

  it("chat history returns the newest messages, not the oldest", async () => {
    const org = store.createOrg("Long Chat", 10_000_000n);
    for (let i = 0; i < 110; i++) {
      store.appendChatMessage({ orgId: org.id, role: "user", kind: "text", body: `old ${i}` });
    }
    const last = await chat(org.guardianKey, "Remember that the newest message must show");
    const bodies = last.messages.map((m) => m.body);
    assert.equal(bodies.length, 100);
    assert.match(bodies[bodies.length - 1] ?? "", /Saved/);
    assert.ok(bodies.includes("Remember that the newest message must show"));
    assert.ok(!bodies.includes("old 0"));
  });
});
