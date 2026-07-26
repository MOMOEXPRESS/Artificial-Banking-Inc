/**
 * The outbound URL guard is what stands between an agent-supplied `pay_api`
 * destination and this process's own network. Before it was shared, only
 * webhooks were checked while the x402 rail fetched agent URLs unguarded.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { localSellersAllowed, outboundUrlProblem, webhookUrlProblem } from "./outbound-url.js";

const originalNodeEnv = process.env.NODE_ENV;
const originalAllow = process.env.ABI_ALLOW_LOCAL_TARGETS;

function setEnv(nodeEnv?: string, allowLocal?: string) {
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  if (allowLocal === undefined) delete process.env.ABI_ALLOW_LOCAL_TARGETS;
  else process.env.ABI_ALLOW_LOCAL_TARGETS = allowLocal;
}

afterEach(() => setEnv(originalNodeEnv, originalAllow));

describe("outboundUrlProblem", () => {
  it("rejects non-http schemes and embedded credentials", () => {
    setEnv("development");
    assert.ok(outboundUrlProblem("file:///etc/passwd"));
    assert.ok(outboundUrlProblem("ftp://example.com/x"));
    assert.ok(outboundUrlProblem("not-a-url"));
    assert.ok(outboundUrlProblem("https://user:pass@example.com"));
  });

  it("allows ordinary public https targets", () => {
    setEnv("production");
    assert.equal(outboundUrlProblem("https://api.example.com/report"), null);
  });

  it("blocks private and loopback targets in production", () => {
    setEnv("production");
    for (const url of [
      "http://localhost:9402/report",
      "http://app.localhost/x",
      "http://127.0.0.1/x",
      "http://10.0.0.5/x",
      "http://192.168.1.1/x",
      "http://172.16.0.1/x",
      "http://100.64.0.1/x",
      "http://[::1]/x",
      "http://[fd00::1]/x",
    ]) {
      assert.ok(outboundUrlProblem(url), `expected ${url} to be blocked`);
    }
  });

  it("permits local targets in development so the bundled seller works", () => {
    setEnv("development");
    assert.equal(outboundUrlProblem("http://localhost:9402/report"), null);
    assert.equal(outboundUrlProblem("http://127.0.0.1:9402/report"), null);
  });

  it("never permits cloud metadata, even in development", () => {
    setEnv("development", "1");
    // A leaked instance credential is not a local-convenience trade.
    assert.ok(outboundUrlProblem("http://169.254.169.254/latest/meta-data/"));
    assert.ok(outboundUrlProblem("http://metadata.google.internal/x"));
    assert.ok(outboundUrlProblem("http://kubernetes.default.svc/x"));
  });

  it("honours the explicit ABI_ALLOW_LOCAL_TARGETS override in both directions", () => {
    setEnv("production", "1");
    assert.equal(outboundUrlProblem("http://localhost:9402/report"), null);
    assert.equal(localSellersAllowed(), true);

    setEnv("development", "0");
    assert.ok(outboundUrlProblem("http://localhost:9402/report"));
    assert.equal(localSellersAllowed(), false);
  });

  it("names the caller so the message is actionable", () => {
    setEnv("production");
    assert.match(String(outboundUrlProblem("http://127.0.0.1/x", "Payment destination")), /Payment destination/);
    assert.match(String(webhookUrlProblem("http://127.0.0.1/x")), /Webhook URL/);
  });

  it("keeps the in-process demo webhook sink usable", () => {
    setEnv("production");
    assert.equal(webhookUrlProblem("abi://demo-inbox"), null);
  });
});
