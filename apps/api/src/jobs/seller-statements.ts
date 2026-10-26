/**
 * Monthly seller statements: on the first run of each UTC month, total last
 * month's on-chain settlements for every seller into a statement and email it
 * to the seller's partner accounts. Generation is idempotent per period, and
 * a statement is emailed once.
 */
import { formatMicroToUsdc } from "@policyvault/common";
import { resolveConsoleUrl, sendEmail } from "../platform/email.js";
import { partnerStore, sellerStore, store } from "../store.js";

export function previousMonth(now = new Date()): { periodStart: string; periodEnd: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
  return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
}

export async function runSellerStatements(
  now = new Date(),
): Promise<{ generated: number; emailed: number }> {
  const window = previousMonth(now);
  const consoleUrl = resolveConsoleUrl();
  let generated = 0;
  let emailed = 0;
  for (const orgId of sellerStore.listSellerOrgIds()) {
    const profile = store.getSellerProfile(orgId);
    const { invoice, created } = sellerStore.generateInvoice({
      sellerOrgId: orgId,
      ...window,
      payoutAddress: profile?.payoutAddress ?? undefined,
      network: profile?.network,
    });
    if (created) generated += 1;
    if (invoice.emailedAt || invoice.settlementCount === 0) continue;
    const recipients = partnerStore.accountsForOrg(orgId);
    if (!recipients.length) continue;
    const month = window.periodStart.slice(0, 7);
    const lines = invoice.lines
      .map(
        (l) =>
          `  ${l.slug} ${l.version}: ${l.calls} paid calls, ${formatMicroToUsdc(BigInt(l.amountMicro))} USDC`,
      )
      .join("\n");
    const link = consoleUrl.ok ? `${consoleUrl.url}/seller/billing` : "your seller console";
    let sent = false;
    for (const account of recipients) {
      const result = await sendEmail({
        to: account.email,
        subject: `ABI statement ${invoice.number} (${month})`,
        text: `Hi ${account.name},\n\nYour ABI statement for ${month}:\n\n${lines}\n\nTotal settled to ${invoice.payoutAddress ?? "your payout address"}: ${formatMicroToUsdc(BigInt(invoice.totalMicro))} USDC across ${invoice.settlementCount} payments.\n\nEvery payment already settled on-chain to your wallet; this statement is the record. Details and CSV: ${link}`,
      }).catch(() => ({ ok: false as const }));
      if (result.ok) sent = true;
    }
    if (sent) {
      sellerStore.markInvoiceEmailed(invoice.id);
      emailed += 1;
    }
  }
  return { generated, emailed };
}
