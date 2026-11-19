/** Real HTTP, credentials, signatures, policy and ledger; chain/facilitator are isolated fixtures, not live-chain proof. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { recoverTypedDataAddress } from "viem";
import { Challenge, Credential } from "mppx";
const dir = mkdtempSync(join(tmpdir(), "abi-agentic-e2e-"));
Object.assign(process.env, {
  POLICYVAULT_DB: join(dir, "proof.db"),
  ABI_KEY_PEPPER: "test-only-agentic-pepper",
  ABI_NO_LISTEN: "1",
  ABI_CHAT_LLM: "0",
  ABI_CHAT_AGENT: "0",
  ABI_PUBLIC_API_URL: "https://api.abi.test",
  ABI_PREVIEW_TESTNET: "1",
  CHAIN: "base-sepolia",
});
const { store, sellerStore } = await import("./store.js");
const { app } = await import("./index.js");
const {
  ensureWorkspaces,
  createWorkspace,
  allocateWorkspace,
  setCard,
  connectAgent,
  viewWorkspace,
} = await import("./workspaces.js");
const { setHostedFacilitator, hostedOfferUrl, handleHostedOffer, requirementFor } =
  await import("./seller-x402.js");
const { eip712Domain, AUTHORIZATION_TYPES, allowedX402Networks } = await import("./rails/x402.js");
const { signMpp, mppChallenge, mppCredentialToX402 } = await import("./rails/mpp-wire.js");
const { getCustodyProvider } = await import("@policyvault/custody");
let server: ReturnType<typeof app.listen>,
  base = "",
  settles = 0,
  unknown = false;
const used = new Set<string>();
setHostedFacilitator({
  async verify(payload, req) {
    const p = payload.payload as {
      signature: `0x${string}`;
      authorization: {
        from: `0x${string}`;
        to: `0x${string}`;
        value: string;
        nonce: `0x${string}`;
        validAfter: string;
        validBefore: string;
      };
    };
    try {
      const signer = await recoverTypedDataAddress({
        domain: eip712Domain(req.network, req.asset as `0x${string}`),
        types: AUTHORIZATION_TYPES,
        primaryType: "TransferWithAuthorization",
        message: {
          ...p.authorization,
          value: BigInt(p.authorization.value),
          validAfter: BigInt(p.authorization.validAfter),
          validBefore: BigInt(p.authorization.validBefore),
        },
        signature: p.signature,
      });
      return {
        isValid:
          signer.toLowerCase() === p.authorization.from.toLowerCase() &&
          !used.has(p.authorization.nonce) &&
          p.authorization.value === req.amount,
        payer: signer,
      };
    } catch {
      return { isValid: false, invalidReason: "Bad authorization signature" };
    }
  },
  async settle(payload, req) {
    const p = payload.payload as { authorization: { nonce: string; from: string } };
    if (unknown) throw Error("Fixture timeout after dispatch");
    if (used.has(p.authorization.nonce))
      return { success: false, errorReason: "nonce_used", transaction: "", network: req.network };
    used.add(p.authorization.nonce);
    settles++;
    return {
      success: true,
      transaction: `0x${settles.toString(16).padStart(64, "0")}`,
      network: req.network,
      payer: p.authorization.from,
    };
  },
});
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  setHostedFacilitator(null);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});
function setup() {
  const buyer = store.createOrg("Testnet buyer", 0n),
    seller = store.createOrg("Testnet seller", 0n, { kind: "seller" });
  const general = ensureWorkspaces(buyer.id)[0]!,
    workspace = createWorkspace(buyer.id, "Agent purchases", crypto.randomUUID());
  const deposit = {
    orgId: buyer.id,
    chain: "base-sepolia",
    txHash: `0x${"dd".repeat(32)}`,
    logIndex: 0,
    blockNumber: "100",
    from: `0x${"11".repeat(20)}`,
    to: store.getVaultAddress(buyer.id)!,
    amountMicro: 1_000_000n,
  };
  store.creditOnchainUsdcDeposit(deposit);
  store.creditOnchainUsdcDeposit(deposit);
  assert.equal(
    store.getAccountMap(buyer.id).get(`org:${buyer.id}:available`)?.balanceMicro,
    1_000_000n,
    "deposit replay must not mint funds",
  );
  allocateWorkspace(buyer.id, String(general.id), workspace.id, "0.20", "allocation-once");
  allocateWorkspace(buyer.id, String(general.id), workspace.id, "0.20", "allocation-once");
  setCard(buyer.id, workspace.id, {
    limitUsdc: "0.20",
    periodLimits: { day: "0.20", week: "0.20", month: "0.20" },
  });
  const connection = connectAgent(buyer.id, workspace.id, {
    name: "Purchasing agent",
    pay: true,
    ttlHours: 24,
    key: crypto.randomUUID(),
  });
  store.upsertSellerProfile(seller.id, {
    displayName: "Test seller",
    payoutAddress: `0x${"22".repeat(20)}`,
    network: "base-sepolia",
  });
  const offer = store.createOffer({
    orgId: seller.id,
    slug: crypto.randomUUID(),
    title: "Paid test report",
    endpointUrl: "https://api.abi.test/placeholder",
    priceUsdcMicro: "10000",
    network: "base-sepolia",
    hosted: true,
    hostedContent: JSON.stringify({ report: "delivered" }),
  });
  store.updateOffer(seller.id, offer.id, {
    endpointUrl: hostedOfferUrl(offer.id),
    status: "published",
  });
  store.setOfferIntegration(offer.id, {
    lastVerifiedAt: new Date().toISOString(),
    ownershipVerifiedAt: new Date().toISOString(),
    ownershipOrigin: "https://api.abi.test",
  });
  const policy = store.getPolicyTemplate(buyer.id);
  store.setPolicyTemplate(buyer.id, {
    ...policy,
    vendorAllowlist: [
      `https://api.abi.test/v1/x402/offers/${offer.id}`,
      `https://api.abi.test/v1/mpp/offers/${offer.id}`,
    ],
    perTxMaxMicro: 200_000n,
    dailyMaxMicro: 1_000_000n,
    hitlAboveMicro: 200_000n,
    newCounterpartyCooldownHours: 0,
  });
  for (const protocol of ["x402", "mpp"])
    store.addKnownCounterparty(buyer.id, `https://api.abi.test/v1/${protocol}/offers/${offer.id}`);
  const pay = (protocol: string, key: string, amount = "0.01") =>
    fetch(`${base}/v1/agent/pay_api`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.sessionKey.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        amountUsdc: amount,
        destination: `https://api.abi.test/v1/${protocol}/offers/${offer.id}`,
        idempotencyKey: key,
      }),
    });
  return { buyer, seller, workspace, general, offer, connection, pay };
}
for (const protocol of ["x402", "mpp"]) {
  test(`${protocol}: confirmed deposit → allocation → scoped agent → paid seller → single ledger debit`, async () => {
    const f = setup(),
      before = settles;
    const challenge = await fetch(`${base}/v1/${protocol}/offers/${f.offer.id}`);
    assert.equal(challenge.status, 402);
    assert(challenge.headers.get(protocol === "mpp" ? "www-authenticate" : "payment-required"));
    const response = await f.pay(protocol, "pay-once");
    assert.equal(response.status, 200, await response.clone().text());
    const result = (await response.json()) as { rail: string; txHash: string; intentId: string };
    assert.equal(result.rail, protocol === "mpp" ? "mpp-evm" : "x402-v2");
    assert.match(result.txHash, /^0x[\da-f]{64}$/);
    const replay = await f.pay(protocol, "pay-once");
    assert.equal(replay.status, 200, await replay.clone().text());
    assert.equal(settles, before + 1);
    assert.equal(viewWorkspace(f.buyer.id, f.workspace.id).balance.availableUsdc, "0.19");
    assert.equal(store.reconcileOrgUncached(f.buyer.id).ok, true);
    assert.equal(
      sellerStore.payoutSummary(f.seller.id).count,
      1,
      "one payment produces one seller settlement",
    );
    assert.equal(sellerStore.payoutSummary(f.seller.id).settledMicro, "10000");
    const different = await f.pay(protocol, "pay-once", "0.02");
    assert.equal(different.status, 409);
    assert.equal(settles, before + 1);
    setCard(f.buyer.id, f.workspace.id, { status: "frozen" });
    const refused = await f.pay(protocol, "frozen-attempt");
    assert(refused.status >= 400);
    assert.equal(settles, before + 1);
  });
}
test("MPP authenticates and binds its challenge; tampered and replayed proofs never charge twice", async () => {
  const f = setup(),
    url = `https://api.abi.test/v1/mpp/offers/${f.offer.id}`,
    req = requirementFor(f.offer, `0x${"22".repeat(20)}`),
    header = mppChallenge(req, url)!;
  const custody = getCustodyProvider(),
    wallet = await custody.getAddress(f.buyer.id);
  assert(wallet);
  const proof = await signMpp(
    header,
    url,
    {
      address: wallet.address,
      signTypedData: (typedData) => custody.signTypedData({ orgId: f.buyer.id, typedData }),
    },
    10_000n,
  );
  mppCredentialToX402(proof.header, req, url);
  const parsed = Credential.deserialize(proof.header);
  const altered = Credential.serialize({
    ...parsed,
    challenge: { ...parsed.challenge, request: { ...parsed.challenge.request, amount: "1" } },
  });
  const before = settles;
  const bad = await handleHostedOffer(
    f.offer.id,
    (n) => (n === "authorization" ? altered : undefined),
    {},
    url,
  );
  assert.equal(bad.status, 402);
  assert.equal(settles, before);
  const paid = await handleHostedOffer(
    f.offer.id,
    (n) => (n === "authorization" ? proof.header : undefined),
    {},
    url,
  );
  assert.equal(paid.status, 200, JSON.stringify(paid));
  assert(paid.headers["Payment-Receipt"]);
  assert.equal(settles, before + 1);
  await handleHostedOffer(
    f.offer.id,
    (n) => (n === "authorization" ? proof.header : undefined),
    {},
    url,
  );
  assert.equal(settles, before + 1);
  const challenge = Challenge.deserialize(header);
  assert.equal(challenge.method, "evm");
});
test("MPP uncertain settlement preserves the workspace hold and does not retry payment", async () => {
  const f = setup(),
    before = settles;
  unknown = true;
  try {
    const response = await f.pay("mpp", "uncertain");
    const body = (await response.json()) as { outcome: string };
    assert.equal(body.outcome, "pending_reconciliation", JSON.stringify(body));
    const replay = await f.pay("mpp", "uncertain");
    assert.equal(((await replay.json()) as { outcome: string }).outcome, "pending_reconciliation");
    assert.equal(settles, before);
    assert.equal(viewWorkspace(f.buyer.id, f.workspace.id).balance.heldUsdc, "0.01");
  } finally {
    unknown = false;
  }
});
test("preview ignores mainnet network allowlists and refuses a mainnet chain configuration", () => {
  process.env.ABI_X402_NETWORKS = "eip155:8453";
  assert.deepEqual([...allowedX402Networks()], ["eip155:84532"]);
  process.env.CHAIN = "base";
  assert.throws(() => allowedX402Networks(), /base-sepolia/);
  process.env.CHAIN = "base-sepolia";
  delete process.env.ABI_X402_NETWORKS;
});

test("MPP alias preserves seller pre-payment policy and paused offers cannot settle", async () => {
  const f = setup(),
    url = `https://api.abi.test/v1/mpp/offers/${f.offer.id}`,
    before = settles;
  assert.equal(sellerStore.resolveOfferForPay(url)?.id, f.offer.id);
  store.updateOffer(f.seller.id, f.offer.id, { status: "paused" });
  const response = await f.pay("mpp", "paused-offer");
  assert(response.status >= 400);
  assert.equal(settles, before);
  assert.equal(viewWorkspace(f.buyer.id, f.workspace.id).balance.heldUsdc, "0");
});

test("preview receiving address is the actual execution vault, owner-only and never a Privy preview alias", async () => {
  const f = setup();
  const response = await fetch(`${base}/v1/guardian/preview/treasury`, {
    headers: { authorization: `Bearer ${f.buyer.guardianKey}` },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    address: string;
    chainId: number;
    availableUsdc: string;
  };
  assert.equal(body.address.toLowerCase(), store.getVaultAddress(f.buyer.id)!.toLowerCase());
  assert.equal(body.chainId, 84532);
  assert.equal(body.availableUsdc, "0.8");
  const denied = await fetch(`${base}/v1/guardian/preview/treasury`, {
    headers: { authorization: `Bearer ${f.connection.sessionKey.token}` },
  });
  assert(denied.status >= 400);
  const anonymous = await fetch(`${base}/v1/guardian/preview/treasury`);
  assert.equal(anonymous.status, 401);
});
