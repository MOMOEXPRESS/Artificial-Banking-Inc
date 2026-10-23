import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activityForAsset,
  deriveVaultStatus,
  lastProcessed,
  relativeTime,
  stripChips,
  type VaultStatusInput,
} from "./vault-status";

const base: VaultStatusInput = {
  assetId: "asset_usdc",
  symbol: "USDC",
  actionInFlight: false,
  moves: [],
  deposits: [],
  activity: [],
};

describe("deriveVaultStatus", () => {
  it("is idle when nothing has happened and nothing is running", () => {
    const s = deriveVaultStatus(base);
    assert.equal(s.state, "idle");
    assert.equal(s.title, "Idle");
    assert.equal(s.last, null);
  });

  it("reports the most recent completed action as last processed", () => {
    const s = deriveVaultStatus({
      ...base,
      activity: [
        {
          id: "a",
          label: "Demo ledger credit",
          at: "2026-10-23T10:00:00Z",
          amountUsdc: "100",
          direction: "in",
        },
        {
          id: "b",
          label: "Received on-chain",
          at: "2026-10-23T12:00:00Z",
          amountUsdc: "20",
          direction: "in",
          assetId: "asset_usdc",
          symbol: "USDC",
          explorerUrl: "https://sepolia.basescan.org/tx/0xabc",
        },
      ],
      moves: [
        {
          id: "m",
          amountUsdc: "25",
          status: "executed",
          createdAt: "2026-10-23T11:00:00Z",
          route: "Org treasury → Budget · Ops",
        },
      ],
    });
    assert.equal(s.state, "processed");
    assert.equal(s.title, "Last processed");
    assert.equal(s.last?.at, "2026-10-23T12:00:00Z");
    assert.equal(s.last?.label, "+20 USDC · Received on-chain");
    assert.equal(s.last?.explorerUrl, "https://sepolia.basescan.org/tx/0xabc");
  });

  it("uses executed moves for USDC and labels the route", () => {
    const last = lastProcessed({
      ...base,
      moves: [
        { id: "p", amountUsdc: "5", status: "pending", createdAt: "2026-10-23T13:00:00Z" },
        {
          id: "x",
          amountUsdc: "25",
          status: "executed",
          createdAt: "2026-10-23T11:00:00Z",
          route: "Org treasury → Budget · Ops",
        },
      ],
    });
    assert.equal(last?.label, "Moved $25.00 · Org treasury → Budget · Ops");
  });

  it("is processing while an action is in flight, keeping the last processed time", () => {
    const s = deriveVaultStatus({
      ...base,
      actionInFlight: true,
      activity: [
        {
          id: "a",
          label: "Ledger send / withdraw",
          at: "2026-10-23T10:00:00Z",
          amountUsdc: "3",
          direction: "out",
        },
      ],
    });
    assert.equal(s.state, "processing");
    assert.match(s.detail, /Submitting/);
    assert.equal(s.last?.label, "−3 USDC · Ledger send / withdraw");
  });

  it("is processing when deposits are detected but not yet credited, or moves await approval", () => {
    const s = deriveVaultStatus({
      ...base,
      deposits: [
        { txHash: "0x1", amountUsdc: "1", status: "detected" },
        { txHash: "0x2", amountUsdc: "1", status: "credited" },
      ],
      moves: [
        { id: "p1", amountUsdc: "5", status: "pending", createdAt: "2026-10-23T13:00:00Z" },
        { id: "p2", amountUsdc: "6", status: "pending", createdAt: "2026-10-23T13:01:00Z" },
      ],
    });
    assert.equal(s.state, "processing");
    assert.equal(s.detail, "1 deposit seen on-chain, crediting · 2 moves awaiting approval");
  });

  it("scopes to the selected asset: USDC moves and deposits do not make ETH busy", () => {
    const s = deriveVaultStatus({
      ...base,
      assetId: "asset_eth",
      symbol: "ETH",
      deposits: [{ txHash: "0x1", amountUsdc: "1", status: "detected" }],
      moves: [{ id: "p", amountUsdc: "5", status: "pending", createdAt: "2026-10-23T13:00:00Z" }],
      activity: [
        {
          id: "u",
          label: "Received on-chain",
          at: "2026-10-23T12:00:00Z",
          amountUsdc: "20",
          direction: "in",
          assetId: "asset_usdc",
        },
        {
          id: "e",
          label: "Received ETH",
          at: "2026-10-23T09:00:00Z",
          amountUsdc: "0.5",
          direction: "in",
          assetId: "asset_eth",
          symbol: "ETH",
        },
      ],
    });
    assert.equal(s.state, "processed");
    assert.equal(s.last?.label, "+0.5 ETH · Received ETH");
  });

  it("ignores rows with unparseable timestamps instead of crashing", () => {
    const s = deriveVaultStatus({
      ...base,
      activity: [{ id: "a", label: "x", at: "not-a-date", amountUsdc: "1", direction: "in" }],
    });
    assert.equal(s.state, "idle");
  });
});

describe("activityForAsset", () => {
  it("treats rows without an asset id as USDC", () => {
    const rows = [
      { id: "a", label: "", at: "", amountUsdc: "1", direction: "in" as const },
      {
        id: "b",
        label: "",
        at: "",
        amountUsdc: "1",
        direction: "in" as const,
        assetId: "asset_usdt",
      },
    ];
    assert.deepEqual(
      activityForAsset(rows, "asset_usdc").map((r) => r.id),
      ["a"],
    );
    assert.deepEqual(
      activityForAsset(rows, "asset_usdt").map((r) => r.id),
      ["b"],
    );
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-23T15:00:00Z");
  it("formats compact relative times", () => {
    assert.equal(relativeTime("2026-10-23T14:59:50Z", now), "just now");
    assert.equal(relativeTime("2026-10-23T14:55:00Z", now), "5 min ago");
    assert.equal(relativeTime("2026-10-23T12:00:00Z", now), "3 h ago");
    assert.equal(relativeTime("2026-10-21T15:00:00Z", now), "2 d ago");
    assert.equal(relativeTime("garbage", now), "");
  });
});

describe("stripChips", () => {
  it("shows a small 'chain status unavailable' note when the vault chain read fails", () => {
    const chips = stripChips({
      assetId: "asset_usdc",
      chain: { ok: false, error: "eth_getLogs range too large", networkName: "Base Sepolia" },
      checking: false,
    });
    assert.deepEqual(
      chips.map((c) => [c.key, c.text, c.tone]),
      [
        ["net", "Base Sepolia", "mute"],
        ["chain", "Chain status unavailable", "warn"],
      ],
    );
    assert.match(chips[1]!.title ?? "", /range too large/);
  });

  it("treats a missing chain snapshot as unavailable once not checking", () => {
    const chips = stripChips({ assetId: "asset_usdc", chain: null, checking: false });
    assert.equal(chips[1]?.text, "Chain status unavailable");
    const checking = stripChips({ assetId: "asset_usdc", chain: null, checking: true });
    assert.equal(checking[1]?.text, "Checking chain…");
  });

  it("keeps gas and drift as inline details when the chain read works", () => {
    const ok = stripChips({
      assetId: "asset_usdc",
      chain: { ok: true, networkName: "Base Sepolia", nativeBalanceEth: "0.01", hasGas: true },
      checking: false,
      backing: { checked: true, ok: true, driftUsdc: "0" },
    });
    assert.deepEqual(
      ok.map((c) => c.text),
      ["Base Sepolia", "Gas 0.01 ETH"],
    );
    const noGas = stripChips({
      assetId: "asset_usdc",
      chain: { ok: true, networkName: "Base Sepolia", nativeBalanceEth: "0", hasGas: false },
      checking: false,
      backing: { checked: true, ok: false, driftUsdc: "-20" },
    });
    assert.deepEqual(
      noGas.map((c) => [c.text, c.tone]),
      [
        ["Base Sepolia", "mute"],
        ["No gas", "warn"],
        ["Drift -20 USDC", "warn"],
      ],
    );
  });

  it("describes how non-USDC assets are backed", () => {
    assert.equal(
      stripChips({
        assetId: "asset_eth",
        chain: null,
        checking: false,
        holding: { backing: { kind: "manual" } },
      })[0]?.text,
      "Recorded by hand",
    );
    assert.equal(
      stripChips({
        assetId: "asset_usdt",
        chain: null,
        checking: false,
        holding: { backing: { kind: "chain-unconfigured" } },
      })[0]?.text,
      "Not read on-chain",
    );
    assert.equal(
      stripChips({
        assetId: "asset_eurc",
        chain: null,
        checking: false,
        holding: { backing: { kind: "chain" }, onchainError: "rpc down" },
      })[0]?.text,
      "Chain status unavailable",
    );
    assert.deepEqual(stripChips({ assetId: "asset_x", chain: null, checking: false }), []);
  });
});
