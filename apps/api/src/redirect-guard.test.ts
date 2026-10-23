import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  RedirectRefusedError,
  fetchNoRedirect,
  fetchPinnedOutbound,
  isRedirectResponse,
  refuseRedirect,
} from "./outbound-url.js";

let base = "";
let targetHits = 0;
const server = createServer((req, res) => {
  if (req.url === "/target") {
    targetHits++;
    res.writeHead(200).end("target");
    return;
  }
  const m = /^\/status\/(\d{3})$/.exec(req.url ?? "");
  if (m) {
    const code = Number(m[1]);
    res.writeHead(code, code >= 300 && code < 400 ? { location: `${base}/target` } : {});
    res.end(String(code));
    return;
  }
  res.writeHead(404).end();
});

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => server.close(() => r())));

describe("never-follow-redirects guard", () => {
  it("classifies 3xx and opaque redirects as redirects", () => {
    for (const status of [300, 301, 302, 303, 307, 308]) {
      assert.equal(isRedirectResponse({ status, type: "basic" }), true, String(status));
    }
    assert.equal(isRedirectResponse({ status: 0, type: "opaqueredirect" }), true);
    for (const status of [200, 204, 402, 404, 500]) {
      assert.equal(isRedirectResponse({ status, type: "basic" }), false, String(status));
    }
    assert.throws(
      () => refuseRedirect({ status: 302, type: "basic" }, "Seller"),
      RedirectRefusedError,
    );
  });

  it("fetchNoRedirect rejects every 3xx and never requests the Location", async () => {
    targetHits = 0;
    for (const code of [301, 302, 303, 307, 308]) {
      await assert.rejects(fetchNoRedirect(`${base}/status/${code}`), (e: unknown) => {
        assert.ok(e instanceof RedirectRefusedError);
        assert.equal(e.status, code);
        assert.match(e.message, /never followed/);
        return true;
      });
    }
    assert.equal(targetHits, 0);
  });

  it("fetchNoRedirect passes non-redirect responses through", async () => {
    for (const code of [200, 402, 404]) {
      const res = await fetchNoRedirect(`${base}/status/${code}`);
      assert.equal(res.status, code);
    }
  });

  it("always asks fetch for redirect: manual (Workers rejects redirect: error)", async () => {
    let seen: RequestInit | undefined;
    const spy = (async (_u: string | URL | Request, init?: RequestInit) => {
      seen = init;
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    await fetchNoRedirect("https://seller.example/report", { redirect: "follow" }, "x", spy);
    assert.equal(seen?.redirect, "manual");
  });

  it("fetchPinnedOutbound on the Workers path refuses a 3xx", async () => {
    const prev = process.env.ABI_RUNTIME;
    process.env.ABI_RUNTIME = "cloudflare-workers";
    targetHits = 0;
    try {
      await assert.rejects(
        fetchPinnedOutbound({ url: `${base}/status/302`, pinnedIp: "127.0.0.1" }),
        RedirectRefusedError,
      );
      assert.equal(targetHits, 0);
    } finally {
      if (prev === undefined) delete process.env.ABI_RUNTIME;
      else process.env.ABI_RUNTIME = prev;
    }
  });
});
