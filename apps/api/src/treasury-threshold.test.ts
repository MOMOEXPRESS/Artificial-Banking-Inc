/**
 * The treasury approval limit is a THRESHOLD that routes guardian outflows to
 * review — it never refuses anything, and it is not a second gate on top of
 * the hard limits.
 *
 *   below / at the threshold -> runs now
 *   above the threshold      -> parks for guardian review, runs once approved
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-tthr-"));
process.env.POLICYVAULT_DB = join(dir, "tthr.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";

const { store } = await import("./store.js");
const { app } = await import("./index.js");
const { __resetTreasuryGuardForTests } = await import("./treasury-guard.js");
const {
  DEFAULT_TREASURY_APPROVAL_THRESHOLD_MICRO,
  treasuryApprovalThresholdMicro,
  treasuryThresholdOutcome,
} = await import("./treasury-threshold.js");

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

beforeEach(() => __resetTreasuryGuardForTests());

const DEST = "0x5555555555555555555555555555555555555555";

type Json = Record<string, unknown> & {
  ok?: boolean;
  outcome?: string;
  awaitingVotes?: number;
  thresholdUsdc?: string;
  ruleIds?: string[];
  move?: { id: string; status: string; kind?: string; destination?: string; votes: string[] };
  moves?: { id: string; status: string; kind?: string }[];
  error?: { code?: string; message?: string };
};

async function call(key: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Json };
}

/** Sandbox org with $100 in the treasury and the given review threshold. */
async function orgWithThreshold(threshold: string) {
  const org = store.createOrg(`Threshold Co ${threshold}`, 100_000_000n);
  const saved = await call(org.guardianKey, "PATCH", "/v1/guardian/settings", {
    settings: { treasuryHitlUsdc: threshold },
  });
  assert.equal(saved.status, 200);
  return org;
}

const orgAvailable = (orgId: string) =>
  store.getAccountMap(orgId).get(`org:${orgId}:available`)?.balanceMicro ?? 0n;

function budget(orgId: string) {
  return store.createDepartment(orgId, "Ops");
}

describe("treasury threshold — pure rule", () => {
  it("reviews strictly above the threshold and allows at or below it", () => {
    assert.equal(treasuryThresholdOutcome(4_990_000n, 5_000_000n), "allow");
    assert.equal(treasuryThresholdOutcome(5_000_000n, 5_000_000n), "allow");
    assert.equal(treasuryThresholdOutcome(5_000_001n, 5_000_000n), "review");
  });

  it("a zero threshold reviews every positive amount", () => {
    assert.equal(treasuryThresholdOutcome(1n, 0n), "review");
  });

  it("falls back to the $50 default for a missing or malformed setting, never to 'no review'", () => {
    assert.equal(treasuryApprovalThresholdMicro({}), DEFAULT_TREASURY_APPROVAL_THRESHOLD_MICRO);
    assert.equal(treasuryApprovalThresholdMicro(undefined), 50_000_000n);
    assert.equal(treasuryApprovalThresholdMicro({ treasuryHitlUsdc: "abc" }), 50_000_000n);
    assert.equal(treasuryApprovalThresholdMicro({ treasuryHitlUsdc: "-5" }), 50_000_000n);
    assert.equal(treasuryApprovalThresholdMicro({ treasuryHitlUsdc: "12.5" }), 12_500_000n);
    assert.equal(treasuryApprovalThresholdMicro({ treasuryHitlUsdc: 7 }), 7_000_000n);
  });
});

describe("treasury threshold — settings", () => {
  it("refuses a malformed or negative threshold instead of silently defaulting", async () => {
    const org = store.createOrg("Bad Threshold Co", 100_000_000n);
    for (const bad of ["-1", "abc", "", null]) {
      const r = await call(org.guardianKey, "PATCH", "/v1/guardian/settings", {
        settings: { treasuryHitlUsdc: bad },
      });
      assert.equal(r.status, 400, `treasuryHitlUsdc=${String(bad)} must be refused`);
    }
  });
});

describe("treasury threshold — internal moves", () => {
  for (const [label, amount, expect] of [
    ["below", "4.99", "executed"],
    ["at", "5", "executed"],
    ["above", "5.01", "pending"],
  ] as const) {
    it(`${label} the threshold: ${expect}`, async () => {
      const org = await orgWithThreshold("5");
      const dept = budget(org.id);
      const r = await call(org.guardianKey, "POST", "/v1/guardian/wallets/move", {
        from: { scope: "org", id: org.id },
        to: { scope: "department", id: dept.id },
        amountUsdc: amount,
      });
      if (expect === "executed") {
        assert.equal(r.status, 200);
        assert.equal(r.body.outcome, "allow");
        assert.equal(r.body.move?.status, "executed");
      } else {
        assert.equal(r.status, 202, "above the threshold is routed to review, not refused");
        assert.equal(r.body.outcome, "review");
        assert.equal(r.body.move?.status, "pending");
        assert.equal(r.body.thresholdUsdc, "5");
        assert.equal(orgAvailable(org.id), 100_000_000n, "nothing moves until reviewed");
        const ok = await call(
          org.guardianKey,
          "POST",
          `/v1/guardian/treasury/moves/${r.body.move!.id}/resolve`,
          { approve: true },
        );
        assert.equal(ok.status, 200);
        assert.equal(ok.body.move?.status, "executed");
        assert.equal(orgAvailable(org.id), 100_000_000n - 5_010_000n);
      }
    });
  }
});

describe("treasury threshold — guardian withdrawals", () => {
  it("below the threshold: sends immediately", async () => {
    const org = await orgWithThreshold("5");
    const r = await call(org.guardianKey, "POST", "/v1/guardian/treasury/withdraw", {
      amountUsdc: "4.99",
      destination: DEST,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(orgAvailable(org.id), 100_000_000n - 4_990_000n);
  });

  it("exactly at the threshold: sends immediately", async () => {
    const org = await orgWithThreshold("5");
    const r = await call(org.guardianKey, "POST", "/v1/guardian/treasury/withdraw", {
      amountUsdc: "5",
      destination: DEST,
    });
    assert.equal(r.status, 200);
    assert.equal(orgAvailable(org.id), 95_000_000n);
  });

  it("above the threshold: parks for review, then sends once a guardian approves", async () => {
    const org = await orgWithThreshold("5");
    const r = await call(org.guardianKey, "POST", "/v1/guardian/treasury/withdraw", {
      amountUsdc: "20",
      destination: DEST,
    });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(r.body.outcome, "review");
    assert.equal(r.body.move?.kind, "withdraw");
    assert.equal(r.body.move?.destination, DEST);
    assert.equal(orgAvailable(org.id), 100_000_000n, "parked: the books are untouched");

    const listed = await call(org.guardianKey, "GET", "/v1/guardian/treasury/moves?status=pending");
    assert.ok(listed.body.moves?.some((m) => m.id === r.body.move!.id && m.kind === "withdraw"));

    const ok = await call(
      org.guardianKey,
      "POST",
      `/v1/guardian/treasury/moves/${r.body.move!.id}/resolve`,
      { approve: true },
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.body.move?.status, "executed");
    assert.equal(orgAvailable(org.id), 80_000_000n);

    // A second approval is a replay, never a second send.
    const again = await call(
      org.guardianKey,
      "POST",
      `/v1/guardian/treasury/moves/${r.body.move!.id}/resolve`,
      { approve: true },
    );
    assert.equal(again.body.replayed, true);
    assert.equal(orgAvailable(org.id), 80_000_000n);
  });

  it("above the threshold: a denial stops it and nothing moves", async () => {
    const org = await orgWithThreshold("5");
    const r = await call(org.guardianKey, "POST", "/v1/guardian/treasury/withdraw", {
      amountUsdc: "20",
      destination: DEST,
    });
    const no = await call(
      org.guardianKey,
      "POST",
      `/v1/guardian/treasury/moves/${r.body.move!.id}/resolve`,
      { approve: false },
    );
    assert.equal(no.body.move?.status, "denied");
    assert.equal(orgAvailable(org.id), 100_000_000n);
  });

  it("is not a second gate: a request the hard limits refuse is refused, never parked", async () => {
    const org = await orgWithThreshold("5");
    store.setOrgStatus(org.id, "frozen");
    const r = await call(org.guardianKey, "POST", "/v1/guardian/treasury/withdraw", {
      amountUsdc: "20",
      destination: DEST,
    });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body.ruleIds, ["org_frozen"]);
    const pending = await call(
      org.guardianKey,
      "GET",
      "/v1/guardian/treasury/moves?status=pending",
    );
    assert.equal(pending.body.moves?.length, 0);
  });

  it("re-checks the hard limits when an approved request executes", async () => {
    const org = await orgWithThreshold("5");
    const r = await call(org.guardianKey, "POST", "/v1/guardian/treasury/withdraw", {
      amountUsdc: "20",
      destination: DEST,
    });
    store.setOrgStatus(org.id, "frozen");
    const ok = await call(
      org.guardianKey,
      "POST",
      `/v1/guardian/treasury/moves/${r.body.move!.id}/resolve`,
      { approve: true },
    );
    assert.equal(ok.status, 403);
    assert.equal(ok.body.move?.status, "cancelled");
    assert.equal(orgAvailable(org.id), 100_000_000n);
  });

  it("needs the org's approval quorum of distinct guardians — a typed name is not a vote", async () => {
    const org = await orgWithThreshold("5");
    const added = await call(org.guardianKey, "POST", "/v1/guardian/guardians", {
      name: "Second approver",
    });
    assert.equal(added.status, 201);
    const secondKey = added.body.guardianKey as string;
    assert.equal(
      (await call(org.guardianKey, "POST", "/v1/guardian/quorum", { approvalQuorum: 2 })).status,
      200,
    );
    const r = await call(org.guardianKey, "POST", "/v1/guardian/treasury/withdraw", {
      amountUsdc: "20",
      destination: DEST,
    });
    assert.equal(r.status, 202);
    assert.equal(r.body.awaitingVotes, 1, "the requester's own approval counts once");

    // The requester cannot reach quorum alone, even under another name.
    const self = await call(
      org.guardianKey,
      "POST",
      `/v1/guardian/treasury/moves/${r.body.move!.id}/resolve`,
      { approve: true, resolvedBy: "someone-else" },
    );
    assert.equal(self.body.awaitingVotes, 1);
    assert.equal(orgAvailable(org.id), 100_000_000n);

    const second = await call(
      secondKey,
      "POST",
      `/v1/guardian/treasury/moves/${r.body.move!.id}/resolve`,
      { approve: true },
    );
    assert.equal(second.status, 200);
    assert.equal(second.body.move?.status, "executed");
    assert.equal(orgAvailable(org.id), 80_000_000n);
  });
});
