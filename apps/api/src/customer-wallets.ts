/** Customer-owned mainnet preparation. Never used as the legacy financial signer. */
import { createHash, randomUUID } from "node:crypto";
import { PrivyClient, NotFoundError, ConflictError } from "@privy-io/node";
import { verifyTypedData, type Address } from "viem";
import { z } from "zod";
import { commerceDatabase } from "./store.js";
import { findWorkspace, ensureWorkspaces } from "./workspaces.js";
import { verifySupabaseIdentity } from "./auth/supabase.js";

export class CustomerWalletError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 503,
  ) {
    super(message);
  }
}
// Chain IDs and native Circle USDC contracts are immutable receiving identifiers.
export const MAINNET_ASSETS = [
  { id: "base:eth", symbol: "ETH", network: "Base", chainId: 8453, decimals: 18, contract: null },
  {
    id: "base:usdc",
    symbol: "USDC",
    network: "Base",
    chainId: 8453,
    decimals: 6,
    contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  {
    id: "ethereum:eth",
    symbol: "ETH",
    network: "Ethereum",
    chainId: 1,
    decimals: 18,
    contract: null,
  },
  {
    id: "ethereum:usdc",
    symbol: "USDC",
    network: "Ethereum",
    chainId: 1,
    decimals: 6,
    contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  },
] as const;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const walletSchema = z.object({
  id: z.string().min(1).max(128),
  chain_type: z.literal("ethereum"),
  address: z.string().regex(/^0x[\da-fA-F]{40}$/),
  external_id: z.string(),
  owner_id: z.string().min(1),
  archived_at: z.number().nullable().optional(),
});
type Row = {
  workspace_id: string;
  org_id: string;
  user_id: string;
  subject: string;
  app_hash: string;
  external_id: string;
  request_key: string;
  privy_user_id: string | null;
  wallet_id: string | null;
  address: string | null;
  owner_quorum: string | null;
  verified_at: string | null;
};
function config() {
  const appId = process.env.PRIVY_APP_ID?.trim(),
    appSecret = process.env.PRIVY_APP_SECRET?.trim();
  if (!appId || !appSecret)
    throw new CustomerWalletError(
      "WALLET_UNAVAILABLE",
      "Wallet setup is awaiting provider configuration.",
    );
  return { appId, appSecret };
}
export function connectionProof(workspaceId: string, address: Address) {
  return {
    domain: { name: "ABI customer wallet connection", version: "1", chainId: 8453 },
    primaryType: "ABIConnectionProof" as const,
    types: {
      ABIConnectionProof: [
        { name: "workspaceId", type: "string" },
        { name: "wallet", type: "address" },
        { name: "challenge", type: "string" },
        { name: "expiresAt", type: "uint256" },
      ],
    },
    message: {
      workspaceId,
      wallet: address,
      challenge: randomUUID(),
      expiresAt: String(Math.floor(Date.now() / 1000) + 120),
    },
  };
}
type Proof = ReturnType<typeof connectionProof>;
export interface CustomerWalletProvider {
  user(subject: string): Promise<string>;
  get(externalId: string): Promise<unknown | null>;
  create(externalId: string, userId: string, requestKey: string): Promise<unknown>;
  prove(walletId: string, jwt: string, proof: Proof): Promise<string>;
}
/** One SDK instance per operation: authorization keys/JWTs never survive the request. */
export function privyCustomerProvider(): CustomerWalletProvider {
  const deadline = AbortSignal.timeout(15000);
  const client = new PrivyClient({
    ...config(),
    timeout: 10000,
    maxRetries: 0,
    authorizationKeyCacheMaxCapacity: 1,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        redirect: "error",
        signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline,
      }),
  });
  return {
    async user(subject) {
      try {
        return (await client.users().getByCustomAuthID({ custom_user_id: subject })).id;
      } catch (e) {
        if (!(e instanceof NotFoundError)) throw e;
      }
      try {
        return (
          await client
            .users()
            .create({ linked_accounts: [{ type: "custom_auth", custom_user_id: subject }] })
        ).id;
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        return (await client.users().getByCustomAuthID({ custom_user_id: subject })).id;
      }
    },
    async get(externalId) {
      try {
        return await client.wallets().get(`ext_wal_${externalId}`);
      } catch (e) {
        if (e instanceof NotFoundError) return null;
        throw e;
      }
    },
    async create(externalId, userId, requestKey) {
      return client.wallets().create({
        chain_type: "ethereum",
        external_id: externalId,
        owner: { user_id: userId },
        entity: { id: userId, type: "user" },
        display_name: "ABI workspace",
        idempotency_key: requestKey,
      });
    },
    async prove(walletId, jwt, proof) {
      const { primaryType, ...rest } = proof;
      const signed = await client
        .wallets()
        .ethereum()
        .signTypedData(walletId, {
          params: { typed_data: { ...rest, primary_type: primaryType } },
          caip2: "eip155:8453",
          authorization_context: { user_jwts: [jwt] },
          idempotency_key: randomUUID(),
        });
      return signed.signature;
    },
  };
}
function binding(workspaceId: string) {
  return commerceDatabase()
    .prepare("SELECT * FROM abi_customer_wallets WHERE workspace_id=?")
    .get(workspaceId) as Row | undefined;
}
function assertBinding(row: Row, userId: string, subject?: string) {
  if (row.user_id !== userId || (subject && row.subject !== subject))
    throw new CustomerWalletError(
      "WALLET_OWNER_MISMATCH",
      "Only this wallet’s linked account can manage it.",
      403,
    );
  if (row.app_hash !== hash(config().appId))
    throw new CustomerWalletError(
      "WALLET_APP_CHANGED",
      "The wallet belongs to a different Privy app. Restore its original configuration.",
      409,
    );
}
export function customerWalletStatus(orgId: string, workspaceId: string, userId: string) {
  findWorkspace(orgId, workspaceId);
  const row = binding(workspaceId);
  if (row) assertBinding(row, userId);
  const linked = commerceDatabase()
    .prepare("SELECT 1 FROM abi_external_identities WHERE user_id=?")
    .get(userId);
  return {
    provider: "privy",
    control: "customer-owned",
    environment: "mainnet",
    workspaceId,
    status: row?.verified_at
      ? "verified"
      : row?.wallet_id
        ? "verification_pending"
        : linked
          ? "setup_pending"
          : "identity_required",
    verifiedAt: row?.verified_at ?? null,
    // Addresses deliberately stay private until withdrawal/recovery and payment reconciliation are released.
    receiveEnabled: false,
    spendingEnabled: false,
    address: null,
    assets: MAINNET_ASSETS,
  };
}
export function queueCustomerWallet(
  orgId: string,
  workspaceId: string,
  userId: string,
  subject: string,
) {
  findWorkspace(orgId, workspaceId);
  const { appId } = config();
  const link = commerceDatabase()
    .prepare("SELECT user_id FROM abi_external_identities WHERE subject=?")
    .get(subject) as { user_id: string } | undefined;
  const owner = commerceDatabase()
    .prepare(
      "SELECT 1 FROM memberships WHERE org_id=? AND user_id=? AND role='owner' AND revoked_at IS NULL",
    )
    .get(orgId, userId);
  if (!link || link.user_id !== userId || !owner)
    throw new CustomerWalletError(
      "WALLET_OWNER_REQUIRED",
      "Sign in with the linked workspace owner account.",
      403,
    );
  const externalId = hash(`abi-customer-v1|${appId}|${orgId}|${workspaceId}`);
  commerceDatabase()
    .prepare(
      `INSERT OR IGNORE INTO abi_customer_wallets
    (workspace_id,org_id,user_id,subject,app_hash,external_id,request_key,created_at) VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      workspaceId,
      orgId,
      userId,
      subject,
      hash(appId),
      externalId,
      randomUUID(),
      new Date().toISOString(),
    );
  const row = binding(workspaceId)!;
  assertBinding(row, userId, subject);
  return row;
}
export async function provisionCustomerWallet(
  orgId: string,
  workspaceId: string,
  userId: string,
  jwt: string,
  provider?: CustomerWalletProvider,
  identityFetcher: typeof fetch = fetch,
) {
  config();
  const identity = await verifySupabaseIdentity(jwt, identityFetcher);
  const row = queueCustomerWallet(orgId, workspaceId, userId, identity.id);
  const api = provider ?? privyCustomerProvider();
  try {
    const privyUserId = await api.user(identity.id);
    if (row.privy_user_id && row.privy_user_id !== privyUserId)
      throw new Error("Identity mapping changed");
    commerceDatabase()
      .prepare(
        "UPDATE abi_customer_wallets SET privy_user_id=? WHERE workspace_id=? AND (privy_user_id IS NULL OR privy_user_id=?)",
      )
      .run(privyUserId, workspaceId, privyUserId);
    // Lookup first on every attempt: response loss or a 24h idempotency expiry cannot create another wallet.
    const raw =
      (await api.get(row.external_id)) ??
      (await api.create(row.external_id, privyUserId, row.request_key));
    const wallet = walletSchema.parse(raw);
    if (
      wallet.external_id !== row.external_id ||
      wallet.archived_at ||
      (row.wallet_id && row.wallet_id !== wallet.id) ||
      (row.address && row.address.toLowerCase() !== wallet.address.toLowerCase()) ||
      (row.owner_quorum && row.owner_quorum !== wallet.owner_id)
    )
      throw new Error("Wallet binding changed");
    // Prove authority with the verified user's JWT, never app credentials alone.
    // Clear stale verification before a fresh check, including provider ownership changes.
    commerceDatabase()
      .prepare("UPDATE abi_customer_wallets SET verified_at=NULL WHERE workspace_id=?")
      .run(workspaceId);
    const proof = connectionProof(workspaceId, wallet.address as Address);
    const signature = await api.prove(wallet.id, jwt, proof);
    if (
      !/^0x[\da-fA-F]{130}$/.test(signature) ||
      !(await verifyTypedData({
        ...proof,
        address: wallet.address as Address,
        signature: signature as `0x${string}`,
      }))
    )
      throw new Error("Invalid connection proof");
    commerceDatabase()
      .prepare(
        `UPDATE abi_customer_wallets SET wallet_id=?,address=?,owner_quorum=?,verified_at=? WHERE workspace_id=?`,
      )
      .run(wallet.id, wallet.address, wallet.owner_id, new Date().toISOString(), workspaceId);
    return customerWalletStatus(orgId, workspaceId, userId);
  } catch {
    // Provider errors must not leak credentials, JWTs or request bodies.
    commerceDatabase()
      .prepare("UPDATE abi_customer_wallets SET verified_at=NULL WHERE workspace_id=?")
      .run(workspaceId);
    throw new CustomerWalletError(
      "WALLET_SETUP_PENDING",
      "Wallet setup could not finish. Check Privy’s custom authentication settings, then retry. Your account and existing funds are unchanged.",
    );
  }
}
/** Persist preparation without making account creation depend on provider availability. */
export function queueDefaultCustomerWallet(userId: string, orgId: string) {
  const w = ensureWorkspaces(orgId).find((w) => w.is_default);
  const identity = commerceDatabase()
    .prepare("SELECT subject FROM abi_external_identities WHERE user_id=?")
    .get(userId) as { subject: string } | undefined;
  if (!w || !identity) return;
  try {
    queueCustomerWallet(orgId, String(w.id), userId, identity.subject);
  } catch {
    /* Wallet exposes configuration or owner errors. */
  }
}
