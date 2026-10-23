import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cardholderName, cardNumberRows, groupVaultAddress } from "./vault-card-format";

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
