"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { relativeTime, shortTimestamp, type StripChip, type VaultStatus } from "./vault-status";

export type StripOnchain = {
  ok: boolean;
  error?: string;
  networkName?: string;
  chainId?: number;
  usdcContract?: string;
  explorerAddress?: string;
  onchainBalanceUsdc?: string;
  transfers?: {
    txHash: string;
    logIndex: number;
    blockNumber: string;
    from: string;
    amountUsdc: string;
    explorerUrl: string;
    status: "detected" | "credited";
  }[];
};

/**
 * Compact vault status strip: idle / processing / last processed, with the
 * critical network facts as inline chips. Replaces the old Base Sepolia
 * network/gas card; its technical details live behind "Details".
 */
export function VaultStatusStrip({
  status,
  chips,
  checking,
  disabled,
  onRefresh,
  usdc,
  onchain,
  ledgerLabel,
  ledgerBalance,
  expectedUsdc,
  onRescan,
}: {
  status: VaultStatus;
  chips: StripChip[];
  checking: boolean;
  disabled: boolean;
  onRefresh: () => void;
  /** USDC carries the on-chain details disclosure; other assets do not. */
  usdc: boolean;
  onchain: StripOnchain | null;
  ledgerLabel: string;
  ledgerBalance: string;
  expectedUsdc?: string;
  onRescan: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const last = status.last;
  const transfers = onchain?.transfers ?? [];

  return (
    <section
      className={`vault-status-strip is-${status.state}`}
      data-state={status.state}
      aria-label="Vault status"
    >
      <div className="vault-status-main">
        <span className="vault-status-dot" aria-hidden />
        <div className="vault-status-copy" role="status" aria-live="polite">
          <b className="vault-status-title">{status.title}</b>
          <span className="vault-status-detail" title={status.detail}>
            {status.detail}
          </span>
          {last ? (
            <span className="vault-status-time">
              {status.state === "processing" ? "Last: " : ""}
              <time dateTime={last.at} title={new Date(last.at).toLocaleString()}>
                {shortTimestamp(last.at)}
              </time>
              {relativeTime(last.at, now) ? ` · ${relativeTime(last.at, now)}` : ""}
              {last.explorerUrl ? (
                <>
                  {" · "}
                  <a href={last.explorerUrl} target="_blank" rel="noreferrer">
                    Tx
                  </a>
                </>
              ) : null}
            </span>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="vault-status-refresh"
          disabled={checking || disabled}
          onClick={onRefresh}
          aria-label="Refresh vault status"
        >
          {checking ? "Checking…" : "Refresh"}
        </Button>
      </div>

      {(chips.length > 0 || usdc) && (
        <div className="vault-status-meta">
          {chips.map((c) => (
            <span key={c.key} className={`vault-status-chip ${c.tone}`} title={c.title}>
              {c.text}
            </span>
          ))}
          {usdc && onchain?.explorerAddress ? (
            <a
              className="vault-status-link"
              href={onchain.explorerAddress}
              target="_blank"
              rel="noreferrer"
            >
              Basescan
            </a>
          ) : null}
          {usdc ? (
            <details className="vault-status-details">
              <summary>Details</summary>
              <div className="onchain-technical-grid">
                <span>Vault USDC on-chain</span>
                <b>{onchain?.ok ? `${onchain.onchainBalanceUsdc} USDC` : "—"}</b>
                <span>{ledgerLabel}</span>
                <b>{ledgerBalance}</b>
                <span>Network</span>
                <b>
                  {onchain?.networkName ?? "—"}
                  {onchain?.chainId ? ` · ${onchain.chainId}` : ""}
                </b>
                <span>USDC contract</span>
                <code>{onchain?.usdcContract ?? "—"}</code>
                <span>Records expect</span>
                <b>{expectedUsdc ?? "—"} USDC</b>
              </div>
              {transfers.length > 0 && (
                <div className="vault-status-deposits">
                  {transfers.slice(0, 6).map((t) => (
                    <div key={`${t.txHash}-${t.logIndex}`} className="wallet-tx-row">
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 12.5 }}>
                          +{t.amountUsdc} USDC{" "}
                          <span className={`pill ${t.status === "credited" ? "ok" : "warn"}`}>
                            <i /> {t.status}
                          </span>
                        </div>
                        <div className="faint" style={{ fontSize: 11, marginTop: 3 }}>
                          from {t.from.slice(0, 8)}…{t.from.slice(-4)} · block {t.blockNumber}
                        </div>
                      </div>
                      <a href={t.explorerUrl} target="_blank" rel="noreferrer">
                        Tx
                      </a>
                    </div>
                  ))}
                </div>
              )}
              <Button variant="ghost" size="sm" disabled={checking || disabled} onClick={onRescan}>
                Re-scan deposits
              </Button>
            </details>
          ) : null}
        </div>
      )}
    </section>
  );
}
