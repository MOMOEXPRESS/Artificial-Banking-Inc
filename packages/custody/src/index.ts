/**
 * Custody adapter — the only place that should ever touch signing keys.
 *
 * Today: DevLocalProvider (private key in SQLite for demo/x402).
 * Tomorrow: CdpProvider / TEE / ERC-4337 without rewriting rails or the engine.
 */
export type ChainNetwork = "base" | "base-sepolia";

export interface CustodyAddress {
  address: `0x${string}`;
  network: ChainNetwork;
  provider: string;
}

export interface SignTypedDataArgs {
  orgId: string;
  /** EIP-712 domain / types / message — opaque to keep this package chain-lib free. */
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  };
}

export interface CustodyProvider {
  readonly name: string;
  getAddress(orgId: string): Promise<CustodyAddress | null>;
  /**
   * Sign an EIP-712 payload. Returns a hex signature.
   * Implementations must never expose the raw private key to callers.
   */
  signTypedData(args: SignTypedDataArgs): Promise<`0x${string}`>;
}

/**
 * Dev/local provider — wraps a key lookup function supplied by the host app.
 * Production must swap this for CDP (or another HSM/TEE) via `setCustodyProvider`.
 */
export class DevLocalProvider implements CustodyProvider {
  readonly name = "dev-local";

  constructor(
    private readonly lookup: (orgId: string) =>
      | { address: `0x${string}`; privateKey: `0x${string}`; network?: ChainNetwork }
      | null,
    private readonly sign: (privateKey: `0x${string}`, typedData: SignTypedDataArgs["typedData"]) => Promise<`0x${string}`>,
  ) {}

  async getAddress(orgId: string): Promise<CustodyAddress | null> {
    const row = this.lookup(orgId);
    if (!row) return null;
    return {
      address: row.address,
      network: row.network ?? "base-sepolia",
      provider: this.name,
    };
  }

  async signTypedData(args: SignTypedDataArgs): Promise<`0x${string}`> {
    const row = this.lookup(args.orgId);
    if (!row) throw new Error("CUSTODY_UNAVAILABLE");
    return this.sign(row.privateKey, args.typedData);
  }
}

/** Placeholder so CDP can drop in without touching payment rails. */
export class CdpProviderStub implements CustodyProvider {
  readonly name = "cdp";

  async getAddress(_orgId: string): Promise<CustodyAddress | null> {
    return null;
  }

  async signTypedData(_args: SignTypedDataArgs): Promise<`0x${string}`> {
    throw new Error("CUSTODY_UNAVAILABLE: Coinbase CDP provider not configured");
  }
}

/**
 * Go-live custody behind the **existent org vault address**.
 *
 * - `getAddress` always returns the Fund-tab vault (deposit USDC here).
 * - Signing uses the vault key held in the host process (same DevLocal lookup),
 *   so rails/x402 do not change.
 * - CDP API credentials are required to activate this provider (proves go-live
 *   intent). Optional `CDP_API_BASE` reserved for Server Wallet swap later.
 *
 * Keys never enter the LLM; they never leave the custody boundary.
 */
export class CdpVaultProvider implements CustodyProvider {
  readonly name = "cdp";

  constructor(
    private readonly lookup: (orgId: string) =>
      | { address: `0x${string}`; privateKey: `0x${string}`; network?: ChainNetwork }
      | null,
    private readonly sign: (
      privateKey: `0x${string}`,
      typedData: SignTypedDataArgs["typedData"],
    ) => Promise<`0x${string}`>,
    readonly credentials: { apiKeyId: string; network?: ChainNetwork },
  ) {}

  async getAddress(orgId: string): Promise<CustodyAddress | null> {
    const row = this.lookup(orgId);
    if (!row) return null;
    return {
      address: row.address,
      network: row.network ?? this.credentials.network ?? "base-sepolia",
      provider: this.name,
    };
  }

  async signTypedData(args: SignTypedDataArgs): Promise<`0x${string}`> {
    const row = this.lookup(args.orgId);
    if (!row) throw new Error("CUSTODY_UNAVAILABLE: vault not found for org");
    return this.sign(row.privateKey, args.typedData);
  }
}

export function cdpEnvConfigured(): boolean {
  return Boolean(process.env.CDP_API_KEY_ID?.trim() && process.env.CDP_API_KEY_SECRET?.trim());
}

let active: CustodyProvider | null = null;

export function setCustodyProvider(provider: CustodyProvider): void {
  active = provider;
}

export function getCustodyProvider(): CustodyProvider {
  if (!active) {
    throw new Error("CUSTODY_UNAVAILABLE: no custody provider registered");
  }
  return active;
}
