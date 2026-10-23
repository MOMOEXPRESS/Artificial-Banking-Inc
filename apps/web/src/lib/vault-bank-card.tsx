"use client";

import { ABMark } from "./brand";
import { Icon } from "./ui";
import { cardholderName, cardNumberRows, groupVaultAddress } from "./vault-card-format";

/**
 * Bank-card-style visual for the organization vault (Treasury → Vault).
 * Black/charcoal card with gray/silver text and the official ABI mark
 * (brand.tsx ABMark → /public/abi-mark-light.png, desaturated).
 * The "card number" is the deposit address of the asset selected in the
 * vault asset picker; assets without one show an explicit empty state.
 */
export function VaultBankCard({
  address,
  assetSymbol,
  networkLabel,
  orgName,
  copied,
  onCopy,
}: {
  /** Deposit address for the selected asset, or null when it has none. */
  address: string | null;
  assetSymbol: string;
  networkLabel: string;
  orgName?: string | null;
  copied: boolean;
  onCopy: () => void;
}) {
  const rows = address ? cardNumberRows(groupVaultAddress(address)) : [];
  const holder = cardholderName(orgName);
  const assetLine = `${assetSymbol} on ${networkLabel}`;
  return (
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
        {address ? (
          <code className="vbc-number mono" title={address}>
            {rows.map((row, r) => (
              <span className="vbc-number-line" key={r}>
                {row.map((g, i) => (
                  <span key={i}>{g}</span>
                ))}
              </span>
            ))}
          </code>
        ) : (
          <code className="vbc-number mono is-empty">No address for this asset</code>
        )}
        <button
          type="button"
          className="vbc-copy"
          disabled={!address}
          onClick={onCopy}
          aria-label={address ? `Copy ${assetSymbol} deposit address` : "No address to copy"}
          title={copied ? "Copied" : address ? "Copy address" : "No address for this asset"}
        >
          <Icon name="copy" size={13} />
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
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
  );
}
