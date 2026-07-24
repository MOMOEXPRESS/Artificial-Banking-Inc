/**
 * Real Base USDC transfer rail — broadcasts ERC-20 `transfer` from the org vault
 * to an allowlisted 0x destination. Used for agent `pay` (and withdraw-shaped pays).
 */
import type { PaymentRail, PaymentRailContext, PaymentRailResult } from "./types.js";
import { transferUsdcFromVault, VaultTransferError } from "../chain/transfer.js";

export class EvmUsdcTransferRail implements PaymentRail {
  readonly name = "evm-usdc-transfer";

  async settle(ctx: PaymentRailContext): Promise<PaymentRailResult> {
    try {
      const out = await transferUsdcFromVault({
        orgId: ctx.orgId,
        to: ctx.destination,
        amountMicro: ctx.authorizedMicro,
      });
      return {
        chargedMicro: ctx.authorizedMicro,
        rail: this.name,
        txHash: out.txHash,
        resource: {
          explorerUrl: out.explorerUrl,
          from: out.from,
          to: out.to,
          network: out.network,
          chainId: out.chainId,
        },
        settled: true,
      };
    } catch (e) {
      if (e instanceof VaultTransferError) {
        // Map to X402Error-compatible codes via a typed rethrow the engine already understands.
        const err = new Error(e.message) as Error & { code: string };
        err.code = e.code;
        err.name = "VaultTransferError";
        throw err;
      }
      throw e;
    }
  }
}

/** True when destination is a bare EVM address (agent pay-to-wallet). */
export function isEvmPayDestination(destination: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(destination.trim());
}
