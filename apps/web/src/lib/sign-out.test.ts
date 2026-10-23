import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clearClientSession,
  performSignOut,
  readCsrfCookie,
  signedOutNotice,
  signedOutUrl,
} from "./sign-out";

function memStore(init: Record<string, string>) {
  const data = new Map(Object.entries(init));
  return {
    data,
    removeItem: (k: string) => void data.delete(k),
  };
}

function fakeFetch(status: number | "throw") {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (status === "throw") throw new Error("offline");
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("performSignOut", () => {
  it("revokes the server session, then clears session storage but keeps prefs", async () => {
    const local = memStore({ pv_session: "{}", pv_prefs: "{}", abi_theme: "dark" });
    const tab = memStore({ abi_e2e_wallet: "0xabc", abi_treasury_tab: "move", other: "x" });
    const f = fakeFetch(200);
    const out = await performSignOut({
      apiBase: "/abi-api",
      mode: "session",
      csrf: "tok",
      orgId: "org_1",
      fetchImpl: f.impl,
      local,
      tab,
    });
    assert.equal(out, "ok");
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, "/abi-api/v1/auth/logout");
    assert.equal(f.calls[0].init.method, "POST");
    assert.equal(f.calls[0].init.credentials, "include");
    const h = f.calls[0].init.headers as Record<string, string>;
    assert.equal(h["x-abi-csrf"], "tok");
    assert.equal(h["x-abi-org"], "org_1");
    assert.deepEqual([...local.data.keys()].sort(), ["abi_theme", "pv_prefs"]);
    assert.deepEqual([...tab.data.keys()], ["other"]);
  });

  it("uses logout-all for everywhere", async () => {
    const f = fakeFetch(200);
    const out = await performSignOut({
      apiBase: "",
      mode: "session",
      everywhere: true,
      csrf: "",
      fetchImpl: f.impl,
    });
    assert.equal(out, "everywhere");
    assert.equal(f.calls[0].url, "/v1/auth/logout-all");
  });

  it("treats 401 as already signed out", async () => {
    const f = fakeFetch(401);
    assert.equal(
      await performSignOut({ apiBase: "", mode: "session", csrf: "", fetchImpl: f.impl }),
      "ok",
    );
  });

  it("still clears this browser when the server fails, and says so", async () => {
    for (const status of [500, "throw"] as const) {
      const local = memStore({ pv_session: "{}" });
      const f = fakeFetch(status);
      const out = await performSignOut({
        apiBase: "",
        mode: "session",
        csrf: "",
        fetchImpl: f.impl,
        local,
      });
      assert.equal(out, "local");
      assert.equal(local.data.has("pv_session"), false);
    }
  });

  it("guardian-key sessions clear the stored key without a server call", async () => {
    const local = memStore({ pv_session: '{"mode":"key","guardianKey":"gk_secret"}' });
    const f = fakeFetch(200);
    const out = await performSignOut({
      apiBase: "",
      mode: "key",
      csrf: "",
      fetchImpl: f.impl,
      local,
    });
    assert.equal(out, "ok");
    assert.equal(f.calls.length, 0);
    assert.equal(local.data.has("pv_session"), false);
  });
});

describe("sign-out helpers", () => {
  it("clearClientSession tolerates missing or throwing storage", () => {
    clearClientSession(null, undefined);
    clearClientSession(
      {
        removeItem: () => {
          throw new Error("denied");
        },
      },
      null,
    );
  });

  it("signed-out notices are plain, never the guardian-key rejection text", () => {
    for (const o of ["ok", "everywhere", "local"] as const) {
      const url = signedOutUrl(o);
      const v = new URL(url, "http://x").searchParams.get("signed_out");
      const n = signedOutNotice(v);
      assert.ok(n);
      assert.doesNotMatch(n.msg, /rejected/i);
    }
    assert.equal(signedOutNotice("ok")?.msg, "Signed out.");
    assert.equal(signedOutNotice(null), null);
    assert.equal(signedOutNotice("bogus"), null);
  });

  it("readCsrfCookie finds the csrf cookie", () => {
    assert.equal(readCsrfCookie("a=1; abi_csrf=x%2By; b=2"), "x+y");
    assert.equal(readCsrfCookie("a=1"), "");
  });
});
