import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { holdingNetwork, networkLabel } from "./network-names";

describe("networkLabel", () => {
  it("maps API chain ids to display names", () => {
    assert.equal(networkLabel("base-sepolia"), "Base Sepolia");
    assert.equal(networkLabel("eip155:84532"), "Base Sepolia");
    assert.equal(networkLabel("base"), "Base");
    assert.equal(networkLabel("eip155:8453"), "Base");
    assert.equal(networkLabel("ethereum"), "Ethereum");
  });

  it("never echoes a raw id for unknown chains", () => {
    assert.equal(networkLabel("arbitrum-sepolia"), "Arbitrum Sepolia");
    assert.equal(networkLabel("eip155:42161"), "Chain 42161");
    assert.equal(networkLabel(undefined), "—");
    assert.equal(networkLabel("", "Base Sepolia"), "Base Sepolia");
  });
});

describe("holdingNetwork", () => {
  it("prefers the API's networkName, else maps the chain id", () => {
    assert.equal(
      holdingNetwork({ chain: "base-sepolia", networkName: "Base Sepolia" }),
      "Base Sepolia",
    );
    assert.equal(holdingNetwork({ chain: "base-sepolia" }), "Base Sepolia");
    assert.equal(holdingNetwork(undefined), "—");
  });
});
