import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assetDepositAddress,
  cardholderName,
  cardNumberRows,
  groupVaultAddress,
} from "./vault-card-format";

const ADDR = "0x626B15e6aA2c7Bd1Ff03a9e4C5d8b7F1a2E3c4D5";

describe("vault bank card formatting", () => {
  it("groups an EVM address like a card number, keeping every character", () => {
    const groups = groupVaultAddress(ADDR);
    assert.equal(groups[0], "0x626B");
    assert.equal(groups[1], "15e6");
    assert.equal(groups.length, 10);
    assert.equal(groups.join(""), ADDR);
  });

  it("returns no groups for an empty address", () => {
    assert.deepEqual(groupVaultAddress("  "), []);
  });

  it("splits groups into two rows of five", () => {
    const rows = cardNumberRows(groupVaultAddress(ADDR));
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.length, 5);
    assert.equal(rows[1]!.length, 5);
  });

  it("formats the cardholder name", () => {
    assert.equal(cardholderName("  Acme   robotics "), "ACME ROBOTICS");
    assert.equal(cardholderName(undefined), "ORGANIZATION");
    assert.equal(cardholderName("x".repeat(40)).length, 26);
  });
});

describe("per-asset deposit address on the vault card", () => {
  const chain = { kind: "chain" as const };
  it("uses the vault address for assets read on-chain from the vault", () => {
    for (const symbol of ["USDC", "EURC", "ETH"]) {
      const h = {
        id: `asset_${symbol.toLowerCase()}`,
        symbol,
        chain: "base-sepolia",
        backing: chain,
      };
      assert.equal(assetDepositAddress(h, ADDR), ADDR);
    }
  });

  it("never reuses the EVM vault address for manual-book assets", () => {
    const btc = { id: "asset_btc", symbol: "BTC", chain: "bitcoin", backing: { kind: "manual" } };
    const sol = { id: "asset_sol", symbol: "SOL", chain: "solana", backing: { kind: "manual" } };
    assert.equal(assetDepositAddress(btc, ADDR), null);
    assert.equal(assetDepositAddress(sol, ADDR), null);
  });

  it("has no address for an EVM asset whose chain has no RPC configured", () => {
    const dai = {
      id: "asset_dai",
      symbol: "DAI",
      chain: "ethereum",
      backing: { kind: "chain-unconfigured" },
    };
    assert.equal(assetDepositAddress(dai, ADDR), null);
  });

  it("falls back to the vault for USDC before asset details load, and to null without a vault", () => {
    assert.equal(
      assetDepositAddress({ id: "asset_usdc", symbol: "USDC", chain: "base-sepolia" }, ADDR),
      ADDR,
    );
    assert.equal(
      assetDepositAddress({ id: "asset_btc", symbol: "BTC", chain: "bitcoin" }, ADDR),
      null,
    );
    assert.equal(
      assetDepositAddress(
        { id: "asset_usdc", symbol: "USDC", chain: "base-sepolia", backing: chain },
        "",
      ),
      null,
    );
    assert.equal(assetDepositAddress(undefined, ADDR), null);
  });
});
