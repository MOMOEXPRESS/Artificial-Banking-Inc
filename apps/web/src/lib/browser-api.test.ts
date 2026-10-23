import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { browserApiBase, sellerUrl } from "./browser-api.js";

describe("browserApiBase", () => {
  it("returns /abi-api when NEXT_PUBLIC_API_URL is absolute (cookie-safe)", () => {
    const prev = process.env.NEXT_PUBLIC_API_URL;
    process.env.NEXT_PUBLIC_API_URL = "https://abi-api.onrender.com";
    assert.equal(browserApiBase(), "/abi-api");
    if (prev === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = prev;
  });

  it("keeps relative configured paths", () => {
    const prev = process.env.NEXT_PUBLIC_API_URL;
    process.env.NEXT_PUBLIC_API_URL = "/custom-api";
    assert.equal(browserApiBase(), "/custom-api");
    if (prev === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = prev;
  });
});

describe("sellerUrl", () => {
  it("uses NEXT_PUBLIC_SELLER_URL when set", () => {
    const prev = process.env.NEXT_PUBLIC_SELLER_URL;
    const prevVercel = process.env.VERCEL;
    process.env.NEXT_PUBLIC_SELLER_URL = "https://seller.example/report/";
    process.env.VERCEL = "1";
    assert.equal(sellerUrl(), "https://seller.example/report");
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SELLER_URL;
    else process.env.NEXT_PUBLIC_SELLER_URL = prev;
    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
  });

  it("returns null on Vercel when unset (no silent localhost)", () => {
    const prev = process.env.NEXT_PUBLIC_SELLER_URL;
    const prevVercel = process.env.VERCEL;
    delete process.env.NEXT_PUBLIC_SELLER_URL;
    process.env.VERCEL = "1";
    assert.equal(sellerUrl(), null);
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SELLER_URL;
    else process.env.NEXT_PUBLIC_SELLER_URL = prev;
    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
  });
});
