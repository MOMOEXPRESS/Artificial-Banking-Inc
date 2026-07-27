/**
 * Instant mock transfer rail — books the full authorized amount with a
 * synthetic tx hash. Used for `pay` (non-HTTP destinations) in local/dev.
 */
import { randomBytes } from "node:crypto";
import type { PaymentRail, PaymentRailContext, PaymentRailResult } from "./types.js";

export class TransferMockRail implements PaymentRail {
  readonly name = "transfer-mock";

  async settle(ctx: PaymentRailContext): Promise<PaymentRailResult> {
    const txHash = `0xmock_${randomBytes(8).toString("hex")}`;
    // Nothing irreversible happens here, but reporting it keeps the settlement
    // state machine identical across rails.
    ctx.onBroadcast?.(this.name, txHash);
    return {
      chargedMicro: ctx.authorizedMicro,
      rail: this.name,
      txHash,
      settled: true,
    };
  }
}
