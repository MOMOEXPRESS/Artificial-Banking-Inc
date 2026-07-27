/**
 * EIP-712 domain correctness (audit finding P5-T1).
 *
 * The client hardcoded `name: "USD Coin"` for every network. Base Sepolia's
 * USDC is named "USDC", so on the default chain every TransferWithAuthorization
 * was signed over the wrong domain separator and recovered to the wrong
 * address. The bundled dev facilitator shared the same wrong constant, so the
 * demo agreed with itself and passed — which is why x402 had never settled
 * against a real verifier despite the docs saying it had.
 *
 * The recovery assertions below are the ones that matter: they check the
 * signature against an independently-derived address, not against our own
 * constant.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { verifyTypedData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { AUTHORIZATION_TYPES, eip712Domain } from "../rails/x402.js";
import { chainIdFor, resetTokenDomainCacheForTests, tokenDomain } from "./token-domain.js";

const SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

afterEach(() => resetTokenDomainCacheForTests());

describe("tokenDomain", () => {
  it("uses the name Base Sepolia USDC actually reports", () => {
    // Verified against the deployed contract, not assumed.
    const d = tokenDomain("base-sepolia", SEPOLIA_USDC);
    assert.equal(d.name, "USDC");
    assert.equal(d.version, "2");
    assert.equal(d.chainId, 84532);
  });

  it("uses the different name Base mainnet USDC reports", () => {
    const d = tokenDomain("base", MAINNET_USDC);
    assert.equal(d.name, "USD Coin", "mainnet genuinely differs from testnet");
    assert.equal(d.chainId, 8453);
  });

  it("gives the two networks different domains", () => {
    // The regression in one line: a single hardcoded name cannot be right for
    // both, and the old code used mainnet's on testnet.
    assert.notEqual(
      tokenDomain("base-sepolia", SEPOLIA_USDC).name,
      tokenDomain("base", MAINNET_USDC).name,
    );
  });

  it("refuses an unknown token instead of guessing", () => {
    // A wrong domain yields a signature recovering to some other address —
    // worse than refusing to sign.
    assert.throws(
      () => tokenDomain("base-sepolia", "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"),
      /Refusing to sign/,
    );
  });

  it("maps networks to the right chain ids", () => {
    assert.equal(chainIdFor("base"), 8453);
    assert.equal(chainIdFor("base-sepolia"), 84532);
  });
});

describe("eip712Domain — signatures recover to the signer", () => {
  const authorization = {
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    value: 1_200_000n,
    validAfter: 0n,
    validBefore: 4_000_000_000n,
    nonce: "0x0000000000000000000000000000000000000000000000000000000000000001",
  } as const;

  async function signAndRecover(network: "base" | "base-sepolia", asset: `0x${string}`) {
    const account = privateKeyToAccount(generatePrivateKey());
    const domain = eip712Domain(network, asset);
    const message = { ...authorization, from: account.address };

    const signature = await account.signTypedData({
      domain,
      types: AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message,
    });
    return { account, domain, message, signature };
  }

  it("verifies on Base Sepolia under the contract's real domain", async () => {
    const { account, domain, message, signature } = await signAndRecover(
      "base-sepolia",
      SEPOLIA_USDC,
    );
    assert.equal(domain.name, "USDC");
    assert.equal(
      await verifyTypedData({
        address: account.address,
        domain,
        types: AUTHORIZATION_TYPES,
        primaryType: "TransferWithAuthorization",
        message,
        signature,
      }),
      true,
    );
  });

  it("fails to verify under the old hardcoded domain", async () => {
    // This is the defect, reproduced: a verifier using the contract's real
    // domain rejects a signature made with the old constant.
    const { account, message, signature } = await signAndRecover("base-sepolia", SEPOLIA_USDC);
    const wrongDomain = {
      name: "USD Coin", // what the code used to send for every network
      version: "2",
      chainId: 84532,
      verifyingContract: SEPOLIA_USDC,
    } as const;

    assert.equal(
      await verifyTypedData({
        address: account.address,
        domain: wrongDomain,
        types: AUTHORIZATION_TYPES,
        primaryType: "TransferWithAuthorization",
        message,
        signature,
      }),
      false,
      "the old domain and the real one must not agree — that is the bug",
    );
  });

  it("verifies on Base mainnet under its own domain", async () => {
    const { account, domain, message, signature } = await signAndRecover("base", MAINNET_USDC);
    assert.equal(domain.name, "USD Coin");
    assert.equal(
      await verifyTypedData({
        address: account.address,
        domain,
        types: AUTHORIZATION_TYPES,
        primaryType: "TransferWithAuthorization",
        message,
        signature,
      }),
      true,
    );
  });

  it("does not let a mainnet-signed authorization verify on testnet", async () => {
    // chainId is part of the separator, so cross-network replay is refused.
    const account = privateKeyToAccount(generatePrivateKey());
    const message = { ...authorization, from: account.address };
    const signature = await account.signTypedData({
      domain: eip712Domain("base", MAINNET_USDC),
      types: AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message,
    });

    assert.equal(
      await verifyTypedData({
        address: account.address,
        domain: eip712Domain("base-sepolia", SEPOLIA_USDC),
        types: AUTHORIZATION_TYPES,
        primaryType: "TransferWithAuthorization",
        message,
        signature,
      }),
      false,
    );
  });
});
