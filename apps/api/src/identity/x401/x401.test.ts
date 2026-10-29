/**
 * x401 Verifier unit tests. TEST-ONLY keys: every issuer, holder and verifier
 * key here is a throwaway from ./test-fixtures or generated per run. Nothing
 * talks to Proof or any network.
 */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import type { X401AuditEvent, X401ChallengeRow } from "../../store.js";
import { loadX401Config, type X401Config } from "./config.js";
import { X401Verifier, type X401ChallengeStore, type X401Context } from "./verifier.js";
import {
  decodeProofRequest,
  fixturePem,
  issueSdJwtVc,
  newHolder,
  newVerifierSigningJwk,
  present,
  proofResponseHeader,
  TEST_ISSUER,
  TEST_VCT,
  type Holder,
} from "./test-helpers.js";

const CLIENT_ID = "https://api.abi.test/.well-known/abi-x401-client.json";

function testEnv(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    X401_ENABLED: "1",
    X401_ENVIRONMENT: "sandbox",
    X401_CLIENT_ID: CLIENT_ID,
    X401_SIGNING_JWK: JSON.stringify(newVerifierSigningJwk()),
    X401_TRUSTED_ISSUERS: JSON.stringify([
      {
        id: "test",
        issuer: TEST_ISSUER,
        anchorsPem: [fixturePem("test-root.cert.pem")],
        vcts: [TEST_VCT],
      },
    ]),
    ...over,
  };
}

class MemoryStore implements X401ChallengeStore {
  rows = new Map<string, X401ChallengeRow>();
  audit: X401AuditEvent[] = [];
  createChallenge(row: Omit<X401ChallengeRow, "consumedAt">) {
    this.rows.set(row.nonceSha256, { ...row, consumedAt: undefined });
  }
  getChallenge(k: string) {
    const r = this.rows.get(k);
    return r && { ...r };
  }
  consumeChallenge(k: string, at: string) {
    const r = this.rows.get(k);
    if (!r || r.consumedAt || !(Date.parse(r.expiresAt) > Date.parse(at))) return false;
    r.consumedAt = at;
    return true;
  }
  sweepChallenges() {
    return 0;
  }
  recordAudit(e: X401AuditEvent) {
    this.audit.push(e);
  }
}

function config(over: Record<string, string | undefined> = {}): X401Config {
  const r = loadX401Config(testEnv(over));
  assert.ok(r.ok, r.ok ? "" : r.reason);
  return r.config;
}

const CTX: X401Context = {
  offerId: "off_1",
  sellerOrgId: "org_seller",
  method: "GET",
  resource: "https://api.abi.test/x402/acme/report",
  callerOrgId: "org_buyer",
  callerAgentId: "agt_1",
};

async function setup(over: Record<string, string | undefined> = {}) {
  const store = new MemoryStore();
  let clock = new Date();
  const verifier = new X401Verifier(config(over), store, { now: () => clock });
  const header = await verifier.challenge(CTX);
  const { request } = decodeProofRequest(header);
  return {
    store,
    verifier,
    nonce: request.nonce as string,
    advance(seconds: number) {
      clock = new Date(clock.getTime() + seconds * 1000);
    },
  };
}

async function validProof(
  nonce: string,
  holder: Holder = newHolder(),
  opts: Parameters<typeof issueSdJwtVc>[0] | undefined = undefined,
) {
  const vc = await issueSdJwtVc(opts ?? { holder });
  return proofResponseHeader(await present(vc, holder, { aud: CLIENT_ID, nonce }));
}

describe("x401 PROOF-REQUEST", () => {
  it("is a v0.2.0 payload carrying a signed OpenID4VP request bound to ABI's client id", async () => {
    const store = new MemoryStore();
    const v = new X401Verifier(config(), store);
    const { payload, jarHeader, request } = decodeProofRequest(await v.challenge(CTX));
    assert.equal(payload.scheme, "x401");
    assert.equal(payload.version, "0.2.0");
    assert.equal(jarHeader.typ, "oauth-authz-req+jwt");
    assert.equal(jarHeader.alg, "ES256");
    assert.equal(jarHeader.kid, await v.signingKid());
    assert.equal(request.client_id, CLIENT_ID);
    assert.equal(request.iss, CLIENT_ID);
    assert.equal(request.response_mode, "dc_api");
    assert.equal(request.scope, "urn:proof:params:scope:verifiable-credentials:basic");
    assert.equal(typeof request.nonce, "string");
    assert.ok((request.nonce as string).length >= 43);
    // Only a hash of the nonce is stored, with its checkout and caller binding.
    const [row] = [...store.rows.values()];
    assert.ok(row);
    assert.notEqual(row.nonceSha256, request.nonce);
    assert.equal(row.offerId, "off_1");
    assert.equal(row.callerAgentId, "agt_1");
    // The public JWK for the CIMD carries no private part.
    assert.equal((await v.publicJwk()).d, undefined);
  });
});

describe("x401 config fails closed", () => {
  it("is off unless X401_ENABLED=1", () => {
    assert.equal(loadX401Config(testEnv({ X401_ENABLED: undefined })).ok, false);
  });
  it("rejects missing trust anchors, a non-CA anchor, bad client id and a public-only signing key", () => {
    for (const over of [
      { X401_TRUSTED_ISSUERS: undefined },
      {
        X401_TRUSTED_ISSUERS: JSON.stringify([
          {
            id: "t",
            issuer: TEST_ISSUER,
            anchorsPem: [fixturePem("test-issuer.cert.pem")],
            vcts: [TEST_VCT],
          },
        ]),
      },
      { X401_CLIENT_ID: "http://api.abi.test/client.json" },
      { X401_CLIENT_ID: "https://api.abi.test/" },
      { X401_SIGNING_JWK: JSON.stringify({ ...newVerifierSigningJwk(), d: undefined }) },
      { X401_SCOPE: "urn:example:unknown" },
    ]) {
      const r = loadX401Config(testEnv(over));
      assert.equal(r.ok, false, JSON.stringify(Object.keys(over)));
    }
  });
  it("never echoes the signing key in its error", () => {
    const secret = JSON.stringify({ kty: "EC", crv: "P-384", d: "SECRET-SHOULD-NOT-LEAK" });
    const r = loadX401Config(testEnv({ X401_SIGNING_JWK: secret }));
    assert.equal(r.ok, false);
    assert.ok(!JSON.stringify(r).includes("SECRET-SHOULD-NOT-LEAK"));
  });
});

async function expectReject(
  p: Promise<import("./verifier.js").VerifyResult>,
  code: string,
  status = 401,
): Promise<void> {
  const r = await p;
  assert.equal(r.ok, false, `expected ${code}`);
  if (!r.ok) {
    assert.equal(r.code, code, r.description);
    assert.equal(r.status, status);
  }
}

const b64json = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("x401 PROOF-RESPONSE verification", () => {
  it("accepts a valid presentation and reports what it proves (and does not)", async () => {
    const s = await setup();
    const r = await s.verifier.verify(await validProof(s.nonce), CTX, true);
    assert.ok(r.ok, r.ok ? "" : `${r.code}: ${r.description}`);
    assert.equal(r.identity.issuer, TEST_ISSUER);
    assert.equal(r.identity.vct, TEST_VCT);
    assert.equal(r.identity.issuerTrustId, "test");
    assert.deepEqual(r.identity.proves, {
      issuerAttestedClaims: true,
      humanDelegation: false,
      paymentAuthorization: false,
    });
    assert.equal(r.identity.claims.given_name, "Test");
    assert.deepEqual(r.identity.claims.age_equal_or_over, { "18": true });
    assert.equal(r.identity.boundTo.callerAgentId, "agt_1");
  });

  it("checks without consuming, then consumes exactly once (replay rejected)", async () => {
    const s = await setup();
    const proof = await validProof(s.nonce);
    assert.equal((await s.verifier.verify(proof, CTX, false)).ok, true);
    assert.equal((await s.verifier.verify(proof, CTX, true)).ok, true);
    await expectReject(s.verifier.verify(proof, CTX, true), "replayed");
    await expectReject(s.verifier.verify(proof, CTX, false), "replayed");
  });

  it("rejects a bad issuer signature", async () => {
    const s = await setup();
    const holder = newHolder();
    const vc = await issueSdJwtVc({ holder });
    const [jwt, ...rest] = vc.split("~");
    const [h, p, sig] = jwt!.split(".");
    const flipped = (sig![0] === "A" ? "B" : "A") + sig!.slice(1);
    const bad = [`${h}.${p}.${flipped}`, ...rest].join("~");
    await expectReject(
      s.verifier.verify(
        proofResponseHeader(await present(bad, holder, { aud: CLIENT_ID, nonce: s.nonce })),
        CTX,
        true,
      ),
      "invalid_signature",
    );
  });

  it("rejects a forged claim in the signed payload", async () => {
    const s = await setup();
    const holder = newHolder();
    const vc = await issueSdJwtVc({ holder });
    const [jwt, ...rest] = vc.split("~");
    const [h, p, sig] = jwt!.split(".");
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString("utf8"));
    payload.exp = payload.exp + 10_000_000;
    const forged = [`${h}.${b64json(payload)}.${sig}`, ...rest].join("~");
    await expectReject(
      s.verifier.verify(
        proofResponseHeader(await present(forged, holder, { aud: CLIENT_ID, nonce: s.nonce })),
        CTX,
        true,
      ),
      "invalid_signature",
    );
  });

  it("rejects a tampered disclosure", async () => {
    const s = await setup();
    const holder = newHolder();
    const vc = await issueSdJwtVc({ holder });
    const parts = vc.split("~");
    parts[1] = b64json(["salt", "given_name", "Mallory"]);
    await expectReject(
      s.verifier.verify(
        proofResponseHeader(
          await present(parts.join("~"), holder, { aud: CLIENT_ID, nonce: s.nonce }),
        ),
        CTX,
        true,
      ),
      "malformed_credential",
    );
  });

  it("rejects a wrong or unlisted issuer, an untrusted chain, an expired issuer cert and a wrong vct", async () => {
    const cases: [Partial<Parameters<typeof issueSdJwtVc>[0]>, string][] = [
      [{ iss: "https://issuer.attacker.invalid" }, "untrusted_issuer"],
      [{ issuerCert: "other-issuer" }, "untrusted_issuer"],
      [{ issuerCert: "other-issuer", chain: ["other-root"] }, "untrusted_issuer"],
      [{ issuerCert: "expired-issuer" }, "untrusted_issuer"],
      [{ vct: "https://credentials.x401-test.invalid/Other" }, "unsupported_credential_type"],
      [{ typ: "vc+sd-jwt+unknown" }, "unsupported_format"],
    ];
    for (const [over, code] of cases) {
      const s = await setup();
      const holder = newHolder();
      await expectReject(
        s.verifier.verify(await validProof(s.nonce, holder, { holder, ...over }), CTX, true),
        code,
      );
    }
  });

  it("rejects a presentation made for another verifier (audience)", async () => {
    const s = await setup();
    const holder = newHolder();
    const vc = await issueSdJwtVc({ holder });
    const p = await present(vc, holder, {
      aud: "https://other-verifier.invalid/client.json",
      nonce: s.nonce,
    });
    await expectReject(s.verifier.verify(proofResponseHeader(p), CTX, true), "wrong_audience");
  });

  it("rejects a KB-JWT not signed by the credential's holder key", async () => {
    const s = await setup();
    const holder = newHolder();
    const vc = await issueSdJwtVc({ holder });
    const p = await present(vc, holder, { aud: CLIENT_ID, nonce: s.nonce, signer: newHolder() });
    await expectReject(s.verifier.verify(proofResponseHeader(p), CTX, true), "invalid_signature");
  });

  it("rejects an expired credential, a stale KB-JWT and an expired challenge", async () => {
    const now = Math.floor(Date.now() / 1000);
    {
      const s = await setup();
      const holder = newHolder();
      await expectReject(
        s.verifier.verify(
          await validProof(s.nonce, holder, { holder, exp: now - 3600 }),
          CTX,
          true,
        ),
        "credential_expired",
      );
    }
    {
      const s = await setup();
      const holder = newHolder();
      const p = await present(await issueSdJwtVc({ holder }), holder, {
        aud: CLIENT_ID,
        nonce: s.nonce,
        iat: now - 3600,
      });
      await expectReject(
        s.verifier.verify(proofResponseHeader(p), CTX, true),
        "presentation_expired",
      );
    }
    {
      const s = await setup({ X401_CHALLENGE_TTL_SECONDS: "60" });
      s.advance(400);
      const holder = newHolder();
      const p = await present(await issueSdJwtVc({ holder }), holder, {
        aud: CLIENT_ID,
        nonce: s.nonce,
        iat: now + 400,
      });
      await expectReject(s.verifier.verify(proofResponseHeader(p), CTX, true), "invalid_nonce");
    }
  });

  it("binds the proof to its checkout, org and agent", async () => {
    for (const [ctx, code] of [
      [{ ...CTX, resource: "https://api.abi.test/x402/acme/other" }, "wrong_resource"],
      [{ ...CTX, offerId: "off_2" }, "wrong_resource"],
      [{ ...CTX, method: "POST" }, "wrong_resource"],
      [{ ...CTX, callerOrgId: "org_other" }, "agent_binding_mismatch"],
      [{ ...CTX, callerAgentId: "agt_other" }, "agent_binding_mismatch"],
      [{ ...CTX, callerAgentId: undefined }, "agent_binding_mismatch"],
    ] as const) {
      const s = await setup();
      await expectReject(s.verifier.verify(await validProof(s.nonce), ctx, true), code);
      // A mismatched attempt does not burn the legitimate caller's challenge.
      assert.equal((await s.verifier.verify(await validProof(s.nonce), CTX, true)).ok, true);
    }
  });

  it("rejects a nonce ABI never issued", async () => {
    const s = await setup();
    await expectReject(
      s.verifier.verify(await validProof("not-an-abi-nonce"), CTX, true),
      "invalid_nonce",
    );
  });
});

describe("x401 fails closed on what it cannot verify", () => {
  it("rejects detached signatures and crit headers (Proof's paid detached-signature flow is not used)", async () => {
    const s = await setup();
    const holder = newHolder();
    const vc = await issueSdJwtVc({ holder });
    const full = await present(vc, holder, { aud: CLIENT_ID, nonce: s.nonce });
    const parts = full.split("~");
    // Proof's x401 presentations leave the signature segment empty and fetch it later (paid endpoint).
    const [kh, kp] = parts[parts.length - 1]!.split(".");
    parts[parts.length - 1] = `${kh}.${kp}.`;
    await expectReject(
      s.verifier.verify(proofResponseHeader(parts.join("~")), CTX, true),
      "detached_signature_unsupported",
    );

    const { signEs256 } = await import("./jws.js");
    const crit = await signEs256(
      { typ: "kb+jwt", crit: ["proof.com#sig-1"], "proof.com#sig-1": "x" },
      { iat: Math.floor(Date.now() / 1000), aud: CLIENT_ID, nonce: s.nonce, sd_hash: "x" },
      holder.signingJwk,
    );
    await expectReject(
      s.verifier.verify(proofResponseHeader(`${vc}${crit}`), CTX, true),
      "detached_signature_unsupported",
    );
  });

  it("rejects a credential with a status reference it cannot check", async () => {
    const s = await setup();
    const holder = newHolder();
    const status = { status_list: { idx: 1, uri: "https://issuer.x401-test.invalid/status/1" } };
    await expectReject(
      s.verifier.verify(await validProof(s.nonce, holder, { holder, status }), CTX, true),
      "status_unverifiable",
    );
  });

  it("rejects a presentation without key binding or without the required claims", async () => {
    const s = await setup();
    const holder = newHolder();
    const vc = await issueSdJwtVc({ holder });
    await expectReject(
      s.verifier.verify(proofResponseHeader(vc), CTX, true),
      "key_binding_required",
    );
    await expectReject(
      s.verifier.verify(await validProof(s.nonce, holder, { holder, ages: {} }), CTX, true),
      "claims_not_satisfied",
    );
  });

  it("rejects tokens, unsigned protocol, extra credentials and malformed headers", async () => {
    const s = await setup();
    const p = await present(await issueSdJwtVc({ holder: newHolder() }), newHolder(), {
      aud: CLIENT_ID,
      nonce: s.nonce,
    });
    await expectReject(
      s.verifier.verify(
        b64json({ scheme: "x401", version: "0.2.0", token_type: "Bearer", access_token: "abc" }),
        CTX,
        true,
      ),
      "unsupported_token",
    );
    await expectReject(
      s.verifier.verify(
        b64json({
          credential_result: {
            protocol: "openid4vp-v1-unsigned",
            data: { vp_token: { proof_id_default: [p] } },
          },
        }),
        CTX,
        true,
      ),
      "unsupported_protocol",
    );
    await expectReject(
      s.verifier.verify(
        b64json({
          credential_result: {
            protocol: "openid4vp-v1-signed",
            data: { vp_token: { proof_id_default: [p], extra: [p] } },
          },
        }),
        CTX,
        true,
      ),
      "claims_not_satisfied",
    );
    await expectReject(s.verifier.verify("not base64 json!", CTX, true), "invalid_response", 400);
    await expectReject(
      s.verifier.verify(
        b64json({
          credential_result: { protocol: "openid4vp-v1-signed", data: {} },
          credential_result_uri: "https://x.invalid/r",
        }),
        CTX,
        true,
      ),
      "invalid_response",
      400,
    );
  });

  it("refuses to dereference result URIs that are not allowlisted, and maps fetch failure to 503", async () => {
    const s = await setup();
    let fetched = 0;
    const ref = b64json({ credential_result_uri: "https://169.254.169.254/latest/meta-data" });
    await expectReject(s.verifier.verify(ref, CTX, true), "unsupported_reference");
    assert.equal(fetched, 0);

    const store = new MemoryStore();
    const v = new X401Verifier(
      config({ X401_RESULT_URI_ORIGINS: "https://results.abi.test" }),
      store,
      {
        fetchImpl: (async () => {
          fetched += 1;
          throw new Error("network down");
        }) as typeof fetch,
      },
    );
    await expectReject(
      v.verify(b64json({ credential_result_uri: "https://results.abi.test/r/1" }), CTX, true),
      "verifier_unavailable",
      503,
    );
    assert.equal(fetched, 1);
  });
});
