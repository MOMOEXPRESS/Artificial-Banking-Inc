# x402 V2 Base Sepolia proof

This runbook produces the evidence required to call ABI's x402 integration
proven. Testnet tokens have no monetary value.

## Proven settlement — 2026-09-22

ABI completed a funded x402 V2 settlement against the independently deployed
demo seller at `https://abi-x402-seller.onrender.com/report`.

| Evidence             | Value                                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network              | Base Sepolia (`eip155:84532`)                                                                                                                                              |
| Rail                 | `x402-v2`                                                                                                                                                                  |
| Amount               | `0.01` test USDC (`10,000` micro-USDC)                                                                                                                                     |
| Buyer vault          | `0xbC77a647Bc6Caf12E7Bc384bdbB4c7bc5C95bD22`                                                                                                                               |
| Merchant vault       | `0x001f2Bd37f9847b24D220a499b48eC3661258EEc`                                                                                                                               |
| Transaction          | [`0x5a923e17847112d5bb9a521946cd834d54a09954bdee1ef94b5599de746c7f3c`](https://sepolia.basescan.org/tx/0x5a923e17847112d5bb9a521946cd834d54a09954bdee1ef94b5599de746c7f3c) |
| ABI settlement state | `settled`                                                                                                                                                                  |
| Merchant Gateway     | `verified`                                                                                                                                                                 |

An independent `eth_getTransactionReceipt` call to the public Base Sepolia RPC
returned status `0x1`. Its official USDC `Transfer` event moves `0x2710`
base units from the buyer vault to the merchant vault. After settlement, the
seller returned the paid competitor-pricing report and ABI's recent-payments
view returned the same transaction hash and BaseScan URL.

## Prerequisites

- An ABI organization vault with Base Sepolia USDC.
- A different Base-compatible wallet to receive the seller payment.
- `CHAIN=base-sepolia` on the API.
- The seller can reach `https://x402.org/facilitator`.

Never paste a guardian key, agent key, vault private key, or `ABI_KEK` into a
chat, issue, commit, or browser storage.

## Start the seller

```bash
X402_SELLER_ADDRESS=0xSellerWallet \
X402_FACILITATOR_URL=https://x402.org/facilitator \
X402_PRICE_USDC='$0.01' \
npm run dev -w @policyvault/x402-seller
```

`GET /health` must report `protocol: x402-v2`, network `eip155:84532`, and the
intended payout wallet. An unpaid `GET /report` must return HTTP 402 with a
`PAYMENT-REQUIRED` header.

## Register and verify the merchant

In Console → Settings → Merchants:

1. Enter the seller name and public `/report` endpoint.
2. Enter the same payout wallet and `0.01` USDC price.
3. Select Base Sepolia.
4. Create the seller profile.
5. Press **Verify**. ABI fetches the unpaid challenge and compares protocol,
   network, price, and recipient. It does not make a payment during verification.

## Pay through ABI

```bash
curl -s -X POST "$ABI_API_URL/v1/agent/pay_api" \
  -H "Authorization: Bearer $ABI_AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"amountUsdc\":\"0.01\",\"destination\":\"$X402_SELLER_URL/report\",\"idempotencyKey\":\"x402-proof-$(date +%s)\"}"
```

The policy must allow the destination and amount. The successful response must
contain `rail: "x402-v2"` and `txHash`.

## Proof checklist

- [x] BaseScan transaction exists on Base Sepolia.
- [x] Transaction succeeded and transferred the expected USDC to the seller.
- [x] Console → Transactions links the same hash.
- [x] Settlement record is `settled`, not `needs_review`.
- [ ] ABI ledger remains balanced.
- [ ] Reusing the idempotency key does not create a second transfer.
- [x] A price above the authorized ceiling fails before signing (automated regression test).
- [x] The seller profile shows `verified`.

The funded settlement path is publicly proven. Keep the two remaining
operational checks explicit until the live idempotency replay and post-payment
ledger conformance checks have also been recorded.
