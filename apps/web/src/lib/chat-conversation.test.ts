import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readChatMessages } from "./chat-conversation";
import { ChatMessageBody } from "./chat-message-body";

test("conversation rendering accepts existing messages without optional metadata", () => {
  assert.deepEqual(
    readChatMessages([{ id: "old", role: "assistant", body: "An existing reply" }]),
    [{ id: "old", role: "assistant", body: "An existing reply", kind: "message", createdAt: "" }],
  );
  assert.equal(
    readChatMessages([
      {
        id: "new",
        role: "user",
        body: "Hello",
        meta: { attachments: [] },
        createdAt: "2026-11-15T00:00:00Z",
      },
    ])[0]?.createdAt,
    "2026-11-15T00:00:00Z",
  );
});
test("malformed message content produces a readable failure instead of crashing the conversation", () => {
  for (const value of [
    null,
    {},
    [null],
    [{ id: "x", role: "assistant", body: { invalid: true } }],
    [{ id: "x", role: "unknown", body: "text" }],
  ])
    assert.throws(() => readChatMessages(value), /conversation response was incomplete/);
});
test("formatted replies escape HTML and render lists, emphasis, inline code and fenced code safely", () => {
  const html = renderToStaticMarkup(
    createElement(ChatMessageBody, {
      text: "## Balance\n\n- **Available:** 20 USDC\n- Address: `0x123`\n\n<script>alert('x')</script>\n\n```html\n<img src=x onerror=alert(1)>\n```",
    }),
  );
  assert.match(html, /<h4>Balance<\/h4>/);
  assert.match(html, /<strong>Available:<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<code>0x123<\/code>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script|<img/);
});
test("unfinished fenced replies remain readable as code", () => {
  const html = renderToStaticMarkup(
    createElement(ChatMessageBody, { text: '```json\n{"balance": 20}' }),
  );
  assert.match(html, /<pre><code>/);
  assert.match(html, /balance/);
});

test("reply tables use semantic headers and escape cell content", () => {
  const html = renderToStaticMarkup(
    createElement(ChatMessageBody, {
      text: "| Asset | Amount |\n| --- | --- |\n| **USDC** | 20 |\n| ETH | <script> |",
    }),
  );
  assert.match(html, /<table>/);
  assert.match(html, /<th scope="col">Asset<\/th>/);
  assert.match(html, /<strong>USDC<\/strong>/);
  assert.match(html, /&lt;script&gt;/);
});
