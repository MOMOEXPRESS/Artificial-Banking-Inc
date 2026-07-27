/**
 * EIP-712 domain resolution for payment tokens.
 *
 * Audit finding (P5-T1): `eip712Domain()` hardcoded `name: "USD Coin"` for
 * every network. Verified against the live contracts on 2026-07-26:
 *
 *   Base mainnet USDC 0x8335…2913 -> name "USD Coin", version "2"
 *   Base Sepolia USDC 0x036C…CF7e -> name "USDC",     version "2"
 *
 * So on Base Sepolia — the default chain, and the entire testnet path — every
 * `TransferWithAuthorization` was signed over the wrong domain separator. The
 * bundled dev facilitator hardcoded the same wrong value, so the loop verified
 * against itself and passed; against the real token contract or a real
 * facilitator, signature recovery would have produced the wrong address and the
 * payment would have been rejected. This is why x402 had never settled on a
 * real network despite the docs claiming otherwise.
 *
 * The static table below is the verified source of truth. `resolveTokenDomain`
 * prefers it, and can confirm it against the chain when asked — a token
 * upgrading its version would otherwise silently break signing again.
 */
import { createPublicClient, http, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";
import { activeChain, rpcUrl, type AbiChain } from "./network.js";

export interface TokenDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

/** Verified against the deployed contracts. Do not edit without re-checking. */
const KNOWN: Record<string, { name: string; version: string }> = {
  // Base mainnet USDC
  "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { name: "USD Coin", version: "2" },
  // Base Sepolia USDC — note the name differs from mainnet.
  "84532:0x036cbd53842c5426634e7929541ec2318f3dcf7e": { name: "USDC", version: "2" },
};

const cache = new Map<string, TokenDomain>();

function keyFor(chainId: number, token: string): string {
  return `${chainId}:${token.toLowerCase()}`;
}

export function chainIdFor(network: AbiChain): number {
  return network === "base" ? 8453 : 84532;
}

/**
 * Domain for a token, without touching the network.
 *
 * Throws for an unknown token rather than guessing: signing with a wrong
 * domain produces a signature that recovers to some other address, which is
 * worse than refusing to sign at all.
 */
export function tokenDomain(network: AbiChain, token: Address): TokenDomain {
  const chainId = chainIdFor(network);
  const key = keyFor(chainId, token);
  const cached = cache.get(key);
  if (cached) return cached;

  const known = KNOWN[key];
  if (!known) {
    throw new Error(
      `No verified EIP-712 domain for token ${token} on ${network}. Refusing to sign: ` +
        "an incorrect domain yields a signature that recovers to the wrong address.",
    );
  }
  const domain: TokenDomain = { ...known, chainId, verifyingContract: token };
  cache.set(key, domain);
  return domain;
}

const erc20DomainAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

/**
 * Read the domain from the contract and reconcile it with the static table.
 *
 * Run at boot (best-effort) so a mismatch is discovered by an operator rather
 * than by a customer's failed payment. A network failure is not treated as a
 * mismatch — an unreachable RPC says nothing about the contract.
 */
export async function verifyTokenDomainOnchain(
  network: AbiChain = activeChain().id,
  token: Address = activeChain().usdc,
): Promise<{ ok: boolean; expected?: TokenDomain; onchain?: { name: string; version: string }; error?: string }> {
  let expected: TokenDomain;
  try {
    expected = tokenDomain(network, token);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  try {
    const client = createPublicClient({
      chain: network === "base" ? base : baseSepolia,
      transport: http(rpcUrl(), { timeout: 15_000 }),
    });
    const [name, version] = await Promise.all([
      client.readContract({ address: token, abi: erc20DomainAbi, functionName: "name" }),
      client.readContract({ address: token, abi: erc20DomainAbi, functionName: "version" }),
    ]);
    const ok = name === expected.name && version === expected.version;
    if (ok) {
      cache.set(keyFor(expected.chainId, token), expected);
    }
    return { ok, expected, onchain: { name, version } };
  } catch (e) {
    return { ok: true, expected, error: `RPC unavailable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Test-only: drop memoised domains. */
export function resetTokenDomainCacheForTests(): void {
  cache.clear();
}
