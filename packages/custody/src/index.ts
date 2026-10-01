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
    private readonly lookup: (
      orgId: string,
    ) => { address: `0x${string}`; privateKey: `0x${string}`; network?: ChainNetwork } | null,
    private readonly sign: (
      privateKey: `0x${string}`,
      typedData: SignTypedDataArgs["typedData"],
    ) => Promise<`0x${string}`>,
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

/**
 * Placeholder for real Coinbase CDP Server Wallet custody (roadmap P4-T1).
 * Deliberately throws: nothing should be able to report "cdp" until there is
 * an actual Coinbase integration behind it.
 */
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
 * Production-mode **self-custody** provider.
 *
 * ⚠️  This is NOT Coinbase CDP. It was previously named `CdpVaultProvider` with
 * `name = "cdp"`, which caused the API, the Settings screen and the marketing
 * site to report Coinbase custody that does not exist. There is no Coinbase
 * dependency anywhere in this monorepo.
 *
 * What it actually does: reads the org's private key via the same `lookup`
 * closure as {@link DevLocalProvider} and signs locally. Requiring CDP API
 * credentials to activate it only signals go-live *intent*; the credentials are
 * never used to call Coinbase.
 *
 * Real CDP Server Wallet custody is roadmap **P4-T1** and will implement this
 * same interface — see {@link CdpProviderStub}. Until then the honest
 * description of this posture is "self-custodied hot key".
 *
 * Keys never enter the LLM. They do, however, live in the application
 * database — which is exactly why P4-T1 exists.
 */
export class SelfCustodyVaultProvider implements CustodyProvider {
  readonly name = "self-custody";

  constructor(
    private readonly lookup: (
      orgId: string,
    ) => { address: `0x${string}`; privateKey: `0x${string}`; network?: ChainNetwork } | null,
    private readonly sign: (
      privateKey: `0x${string}`,
      typedData: SignTypedDataArgs["typedData"],
    ) => Promise<`0x${string}`>,
    readonly credentials: { apiKeyId?: string; network?: ChainNetwork },
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

/**
 * Whether the application-managed signer is enabled. Legacy CDP credentials
 * still toggle this for compatibility, but they are never used to call Coinbase.
 */
export function onchainSignerConfigured(): boolean {
  // ABI_ONCHAIN_ENABLED is the explicit self-custody switch. The CDP variable
  // check remains temporarily for existing deployments, but those credentials
  // are not used to authenticate with Coinbase or provide CDP custody.
  return (
    process.env.ABI_ONCHAIN_ENABLED === "1" ||
    Boolean(process.env.CDP_API_KEY_ID?.trim() && process.env.CDP_API_KEY_SECRET?.trim())
  );
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
