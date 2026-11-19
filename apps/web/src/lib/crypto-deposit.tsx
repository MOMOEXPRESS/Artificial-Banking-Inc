"use client";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { managedWalletReady, type ManagedWallet } from "./managed-wallet-client";

/** Receiving uses only the server-verified current asset binding. QR bytes never leave the browser. */
export function CryptoDeposit({
  data,
  busy,
  error,
  onAssetChange,
  onRefresh,
}: {
  data: ManagedWallet;
  busy: boolean;
  error: string;
  onAssetChange: (id: string) => void;
  onRefresh: () => void;
}) {
  const [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState("");
  const [testnets, setTestnets] = useState(data.asset.testnet);
  const assets = data.assets.filter((a) => testnets || !a.testnet);
  const symbols = [...new Set(assets.map((a) => a.symbol))];
  const networks = assets.filter((a) => a.symbol === data.asset.symbol);
  const verified = managedWalletReady(data) && !busy && !error;
  return (
    <div className="abi-deposit-flow">
      <div className="abi-deposit-choices">
        <label>
          Asset
          <Select
            value={data.asset.symbol}
            disabled={busy}
            onValueChange={(symbol) => {
              const next =
                assets.find((a) => a.symbol === symbol && a.chainId === data.asset.chainId) ??
                assets.find((a) => a.symbol === symbol);
              if (next) onAssetChange(next.id);
            }}
          >
            <SelectTrigger aria-label="Deposit asset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="abi-access-select">
              {symbols.map((symbol) => (
                <SelectItem key={symbol} value={symbol}>
                  {symbol === "ETH" ? "Ethereum (ETH)" : "USD Coin (USDC)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label>
          Network
          <Select value={data.selectedAssetId} disabled={busy} onValueChange={onAssetChange}>
            <SelectTrigger aria-label="Deposit network">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="abi-access-select">
              {networks.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.network}
                  {a.testnet ? " · Testnet" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <p className="abi-deposit-network-note">
        <ShieldCheck size={18} aria-hidden="true" />
        <span>
          Send only <strong>{data.asset.symbol}</strong> on <strong>{data.asset.network}</strong>.
          The network must match in your sending wallet.
          {data.asset.symbol === "USDC" && " Use native USDC, not USDC.e."}
        </span>
      </p>
      <div className="abi-deposit-destination" aria-busy={busy}>
        {verified ? (
          <>
            <div className="abi-deposit-qr">
              <QRCodeSVG
                value={data.address!}
                size={184}
                level="M"
                marginSize={4}
                title={`${data.asset.symbol} deposit address on ${data.asset.network}`}
              />
            </div>
            <div className="abi-deposit-address">
              <span>Deposit address</span>
              <code>{data.address}</code>
              <Button
                className="minimal-primary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(data.address!)
                    .then(() => {
                      setCopied(true);
                      setCopyError("");
                    })
                    .catch(() =>
                      setCopyError("Clipboard unavailable. Select and copy the address above."),
                    );
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                {copied ? "Address copied" : "Copy address"}
              </Button>
              <p>Scan the QR code or paste this address into your sending wallet.</p>
            </div>
          </>
        ) : (
          <p role="status" className="abi-deposit-verifying">
            {busy
              ? "Checking the receiving address…"
              : "A verified deposit address is not available. Refresh to check again before sending."}
          </p>
        )}
      </div>
      {copyError && <p role="alert">{copyError}</p>}
      {copied && verified && (
        <span role="status" className="sr-only">
          Address copied
        </span>
      )}
      <div className="abi-deposit-footer">
        <Button variant="ghost" disabled={busy} onClick={onRefresh}>
          <RefreshCw size={15} /> Refresh balance
        </Button>
        {verified && data.explorerAddress && (
          <a href={data.explorerAddress} target="_blank" rel="noreferrer">
            View on explorer <ExternalLink size={14} />
          </a>
        )}
      </div>
      <p className="abi-deposit-caption">
        Your account balance updates after the deposit is confirmed on-chain. Mainnet deposits and
        the testnet agent allowance remain separate.
      </p>
      <details className="abi-deposit-details">
        <summary>Deposit details</summary>
        <p>
          {data.accountSymbol
            ? "This address is dedicated to this asset. The same asset address can be used on the supported EVM networks; each network has a separate balance."
            : "ETH and USDC share this existing address. Each network has a separate balance."}
        </p>
        {data.asset.symbol === "USDC" && (
          <p>
            Later withdrawals need ETH for network fees at this USDC receiving address on the same
            network.
          </p>
        )}
        <p>
          Only the assets and networks listed here are supported. Bitcoin and other assets cannot be
          deposited through this address.
        </p>
        <label className="abi-deposit-testnet">
          <input
            type="checkbox"
            checked={testnets}
            disabled={busy}
            onChange={(e) => {
              const show = e.target.checked;
              setTestnets(show);
              if (!show && data.asset.testnet) {
                const next = data.assets.find((a) => !a.testnet && a.symbol === data.asset.symbol);
                if (next) onAssetChange(next.id);
              }
            }}
          />{" "}
          Show test networks
        </label>
      </details>
    </div>
  );
}
