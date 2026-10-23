/**
 * Rate limiting over real HTTP (Oct 23 console crash regression).
 *
 * The console authenticates with the httpOnly session cookie and polls ~15
 * reads after every mutation. A single shared 120/min bucket for reads and
 * writes turned every poll into a 429 within seconds of creating an API key or
 * moving funds. Reads now have their own larger bucket, keyed per session.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-rate-"));
process.env.POLICYVAULT_DB = join(dir, "rate.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";
process.env.RATE_LIMIT_PER_MIN = "5";
process.env.RATE_LIMIT_READ_PER_MIN = "20";

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
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

async function hit(n: number, init: RequestInit & { path: string }) {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) {
    const res = await fetch(`${base}${init.path}`, init);
    await res.arrayBuffer();
    statuses.push(res.status);
  }
  return statuses;
}

describe("rate limiting", () => {
  it("gives reads a separate, larger budget than writes", async () => {
    const cookie = "abi_session=read-bucket-session";
    const reads = await hit(12, { path: "/v1/auth/me", headers: { cookie } });
    // 12 reads exceed the write budget (5) but not the read budget (20).
    assert.ok(!reads.includes(429), `reads were limited: ${reads.join(",")}`);
  });

  it("buckets cookie sessions separately", async () => {
    const a = await hit(21, { path: "/v1/auth/me", headers: { cookie: "abi_session=sess-a" } });
    assert.equal(a.at(-1), 429, "21st read in a minute is limited");
    const b = await hit(1, { path: "/v1/auth/me", headers: { cookie: "abi_session=sess-b" } });
    assert.notEqual(b[0], 429, "another session keeps its own budget");
  });

  it("still limits writes at RATE_LIMIT_PER_MIN with Retry-After", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 6; i++) {
      last = await fetch(`${base}/v1/guardian/agents`, {
        method: "POST",
        headers: { cookie: "abi_session=writer", "content-type": "application/json" },
        body: "{}",
      });
      await last.arrayBuffer();
    }
    assert.equal(last!.status, 429);
    assert.equal(last!.headers.get("retry-after"), "60");
  });
});
