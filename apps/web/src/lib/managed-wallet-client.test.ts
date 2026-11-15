import assert from "node:assert/strict";
import { test } from "node:test";
import { parseManagedWallet, managedWalletReady } from "./managed-wallet-client";
const oldResponse = {
  provider: "privy",
  control: "abi-managed",
  workspaceId: "general",
  status: "ready",
  address: "0x1111111111111111111111111111111111111111",
  providerWalletId: "existing",
  verifiedAt: "2026-11-15T00:00:00.000Z",
  receiveEnabled: true,
  withdrawalEnabled: true,
  spendingEnabled: false,
  selectedAssetId: "base:usdc",
  asset: { id: "base:usdc", symbol: "USDC", network: "Base", chainId: 8453, testnet: false },
  assets: [{ id: "base:usdc", symbol: "USDC", network: "Base", chainId: 8453, testnet: false }],
  balance: { status: "available", amount: "20", observedAt: "2026-11-15T00:00:00.000Z" },
  explorerAddress: "https://basescan.org/address/0x1111111111111111111111111111111111111111",
};
test("existing API responses without accountSymbol retain their verified address and balance", () => {
  const wallet = parseManagedWallet(oldResponse);
  assert.equal(wallet.accountSymbol, undefined);
  assert.equal(wallet.address, oldResponse.address);
  assert.equal(wallet.balance.amount, "20");
  assert.equal(managedWalletReady(wallet), true);
  assert.equal(managedWalletReady(wallet, { accountSymbol: "USDC", assetId: "base:usdc" }), false);
});
test("new API responses enable recovery only for the requested source account and asset", () => {
  const wallet = parseManagedWallet({ ...oldResponse, accountSymbol: "USDC" });
  assert.equal(managedWalletReady(wallet), true);
  assert.equal(managedWalletReady(wallet, { accountSymbol: "USDC", assetId: "base:usdc" }), true);
  assert.equal(managedWalletReady(wallet, { accountSymbol: "ETH", assetId: "base:usdc" }), false);
  assert.equal(
    managedWalletReady(wallet, { accountSymbol: "USDC", assetId: "ethereum:usdc" }),
    false,
  );
  assert.equal(managedWalletReady({ ...wallet, accountSymbol: "ETH" }), false);
});
test("invalid wallet metadata produces a readable error and never exposes raw validation details", () => {
  for (const value of [
    { ...oldResponse, accountSymbol: "invalid" },
    { ...oldResponse, address: "bad" },
  ]) {
    assert.throws(() => parseManagedWallet(value), {
      message: "Wallet details could not be loaded. Please refresh and try again.",
    });
  }
  assert.equal(
    managedWalletReady(
      parseManagedWallet({
        ...oldResponse,
        status: "setup_pending",
        address: null,
        receiveEnabled: false,
      }),
    ),
    false,
  );
});
