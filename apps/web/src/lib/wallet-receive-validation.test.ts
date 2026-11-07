import { test } from "node:test";
import assert from "node:assert/strict";
import { hasReceivingDetails } from "./wallet-receive-validation";
const valid = {
  addressVerified: true,
  network: { name: "Base Sepolia", testnet: true, chainId: 84532 },
  assets: [{ assetId: "asset_usdc", receiveAddress: `0x${"1".repeat(40)}` }],
};
test("receive rejects partial, malformed or unsafe successful payloads", () => {
  assert.equal(hasReceivingDetails(valid), true);
  for (const bad of [
    null,
    {},
    { ...valid, network: null },
    { ...valid, assets: undefined },
    { ...valid, assets: [{ assetId: "asset_usdc", receiveAddress: "not-an-address" }] },
    { ...valid, funding: { instructions: {} } },
  ])
    assert.equal(hasReceivingDetails(bad), false);
});
test("a valid unverified/no-address profile is accepted as explicitly unavailable", () => {
  assert.equal(
    hasReceivingDetails({
      ...valid,
      addressVerified: false,
      assets: [{ assetId: "asset_usdc", receiveAddress: null }],
    }),
    true,
  );
});
