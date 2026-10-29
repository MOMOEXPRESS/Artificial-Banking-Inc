# x401 identity verification at the hosted x402 checkout

Status: **implemented and tested locally only, not deployed, not live-interop tested.**
It is off unless `X401_ENABLED=1`. An offer that requires x401 while the
verifier is off or misconfigured is refused with 503 before any challenge or
payment.

## Sources (pinned)

| What                         | Version       | Link                                                                                                                  |
| ---------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| x401 specification           | 0.2.0 (Draft) | https://x401.proof.com/spec/latest/ · https://github.com/proof/x401/blob/7e864af/spec.md (main @ 7e864af, 2026-09-30) |
| Proof developer docs         | n/a           | https://dev.proof.com/docs/x401                                                                                       |
| `@proof.com/x401-node`       | 0.3.3         | https://www.npmjs.com/package/@proof.com/x401-node                                                                    |
| `@proof.com/proof-vc-server` | 0.7.0         | https://www.npmjs.com/package/@proof.com/proof-vc-server                                                              |
| `@proof.com/proof-vc-common` | 0.7.0         | https://www.npmjs.com/package/@proof.com/proof-vc-common                                                              |
| `@proof.com/x401-workers`    | 0.2.0         | https://www.npmjs.com/package/@proof.com/x401-workers                                                                 |
| SD-JWT                       | RFC 9901      | https://www.rfc-editor.org/rfc/rfc9901                                                                                |
| OpenID4VP                    | 1.0           | https://openid.net/specs/openid-4-verifiable-presentations-1_0.html                                                   |

The Proof SDKs were read, not installed: ABI adds **no new dependencies**. The
verifier is written against the standards above with `node:crypto` and WebCrypto.

## Flow (x401 "Primary Flow": proof first, then 402)

1. `GET /v1/x402/offers/:id` with no `PROOF-RESPONSE` → **401** + `PROOF-REQUEST`
   (base64url x401 Payload v0.2.0 with one signed OpenID4VP request:
   `typ: oauth-authz-req+jwt`, ES256, `client_id` = ABI's CIMD URL,
   `response_mode: dc_api`, Proof scope, fresh 256-bit nonce).
   ABI stores only `sha256(nonce)`, bound to offer, method, resource and the
   ABI caller org/agent (from ABI auth, never from the request).
2. The wallet answers; the client retries with `PROOF-RESPONSE` (inline Result
   Artifact). ABI verifies it **without consuming** the nonce and returns the
   normal x402 **402** `PAYMENT-REQUIRED`. A proof is never payment.
3. The client retries with `PROOF-RESPONSE` + `PAYMENT-SIGNATURE`. ABI checks
   the payment terms, then verifies the proof again and **consumes** the nonce
   atomically, and only then calls the facilitator verify/settle. A failed or
   replayed proof returns 401/400 with a `PROOF-RESULT` Error Object, and
   nothing is verified, settled or served.
4. The 200 body gains `identity: { verified, protocol: "x401", issuer,
credentialType, proves }` where `proves` is always
   `{ issuerAttestedClaims: true, humanDelegation: false, paymentAuthorization: false }`.
   Disclosed claims are not returned, logged or stored. The audit table holds
   outcome, error code, issuer, vct and a hash of the holder key thumbprint.

Identity never authorizes spending: ABI buyer agents still pass buyer policy
(`handleIntent`) before the checkout is touched, and payment is still x402.

## What the verifier checks

SD-JWT VC (`typ: dc+sd-jwt`, ES256/384/512): issuer allowlist by `iss`; `x5c`
chain (≤5 certs, validity, signatures, leaf not a CA) to an operator-pinned
anchor; issuer signature; `vct` allowlist; `exp`/`nbf`/`iat` with skew;
RFC 9901 disclosure processing (sha-256, each digest once, no overwrites, no
unreferenced disclosures); `cnf.jwk` holder key; KB-JWT (`typ: kb+jwt`) signature,
`aud` = ABI `client_id`, `iat` freshness, `sd_hash`, `nonce`; required claims for
the scope; nonce issued by ABI, unexpired, unconsumed, same checkout and caller.

Fails closed on: detached signatures or any `crit` header, `status` claims
(status lists are not checked yet), Verification Tokens, unsigned protocol,
extra credentials in `vp_token`, encrypted responses, `credential_result_uri`
from origins not in `X401_RESULT_URI_ORIGINS` (SSRF guard), and missing config.

## Configuration (Worker vars / secrets)

| Var                                                                                  | Required        | Notes                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `X401_ENABLED`                                                                       | yes             | `1` to turn on                                                                                                                                                                                                                                                                                                                                                 |
| `X401_ENVIRONMENT`                                                                   | no              | `sandbox` (default) or `production`                                                                                                                                                                                                                                                                                                                            |
| `X401_CLIENT_ID`                                                                     | yes             | https URL of ABI's CIMD, e.g. `https://<api-host>/.well-known/abi-x401-client.json` (served by ABI when the path matches)                                                                                                                                                                                                                                      |
| `X401_CLIENT_NAME`                                                                   | no              | default `ABI`                                                                                                                                                                                                                                                                                                                                                  |
| `X401_SIGNING_JWK`                                                                   | yes, **secret** | P-256 private JWK for request objects. Set with `wrangler secret put`; never commit                                                                                                                                                                                                                                                                            |
| `X401_SCOPE`                                                                         | no              | default `urn:proof:params:scope:verifiable-credentials:basic`                                                                                                                                                                                                                                                                                                  |
| `X401_TRUSTED_ISSUERS`                                                               | yes             | JSON `[{"id","issuer","anchorsPem":[...],"vcts":[...]}]`. For Proof: `issuer` `https://api.fairfax.proof.com` (sandbox) or `https://api.proof.com`, `vcts` `["https://credentials.notarize.com/ProofCredentialV1"]`, anchors = Proof's root CA PEM (Development root for sandbox, Proof Root CA R1 for production) obtained from Proof and checked out-of-band |
| `X401_EXPECTED_ORIGINS`, `X401_REQUEST_AUDIENCE`                                     | no              | default to Proof's values for the environment                                                                                                                                                                                                                                                                                                                  |
| `X401_RESULT_URI_ORIGINS`                                                            | no              | empty = by-reference results refused                                                                                                                                                                                                                                                                                                                           |
| `X401_CHALLENGE_TTL_SECONDS` / `X401_KB_MAX_AGE_SECONDS` / `X401_CLOCK_SKEW_SECONDS` | no              | 300 / 300 / 60                                                                                                                                                                                                                                                                                                                                                 |

Migration: automatic and additive on start (`store.ts` `migrate()`):
`offers.identity_requirement TEXT NOT NULL DEFAULT 'none'`, new tables
`x401_challenges` and `x401_audit_events`. Existing offers are unchanged.

Per offer: `PATCH /v1/seller/offers/:id {"identityRequirement":"x401"}` (hosted
offers only). The seller's verify step checks the 402 terms behind the gate and
fails while the verifier is not configured.

## Local repro

```bash
export PATH=/path/to/node22+/bin:$PATH
cd apps/api
env -u RESEND_API_KEY -u BREVO_API_KEY node --import tsx --test \
  src/identity/x401/x401.test.ts src/identity/x401/x401-checkout.test.ts
```

Test keys and certificates in `src/identity/x401/test-fixtures/` are
**TEST-ONLY** throwaways (`generate.sh` recreates them). Never put them in
`X401_TRUSTED_ISSUERS` outside tests.

## Not done / blockers for live interop with Proof

1. **Detached signatures (zero-spend blocker).** Proof's x401 presentations
   carry detached signatures (`crit: ["proof.com#sig-1"]`) that the verifier
   fetches from the paid `POST /verifiable-credentials/v1/x401-signatures`
   endpoint (x402 USDC or card). ABI rejects them today. Supporting them needs
   owner approval for the spend and either Proof's SDK or that endpoint.
2. **Enrollment.** ABI's CIMD must be hosted at `X401_CLIENT_ID` and enrolled
   with Proof (`npx @proof.com/proof-vc-server enroll ... --email`, email
   activation). Owner action.
3. **Proof root CA PEMs** are not pinned in code; they must be obtained from
   Proof and set in `X401_TRUSTED_ISSUERS`.
4. **Status lists** (`status` claim) are rejected rather than checked.
5. **Agent-side relay.** ABI's own buyer agents (`pay_api`) do not yet carry a
   `PROOF-RESPONSE`; they stop at the 401 with nothing signed.
6. CORS does not expose `PROOF-*` headers to browsers (same as `PAYMENT-*` today).
7. `X509Certificate` support on the Workers runtime (nodejs_compat) is untested.

AP2 / Trusted Agent placeholders stay in `apps/api/src/platform/rails-future.ts`,
separate from x401, and fail closed (`verifyAp2Mandate` always refuses; AP2
hints are marked `verified: false`).
