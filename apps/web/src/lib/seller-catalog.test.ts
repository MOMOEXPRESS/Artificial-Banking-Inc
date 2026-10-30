import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listingSummary, nextAction, toChallengeCheck } from "./seller-catalog";

describe("toChallengeCheck", () => {
  it("gives checks saved by older builds an empty problems list", () => {
    const check = toChallengeCheck({
      httpStatus: 402,
      expectedPayTo: "0x11",
      expectedNetwork: "base-sepolia",
      expectedPriceUsdc: "0.25",
    });
    assert.deepEqual(check?.problems, []);
    assert.equal(check?.offered, undefined);
    assert.equal(check?.httpStatus, 402);
  });

  it("keeps a current check as it is", () => {
    const check = toChallengeCheck({ httpStatus: 402, problems: ["wrong payee"], offered: [] });
    assert.deepEqual(check?.problems, ["wrong payee"]);
    assert.deepEqual(check?.offered, []);
  });

  it("returns null for missing or malformed values", () => {
    assert.equal(toChallengeCheck(null), null);
    assert.equal(toChallengeCheck("not json"), null);
    assert.equal(toChallengeCheck([1, 2]), null);
  });
});

describe("catalog listing line and inline action", () => {
  const base = {
    id: "offer_1",
    slug: "fx",
    title: "FX",
    endpointUrl: "https://api.example/fx",
    priceUsdc: "0.05",
    network: "base-sepolia",
    integration: { lastVerifiedAt: null, snippetVersion: null, error: null },
  } as const;

  it("says live, or names the next thing to fix", () => {
    assert.deepEqual(
      listingSummary({ ...base, status: "published", listing: { live: true, blockers: [] } }),
      { live: true, text: "Live in the buyer directory" },
    );
    assert.deepEqual(
      listingSummary({
        ...base,
        status: "draft",
        listing: {
          live: false,
          blockers: [
            { code: "NOT_VERIFIED", message: "Verify first." },
            { code: "NOT_PUBLISHED", message: "Publish once verified." },
          ],
        },
      }),
      { live: false, text: "Verify first." },
    );
  });

  it("offers verify for drafts, publish for verified offers, nothing once live", () => {
    assert.equal(nextAction({ ...base, status: "draft" }), "verify");
    assert.equal(
      nextAction({
        ...base,
        status: "verified",
        integration: { ...base.integration, lastVerifiedAt: "2026-10-30T00:00:00Z" },
      }),
      "publish",
    );
    assert.equal(nextAction({ ...base, status: "verified" }), "verify");
    assert.equal(nextAction({ ...base, status: "published" }), null);
    assert.equal(nextAction({ ...base, status: "paused" }), null);
    assert.equal(nextAction({ ...base, status: "draft", archivedAt: "2026-10-30" }), null);
  });
});
