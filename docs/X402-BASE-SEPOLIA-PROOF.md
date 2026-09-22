# x402 V2 Base Sepolia proof

This runbook produces the evidence required to call ABI's x402 integration
proven. Testnet tokens have no monetary value.

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

- [ ] BaseScan transaction exists on Base Sepolia.
- [ ] Transaction succeeded and transferred the expected USDC to the seller.
- [ ] Console → Transactions links the same hash.
- [ ] Settlement record is `settled`, not `needs_review`.
- [ ] ABI ledger remains balanced.
- [ ] Reusing the idempotency key does not create a second transfer.
- [ ] A price above the authorized ceiling fails before signing.
- [ ] The seller profile shows `verified`.

Save the transaction URL in the release notes. Until this checklist has a real
hash, describe the integration as implemented and locally tested—not publicly
proven.
