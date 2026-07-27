/**
 * P7-T3: an asset is either read from the chain or recorded by hand, and the
 * product must always be able to say which.
 *
 * These cover classification only — no network. The balance read itself needs
 * a funded vault on a real chain and is on the manual verification list.
 */
import assert from "node:assert/strict";
import type { AssetRecord } from "@policyvault/common";
import { beforeEach, describe, it } from "node:test";
import { assetBacking } from "./asset-adapters.js";

const asset = (over: Partial<AssetRecord>): AssetRecord => ({
  id: "asset_test",
  symbol: "TEST",
  decimals: 6,
  chain: "base-sepolia",
  contract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  ...over,
});

beforeEach(() => {
  delete process.env.ETHEREUM_RPC_URL;
  delete process.env.MAINNET_RPC_URL;
});

describe("assetBacking", () => {
  it("treats an ERC-20 on the active chain as chain-backed", () => {
    const info = assetBacking(asset({ symbol: "EURC" }));
    assert.equal(info.kind, "chain");
    assert.equal(info.reason, undefined);
  });

  it("treats a native coin as manual, because only ERC-20 reads exist", () => {
    const info = assetBacking(asset({ symbol: "ETH", chain: "ethereum", contract: null }));
    assert.equal(info.kind, "manual");
    assert.match(info.reason ?? "", /native coin/i);
  });

  it("treats a non-EVM chain as manual and names the chain", () => {
    const info = assetBacking(asset({ symbol: "BTC", chain: "bitcoin", contract: null }));
    assert.equal(info.kind, "manual");
    assert.match(info.reason ?? "", /bitcoin/i);
  });

  it("distinguishes 'no RPC configured' from 'no adapter exists'", () => {
    // An ERC-20 on a chain we understand, but cannot reach. That is a config
    // gap the operator can close, not a missing capability — and the message
    // has to say which env var closes it.
    const info = assetBacking(asset({ symbol: "DAI", chain: "ethereum" }));
    assert.equal(info.kind, "chain-unconfigured");
    assert.match(info.reason ?? "", /ETHEREUM_RPC_URL/);

    process.env.ETHEREUM_RPC_URL = "https://example-rpc.invalid";
    assert.equal(assetBacking(asset({ symbol: "DAI", chain: "ethereum" })).kind, "chain");
  });

  it("carries the contract and chain through untouched, for display", () => {
    const info = assetBacking(asset({ symbol: "USDT", chain: "ethereum", contract: "0xdAC17" }));
    assert.equal(info.contract, "0xdAC17");
    assert.equal(info.chain, "ethereum");
    assert.equal(info.symbol, "USDT");
  });
});
