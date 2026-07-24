import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isEvmPayDestination } from "./evm-usdc-transfer.js";

describe("isEvmPayDestination", () => {
  it("accepts checksum and lowercase EOAs", () => {
    assert.equal(isEvmPayDestination("0x25f98184a1f4762f25e8ff5806e1dc7c6730df77"), true);
    assert.equal(isEvmPayDestination("0x25F98184A1F4762F25E8FF5806E1DC7C6730DF77"), true);
  });

  it("rejects urls and vendor strings", () => {
    assert.equal(isEvmPayDestination("https://api.openai.com"), false);
    assert.equal(isEvmPayDestination("api.openai.com"), false);
    assert.equal(isEvmPayDestination("0xdead"), false);
  });
});
