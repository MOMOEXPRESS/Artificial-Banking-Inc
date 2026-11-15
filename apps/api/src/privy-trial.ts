/** Isolated provider proof. Never registered as the financial custody signer. */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { verifyTypedData, type Address } from "viem";
import { commerceDatabase } from "./store.js";
import { findWorkspace } from "./workspaces.js";
import { privyFetch } from "./privy-transport.js";

export class PrivyTrialError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 503,
  ) {
    super(message);
  }
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const walletSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  address,
  chain_type: z.literal("ethereum"),
  external_id: z.string(),
  owner_id: z.string().nullable().optional(),
  archived_at: z.number().nullable().optional(),
});
type Wallet = z.infer<typeof walletSchema>;
type Binding = {
  workspace_id: string;
  org_id: string;
  app_hash: string;
  external_id: string;
  request_key: string;
  wallet_id: string | null;
  address: string | null;
  verified_at: string | null;
  created_at: string;
};
function config() {
  const appId = process.env.PRIVY_APP_ID?.trim(),
    secret = process.env.PRIVY_APP_SECRET?.trim();
  if (!appId || !secret)
    throw new PrivyTrialError(
      "PRIVY_NOT_CONFIGURED",
      "Add the Privy test app credentials to the API's secret settings.",
    );
  if ((process.env.CHAIN ?? "base-sepolia") !== "base-sepolia")
    throw new PrivyTrialError(
      "TESTNET_ONLY",
      "The Privy trial is available only on Base Sepolia.",
      403,
    );
  return { appId, secret };
}
// Fixed origin, no caller-selected URLs or automatic redirects carrying credentials.
export class PrivyTrialClient {
  constructor(
    private readonly appId: string,
    private readonly secret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private async request(path: string, body?: unknown, requestKey?: string): Promise<unknown> {
    let response: Response;
    try {
      response = await privyFetch(
        `https://api.privy.io/v1/wallets${path ? "/" + path : ""}`,
        {
          method: body === undefined ? "GET" : "POST",
          headers: {
            authorization: `Basic ${Buffer.from(`${this.appId}:${this.secret}`).toString("base64")}`,
            "privy-app-id": this.appId,
            "content-type": "application/json",
            ...(requestKey ? { "privy-idempotency-key": requestKey } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(10000),
        },
        this.fetcher,
      );
    } catch {
      throw new PrivyTrialError(
        "PRIVY_UNAVAILABLE",
        "Privy could not be reached. Retry this same workspace.",
      );
    }
    if (response.status === 404 && body === undefined) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      // Never forward the provider body: it may contain credential/request details.
      throw new PrivyTrialError(
        response.status >= 500 ? "PRIVY_SERVER_ERROR" : "PRIVY_REQUEST_FAILED",
        response.status === 401 || response.status === 403
          ? "Privy rejected the API credentials or wallet authorization. Check the test app settings."
          : "Privy did not complete the request. Retry this same workspace.",
      );
    }
    const reader = response.body?.getReader();
    if (!reader)
      throw new PrivyTrialError("PRIVY_INVALID_RESPONSE", "Privy returned an empty response.");
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) {
        await reader.cancel();
        throw new PrivyTrialError(
          "PRIVY_INVALID_RESPONSE",
          "Privy's response exceeded the wallet response limit.",
        );
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new PrivyTrialError("PRIVY_INVALID_RESPONSE", "Privy returned an invalid response.");
    }
  }
  async get(externalId: string) {
    return this.request(`ext_wal_${encodeURIComponent(externalId)}`);
  }
  async create(externalId: string, requestKey: string) {
    return this.request(
      "",
      { chain_type: "ethereum", external_id: externalId, display_name: "ABI testnet trial" },
      requestKey,
    );
  }
  async prove(walletId: string, workspaceId: string, expectedAddress: Address) {
    const proof = {
      domain: { name: "ABI wallet connection", version: "1", chainId: 84532 },
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
        wallet: expectedAddress,
        challenge: randomUUID(),
        expiresAt: BigInt(Math.floor(Date.now() / 1000) + 120),
      },
    };
    const raw = await this.request(
      `${encodeURIComponent(walletId)}/rpc`,
      {
        method: "eth_signTypedData_v4",
        chain_type: "ethereum",
        caip2: "eip155:84532",
        params: {
          typed_data: {
            domain: { name: proof.domain.name, version: "1", chainId: 84532 },
            primary_type: proof.primaryType,
            types: proof.types,
            message: { ...proof.message, expiresAt: proof.message.expiresAt.toString() },
          },
        },
      },
      randomUUID(),
    );
    const result = z
      .object({
        method: z.literal("eth_signTypedData_v4"),
        data: z.object({
          encoding: z.literal("hex"),
          signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
        }),
      })
      .safeParse(raw);
    if (
      !result.success ||
      !(await verifyTypedData({
        ...proof,
        address: expectedAddress,
        signature: result.data.data.signature as `0x${string}`,
      }))
    )
      throw new PrivyTrialError(
        "PRIVY_SIGNATURE_INVALID",
        "The wallet signature could not be verified.",
      );
    // No signature is returned or broadcast. This schema cannot authorize USDC spending.
  }
}
function binding(workspaceId: string) {
  return commerceDatabase()
    .prepare("SELECT * FROM abi_privy_test_wallets WHERE workspace_id=?")
    .get(workspaceId) as Binding | undefined;
}
function managedBinding(workspaceId: string) {
  return commerceDatabase()
    .prepare("SELECT * FROM abi_managed_wallets WHERE workspace_id=?")
    .get(workspaceId) as Binding | undefined;
}
function checked(raw: unknown, externalId: string): Wallet {
  const value = walletSchema.safeParse(raw);
  if (
    !value.success ||
    value.data.external_id !== externalId ||
    value.data.archived_at ||
    value.data.owner_id
  )
    throw new PrivyTrialError(
      "PRIVY_WALLET_MISMATCH",
      "Privy's wallet does not match this application-controlled test workspace.",
    );
  return value.data;
}
function view(row: Binding | undefined) {
  return row
    ? {
        address: row.address,
        providerWalletId: row.wallet_id,
        status: row.wallet_id ? "ready" : "pending",
        verifiedAt: row.verified_at,
      }
    : null;
}
export function privyTrialStatus(orgId: string, workspaceId: string) {
  findWorkspace(orgId, workspaceId);
  return {
    provider: "privy",
    network: "base-sepolia",
    control: "application-controlled-test",
    spendingEnabled: false,
    configured: !!(process.env.PRIVY_APP_ID?.trim() && process.env.PRIVY_APP_SECRET?.trim()),
    available: (process.env.CHAIN ?? "base-sepolia") === "base-sepolia",
    wallet: view(binding(workspaceId) ?? managedBinding(workspaceId)),
  };
}
export async function provisionPrivyTrial(
  orgId: string,
  workspaceId: string,
  fetcher: typeof fetch = fetch,
) {
  findWorkspace(orgId, workspaceId);
  const c = config(),
    appHash = hash(c.appId);
  // An older console must not create a second address after managed-wallet rollout.
  const managed = managedBinding(workspaceId);
  if (managed && !binding(workspaceId)) {
    if (managed.org_id !== orgId || managed.app_hash !== appHash)
      throw new PrivyTrialError(
        "PRIVY_APP_CHANGED",
        "Restore this workspace wallet’s original Privy application.",
        409,
      );
    if (!managed.verified_at)
      throw new PrivyTrialError(
        "PRIVY_WALLET_PENDING",
        "Open Wallet in the current ABI console to finish this workspace’s wallet setup.",
        409,
      );
    return privyTrialStatus(orgId, workspaceId);
  }
  const externalId = `abi_trial_${hash(`${c.appId}|${orgId}|${workspaceId}`).slice(0, 48)}`;
  commerceDatabase()
    .prepare(
      "INSERT OR IGNORE INTO abi_privy_test_wallets(workspace_id,org_id,app_hash,external_id,request_key,created_at) VALUES (?,?,?,?,?,?)",
    )
    .run(workspaceId, orgId, appHash, externalId, randomUUID(), new Date().toISOString());
  const row = binding(workspaceId)!;
  if (row.org_id !== orgId || row.app_hash !== appHash)
    throw new PrivyTrialError(
      "PRIVY_APP_CHANGED",
      "This trial wallet belongs to another Privy app. Restore its credentials; do not replace the wallet.",
      409,
    );
  const client = new PrivyTrialClient(c.appId, c.secret, fetcher);
  let raw = await client.get(externalId);
  if (raw === null) {
    // A previously mapped wallet must never be silently replaced after archive/deletion.
    if (row.wallet_id)
      throw new PrivyTrialError(
        "PRIVY_WALLET_UNAVAILABLE",
        "The recorded trial wallet could not be found. Check the original Privy app.",
        409,
      );
    try {
      raw = await client.create(externalId, row.request_key);
    } catch (e) {
      if (e instanceof PrivyTrialError && e.code === "PRIVY_SERVER_ERROR")
        commerceDatabase()
          .prepare(
            "UPDATE abi_privy_test_wallets SET request_key=? WHERE workspace_id=? AND request_key=?",
          )
          .run(randomUUID(), workspaceId, row.request_key);
      // A concurrent create can hit the external-ID uniqueness constraint.
      raw = await client.get(externalId);
      if (raw === null) throw e;
    }
  }
  const wallet = checked(raw, externalId);
  const changed = commerceDatabase()
    .prepare(
      "UPDATE abi_privy_test_wallets SET wallet_id=?,address=? WHERE workspace_id=? AND (wallet_id IS NULL OR (wallet_id=? AND lower(address)=lower(?)))",
    )
    .run(wallet.id, wallet.address, workspaceId, wallet.id, wallet.address);
  if (!changed.changes)
    throw new PrivyTrialError(
      "PRIVY_WALLET_MISMATCH",
      "The provider wallet changed unexpectedly.",
      409,
    );
  return privyTrialStatus(orgId, workspaceId);
}
export async function verifyPrivyTrial(
  orgId: string,
  workspaceId: string,
  fetcher: typeof fetch = fetch,
) {
  findWorkspace(orgId, workspaceId);
  if (!(binding(workspaceId) ?? managedBinding(workspaceId))?.wallet_id)
    throw new PrivyTrialError(
      "PRIVY_WALLET_REQUIRED",
      "Create this workspace's test wallet before verifying its connection.",
      409,
    );
  await provisionPrivyTrial(orgId, workspaceId, fetcher);
  const row = (binding(workspaceId) ?? managedBinding(workspaceId))!,
    c = config();
  await new PrivyTrialClient(c.appId, c.secret, fetcher).prove(
    row.wallet_id!,
    workspaceId,
    row.address as Address,
  );
  commerceDatabase()
    .prepare("UPDATE abi_privy_test_wallets SET verified_at=? WHERE workspace_id=?")
    .run(new Date().toISOString(), workspaceId);
  return privyTrialStatus(orgId, workspaceId);
}
