import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  looksLikeEmail,
  parseWaitlistResponse,
  waitlistPayload,
  waitlistReferrer,
} from "./waitlist";

describe("waitlist form", () => {
  it("accepts plausible emails and rejects junk", () => {
    assert.ok(looksLikeEmail(" Ada@Example.com "));
    for (const bad of ["", "nope", "a@b", "x@exa mple.com", "a..b@example.com"]) {
      assert.equal(looksLikeEmail(bad), false, bad);
    }
  });

  it("prefers ?ref= over the document referrer and drops same-site referrers", () => {
    assert.equal(
      waitlistReferrer("?ref=hn", "https://news.ycombinator.com/item?id=1", "abi.dev"),
      "ref:hn",
    );
    assert.equal(
      waitlistReferrer("", "https://news.ycombinator.com/item?id=1", "abi.dev"),
      "https://news.ycombinator.com/item",
    );
    assert.equal(waitlistReferrer("", "https://abi.dev/pricing", "abi.dev"), "");
    assert.equal(waitlistReferrer("", "not a url", "abi.dev"), "");
  });

  it("always sends the honeypot field and trims the email", () => {
    assert.deepEqual(
      waitlistPayload({ email: " a@example.com ", source: "landing", referrer: "", honeypot: "" }),
      { email: "a@example.com", source: "landing", website: "" },
    );
    assert.equal(
      waitlistPayload({
        email: "a@example.com",
        source: "waitlist-page",
        referrer: "ref:hn",
        honeypot: "",
      }).referrer,
      "ref:hn",
    );
  });

  it("maps API answers to what the visitor sees", () => {
    assert.deepEqual(parseWaitlistResponse(200, { ok: true, message: "You're on the list." }), {
      kind: "joined",
      message: "You're on the list.",
    });
    assert.equal(
      parseWaitlistResponse(400, { error: { message: "Enter a valid email address." } }).kind,
      "invalid",
    );
    assert.equal(parseWaitlistResponse(429, {}).kind, "rate_limited");
    assert.equal(parseWaitlistResponse(503, null).kind, "error");
    assert.equal(parseWaitlistResponse(200, { ok: false }).kind, "error");
  });
});
