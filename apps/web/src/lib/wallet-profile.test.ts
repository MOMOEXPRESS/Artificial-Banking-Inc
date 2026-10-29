import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assetInputDecimals,
  cardIdentifier,
  gasStatusLine,
  receiveAddressFor,
  type WalletProfile,
} from "./wallet-profile";

const ADDR = "0x266395d467b18d5C1e30df6B67fE6C88A140683e";
function profile(over: Partial<WalletProfile> = {}): WalletProfile {
  return {
    address: ADDR,
    addressVerified: true,
    verification: "verified",
    network: {
      id: "base-sepolia",
      name: "Base Sepolia",
      chainId: 84532,
      testnet: true,
      explorerAddress: null,
    },
    ledgerMode: "sandbox",
    balancesSimulated: true,
    usdc: { ledgerAvailableUsdc: "10.00", simulatedUsdc: "10.00", onchainUsdc: "0.00" },
    gas: {
      symbol: "ETH",
      networkName: "Base Sepolia",
      chainId: 84532,
      balanceEth: "0",
      recommendedMinEth: "0.002",
      sufficient: false,
      empty: true,
      readError: null,
    },
    funding: { instructions: [], wrongNetworks: [{ name: "Ethereum Sepolia", chainId: 11155111 }] },
    assets: [
      {
        assetId: "asset_usdc",
        symbol: "USDC",
        decimals: 6,
        networkName: "Base Sepolia",
        receiveAddress: ADDR,
        send: { mode: "simulated", reason: "" },
      },
      {
        assetId: "asset_eth",
        symbol: "ETH",
        decimals: 18,
        networkName: "Base Sepolia",
        receiveAddress: ADDR,
        send: { mode: "simulated", reason: "" },
      },
      {
        assetId: "asset_btc",
        symbol: "BTC",
        decimals: 8,
        networkName: "Bitcoin",
        receiveAddress: null,
        send: { mode: "recorded", reason: "" },
      },
    ],
    ...over,
  };
}

describe("wallet profile (console)", () => {
  it("offers only verified receiving addresses", () => {
    assert.equal(receiveAddressFor(profile(), "asset_usdc"), ADDR);
    assert.equal(receiveAddressFor(profile(), "asset_btc"), null);
    assert.equal(receiveAddressFor(profile({ addressVerified: false }), "asset_usdc"), null);
    assert.equal(receiveAddressFor(null, "asset_usdc"), null);
  });

  it("card identifier is decorative and never the full address", () => {
    const id = cardIdentifier(ADDR);
    assert.equal(id, "ABI •••• 683E");
    assert.ok(!id.includes("0x"));
  });

  it("gas line names Base Sepolia + chain id and warns despite USDC", () => {
    const line = gasStatusLine(profile());
    assert.equal(line.tone, "warn");
    assert.match(line.text, /Base Sepolia ETH \(chain 84532\)/);
    assert.match(line.text, /USDC cannot pay gas/);
    const unknown = gasStatusLine(
      profile({ gas: { ...profile().gas, balanceEth: null, sufficient: null } }),
    );
    assert.equal(unknown.tone, "unknown");
  });

  it("uses the asset's decimals for amount input (ETH 18)", () => {
    assert.equal(assetInputDecimals(profile(), "asset_eth"), 18);
    assert.equal(assetInputDecimals(profile(), "asset_usdc"), 6);
  });
});
