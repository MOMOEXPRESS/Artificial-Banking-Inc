/**
 * Instant mock transfer rail — books the full authorized amount with a
 * synthetic tx hash. Used for `pay` (non-HTTP destinations) in local/dev.
 */
import { randomBytes } from "node:crypto";
import type { PaymentRail, PaymentRailContext, PaymentRailResult } from "./types.js";

export class TransferMockRail implements PaymentRail {
  readonly name = "transfer-mock";

  async settle(ctx: PaymentRailContext): Promise<PaymentRailResult> {
    return {
      chargedMicro: ctx.authorizedMicro,
      rail: this.name,
      txHash: `0xmock_${randomBytes(8).toString("hex")}`,
      settled: true,
    };
  }
}
