/** MPP EVM charge wire support, sharing ABI's EIP-3009 x402 settlement guards. */
import { createHmac, randomUUID } from "node:crypto";
import { Challenge, Credential, Receipt, PaymentRequest } from "mppx";
import { charge as evmMethod, challengeHash } from "mppx/evm";
import { charge as evmClient } from "mppx/evm/client";
import { toAccount } from "viem/accounts";
import { z } from "zod";
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";
import type { ClientEvmSigner } from "@x402/evm";

const requestSchema = z.object({
  amount: z.string().regex(/^[1-9]\d*$/),
  currency: z.string().regex(/^0x[\da-fA-F]{40}$/),
  recipient: z.string().regex(/^0x[\da-fA-F]{40}$/),
  methodDetails: z.object({
    chainId: z.literal(84532),
    decimals: z.literal(6),
    credentialTypes: z.array(z.literal("authorization")),
    splits: z.array(z.unknown()).optional(),
  }),
});
const payloadSchema = z.object({
  type: z.literal("authorization"),
  from: z.string().regex(/^0x[\da-fA-F]{40}$/),
  to: z.string().regex(/^0x[\da-fA-F]{40}$/),
  value: z.string().regex(/^[1-9]\d*$/),
  validAfter: z.string().regex(/^\d+$/),
  validBefore: z.string().regex(/^\d+$/),
  nonce: z.string().regex(/^0x[\da-fA-F]{64}$/),
  signature: z.string().regex(/^0x[\da-fA-F]{130}$/),
});
function challengeMeta(challenge: Challenge.Challenge) {
  return challenge.opaque
    ? z.record(z.string(), z.string()).parse(PaymentRequest.deserialize(challenge.opaque))
    : challenge.meta;
}
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
export function mppSecret(): string | undefined {
  const key =
    process.env.ABI_KEK || process.env.ABI_KEY_PEPPER || process.env.POLICYVAULT_KEY_PEPPER;
  return key
    ? createHmac("sha256", key).update("abi:mpp:evm:challenge:v1").digest("hex")
    : undefined;
}
export function mppChallenge(requirement: PaymentRequirements, url: string): string | undefined {
  const secretKey = mppSecret();
  if (
    !secretKey ||
    requirement.network !== "eip155:84532" ||
    requirement.asset.toLowerCase() !== USDC
  )
    return;
  const amount = BigInt(requirement.amount);
  if (amount <= 0n) return;
  return Challenge.serialize(
    Challenge.fromMethod(evmMethod, {
      secretKey,
      realm: new URL(url).host,
      expires: new Date(Date.now() + 120_000).toISOString(),
      meta: { resource: url, nonce: randomUUID() },
      request: {
        amount: `${amount / 1_000_000n}.${(amount % 1_000_000n).toString().padStart(6, "0")}`,
        chainId: 84532,
        currency: requirement.asset,
        decimals: 6,
        recipient: requirement.payTo,
      },
    }),
  );
}
export function parseMppChallenge(header: string, url: string) {
  const challenge = Challenge.deserialize(header);
  if (
    challenge.method !== "evm" ||
    challenge.intent !== "charge" ||
    challenge.realm !== new URL(url).host ||
    !challenge.expires ||
    Date.parse(challenge.expires) <= Date.now() ||
    Date.parse(challenge.expires) > Date.now() + 300_000 ||
    challenge.digest ||
    (challenge.header &&
      !["authorization", "payment-authorization"].includes(challenge.header.toLowerCase()))
  )
    throw Error("Unsupported or expired MPP challenge.");
  const request = requestSchema.parse(challenge.request);
  if (
    request.currency.toLowerCase() !== USDC ||
    request.methodDetails.splits?.length ||
    !request.methodDetails.credentialTypes.includes("authorization")
  )
    throw Error("MPP requires Base Sepolia native USDC without splits.");
  const resource = challengeMeta(challenge)?.resource;
  if (resource && resource !== url) throw Error("MPP challenge belongs to a different resource.");
  const requirement: PaymentRequirements = {
    scheme: "exact",
    network: "eip155:84532",
    asset: request.currency,
    amount: request.amount,
    payTo: request.recipient,
    maxTimeoutSeconds: 120,
    extra: { name: "USDC", version: "2" },
  };
  return {
    challenge,
    requirement,
    required: {
      x402Version: 2,
      resource: { url },
      accepts: [requirement],
    } satisfies PaymentRequired,
  };
}
export async function signMpp(
  header: string,
  url: string,
  signer: ClientEvmSigner,
  ceiling: bigint,
) {
  const { challenge } = parseMppChallenge(header, url);
  const account = toAccount({
    address: signer.address,
    signTypedData: async (args) =>
      signer.signTypedData(args as Parameters<ClientEvmSigner["signTypedData"]>[0]),
    signMessage: async () => {
      throw Error("Message signing is not supported.");
    },
    signTransaction: async () => {
      throw Error("Transaction signing is not supported.");
    },
  });
  const method = evmClient({
    account,
    currencies: [USDC as `0x${string}`],
    maxAmount: `${ceiling / 1_000_000n}.${(ceiling % 1_000_000n).toString().padStart(6, "0")}`,
    networks: [84532],
    decimals: 6,
    authorization: { name: "USDC", version: "2" },
  });
  const credential = await method.createCredential({
    challenge: challenge as Parameters<typeof method.createCredential>[0]["challenge"],
    context: {},
  });
  const payload = payloadSchema.parse(Credential.deserialize(credential).payload);
  const { signature, type: _type, ...authorization } = payload;
  const { requirement } = parseMppChallenge(header, url);
  return {
    header: credential,
    headerName: challenge.header ?? "Authorization",
    payload: {
      x402Version: 2,
      accepted: requirement,
      payload: { signature, authorization },
    } satisfies PaymentPayload,
  };
}
export function mppCredentialToX402(
  header: string,
  requirement: PaymentRequirements,
  url: string,
): PaymentPayload {
  if (Buffer.byteLength(header) > 8192) throw Error("MPP credential exceeds the header limit.");
  const credential = Credential.deserialize(header),
    secretKey = mppSecret();
  if (!secretKey || !Challenge.verify(credential.challenge, { secretKey }))
    throw Error("Invalid MPP challenge authentication.");
  const parsed = parseMppChallenge(Challenge.serialize(credential.challenge), url);
  if (
    challengeMeta(credential.challenge)?.resource !== url ||
    parsed.requirement.amount !== requirement.amount ||
    parsed.requirement.asset.toLowerCase() !== requirement.asset.toLowerCase() ||
    parsed.requirement.payTo.toLowerCase() !== requirement.payTo.toLowerCase() ||
    parsed.requirement.network !== requirement.network
  )
    throw Error("MPP payment terms changed or belong to another offer.");
  const payload = payloadSchema.parse(credential.payload),
    now = BigInt(Math.floor(Date.now() / 1000));
  if (
    payload.nonce !== challengeHash(credential.challenge) ||
    payload.to.toLowerCase() !== requirement.payTo.toLowerCase() ||
    payload.value !== requirement.amount ||
    BigInt(payload.validAfter) > now ||
    BigInt(payload.validBefore) <= now ||
    BigInt(payload.validBefore) >
      BigInt(Math.floor(Date.parse(credential.challenge.expires!) / 1000))
  )
    throw Error("Invalid MPP authorization binding or validity window.");
  if (
    credential.source &&
    credential.source.toLowerCase() !== `did:pkh:eip155:84532:${payload.from}`.toLowerCase()
  )
    throw Error("MPP payer source mismatch.");
  const { signature, type: _type, ...authorization } = payload;
  return { x402Version: 2, accepted: requirement, payload: { signature, authorization } };
}
export function mppReceipt(txHash: string) {
  return Receipt.serialize({
    method: "evm",
    status: "success",
    reference: txHash,
    timestamp: new Date().toISOString(),
  });
}
export function readMppReceipt(header: string): SettleResponse {
  const r = Receipt.deserialize(header);
  if (r.method !== "evm" || r.status !== "success" || !/^0x[\da-fA-F]{64}$/.test(r.reference))
    throw Error("Invalid MPP settlement receipt.");
  return { success: true, transaction: r.reference as `0x${string}`, network: "eip155:84532" };
}
