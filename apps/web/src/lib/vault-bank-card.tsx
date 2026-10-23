"use client";

import { ABMark } from "./brand";
import { Icon } from "./ui";
import { cardholderName, cardNumberRows, groupVaultAddress } from "./vault-card-format";

/**
 * Bank-card-style visual for the organization vault (Treasury → Vault).
 * Black/charcoal card with gray/silver text, a gray EMV-style chip and the
 * official ABI mark (brand.tsx ABMark → /public/abi-mark-light.png, desaturated).
 * The vault address is the "card number"; there is no expiry, so it says so.
 */
export function VaultBankCard({
  address,
  orgName,
  networkLabel,
  modeLabel,
  copied,
  onCopy,
}: {
  address: string;
  orgName?: string | null;
  networkLabel: string;
  modeLabel: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const rows = cardNumberRows(groupVaultAddress(address));
  const holder = cardholderName(orgName);
  return (
    <div
      className="vault-bank-card"
      role="group"
      aria-label={
        address
          ? `Organization vault card. Vault address ${address}. ${networkLabel}.`
          : "Organization vault card. Vault address not configured."
      }
    >
      <div className="vbc-top">
        <span className="vbc-brand">
          <span className="vbc-logo" aria-hidden>
            <ABMark size={22} tone="#fff" />
          </span>
          <span className="vbc-brand-name">ABI Vault</span>
        </span>
        <span className="vbc-mode">{modeLabel}</span>
      </div>

      <div className="vbc-chip-row">
        <span className="vbc-chip" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="vbc-contactless" aria-hidden>
          <span />
          <span />
          <span />
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
          <code className="vbc-number mono is-empty">Vault address not configured</code>
        )}
        <button
          type="button"
          className="vbc-copy"
          disabled={!address}
          onClick={onCopy}
          aria-label="Copy vault address"
          title={copied ? "Copied" : "Copy vault address"}
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
        <span className="vbc-field vbc-expiry">
          <small>Valid thru</small>
          <b>No expiry</b>
        </span>
        <span className="vbc-network" aria-label={`Network: ${networkLabel}`}>
          {networkLabel}
        </span>
      </div>
    </div>
  );
}
