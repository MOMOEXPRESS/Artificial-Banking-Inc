"use client";

import { ABMark } from "./brand";
import { Icon } from "./ui";
import { cardholderName } from "./vault-card-format";
import { cardIdentifier } from "./wallet-profile";

/**
 * Bank-card-style visual for the organization vault (Treasury → Vault).
 * Black/charcoal card with gray/silver text and the official ABI mark
 * (brand.tsx ABMark → /public/abi-mark-light.png, desaturated).
 * The card face carries a decorative identifier, NOT a blockchain address:
 * rendering the address in card-number groups made it unclear what to send
 * to (and copying it picked up spaces). The real receiving address is shown
 * in full, un-grouped, below the card with its network and chain id, and is
 * only present (and copyable) when the API verified it.
 */
export function VaultBankCard({
  address,
  assetSymbol,
  networkLabel,
  chainId,
  gasLine,
  simulated,
  orgName,
  copied,
  onCopy,
}: {
  /** Deposit address for the selected asset, or null when it has none. */
  address: string | null;
  assetSymbol: string;
  networkLabel: string;
  chainId?: number;
  gasLine?: { tone: "ok" | "warn" | "unknown"; text: string };
  simulated?: boolean;
  orgName?: string | null;
  copied: boolean;
  onCopy: () => void;
}) {
  const holder = cardholderName(orgName);
  const assetLine = `${assetSymbol} on ${networkLabel}`;
  return (
    <>
      <div
        className="vault-bank-card"
        role="group"
        aria-label={
          address
            ? `Organization vault card. ${assetLine} deposit address ${address}.`
            : `Organization vault card. No address for ${assetLine}.`
        }
      >
        <div className="vbc-top">
          <span className="vbc-brand">
            <span className="vbc-logo" aria-hidden>
              <ABMark size={22} tone="#fff" />
            </span>
            <span className="vbc-brand-name">ABI Vault</span>
          </span>
          <span className="vbc-asset" aria-hidden>
            {assetSymbol}
          </span>
        </div>

        <div className="vbc-number-row">
          <code className="vbc-number mono" title="Card identifier — not an address">
            {cardIdentifier(address)}
          </code>
        </div>

        <div className="vbc-bottom">
          <span className="vbc-field vbc-holder">
            <small>Cardholder</small>
            <b>{holder}</b>
          </span>
          <span className="vbc-field vbc-network-field">
            <small>Network</small>
            <b>{networkLabel}</b>
          </span>
        </div>
      </div>
      <div className="vault-receive" aria-label={`Receiving address for ${assetLine}`}>
        <small>
          Receiving address · {assetLine}
          {chainId ? ` (chain ${chainId})` : ""}
        </small>
        {address ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <code className="mono" style={{ wordBreak: "break-all", userSelect: "all" }}>
              {address}
            </code>
            <button
              type="button"
              className="vbc-copy"
              onClick={onCopy}
              aria-label={`Copy ${assetSymbol} receiving address`}
            >
              <Icon name="copy" size={13} />
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
        ) : (
          <code className="mono is-empty">
            No verified receiving address for this asset — do not send funds.
          </code>
        )}
        {gasLine ? (
          <small className={gasLine.tone === "warn" ? "warn" : "faint"}>Gas: {gasLine.text}</small>
        ) : null}
        {simulated ? (
          <small className="faint">
            Sandbox: balances shown above are simulated. Only funds sent to this address on{" "}
            {networkLabel} are real testnet money.
          </small>
        ) : null}
      </div>
    </>
  );
}
