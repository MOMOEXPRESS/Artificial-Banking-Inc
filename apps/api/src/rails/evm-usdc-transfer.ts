/**
 * Real Base USDC transfer rail — broadcasts ERC-20 `transfer` from the org vault
 * to an allowlisted 0x destination. Used for agent `pay` (and withdraw-shaped pays).
 */
import type { PaymentRail, PaymentRailContext, PaymentRailResult } from "./types.js";
import { transferUsdcFromVault, VaultTransferError } from "../chain/transfer.js";
import { X402Error } from "./x402.js";

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
        // VaultTransferError's codes are part of RailErrorCode, so rethrow as
        // the typed rail error the engine already handles. This used to be a
        // plain Error with a duck-typed `code` property, which type-checked
        // but left the contract undocumented.
        if (e.code === "TRANSFER_FAILED") {
          throw new X402Error("RAIL_FAILED", e.message);
        }
        throw new X402Error(e.code, e.message);
      }
      throw e;
    }
  }
}

/** True when destination is a bare EVM address (agent pay-to-wallet). */
export function isEvmPayDestination(destination: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(destination.trim());
}
