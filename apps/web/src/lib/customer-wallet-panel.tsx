"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Wallet,
  Globe2,
  RefreshCw,
  Copy,
  Check,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  ExternalLink,
} from "lucide-react";
import { Group as SelectGroup, Label as SelectLabel } from "@radix-ui/react-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { workspaceJson, type WorkspaceFetcher, type Workspace } from "./workspace-client";
import {
  parseManagedWallet,
  managedWalletReady,
  walletChanged,
  walletAmount,
  type ManagedWallet,
} from "./managed-wallet-client";
type Intent = "currencies" | "receive" | "send" | "allocate";
type Send = {
  id: string;
  amount: string;
  symbol: string;
  network: string;
  recipient: string;
  source: string;
  state: string;
  hash: string | null;
  explorerUrl: string | null;
  maxNetworkFeeEth: string;
  expiresAt: string;
  createdAt?: string;
};
export function CustomerWalletPanel({
  workspaceId,
  name,
  gFetch,
  open,
  onOpenChange,
  intent = "currencies",
  workspaces = [],
  sourceAccount,
  recoveryAssetId,
}: {
  workspaceId: string;
  name: string;
  gFetch: WorkspaceFetcher;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent?: Intent;
  workspaces?: Workspace[];
  sourceAccount?: "USDC" | "ETH";
  recoveryAssetId?: string;
}) {
  const [data, setData] = useState<ManagedWallet | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  const [showTestnets, setShowTestnets] = useState(false);
  const [activity, setActivity] = useState<Send[]>([]),
    [activityError, setActivityError] = useState("");
  const [amount, setAmount] = useState(""),
    [recipient, setRecipient] = useState(""),
    [to, setTo] = useState(""),
    [draft, setDraft] = useState<Send | null>(null),
    [factor, setFactor] = useState(false),
    [code, setCode] = useState("");
  const requestVersion = useRef(0);
  const active = useRef(true),
    path = `/v1/guardian/workspaces/${encodeURIComponent(workspaceId)}/wallet`;
  const load = useCallback(
    async (setup = false, background = false) => {
      const version = ++requestVersion.current;
      const options = recoveryAssetId ? { assetId: recoveryAssetId, sourceAccount } : {};
      const query = recoveryAssetId
        ? `?${new URLSearchParams({ assetId: recoveryAssetId, sourceAccount: sourceAccount! })}`
        : "";
      if (!background) {
        setBusy(true);
        setError("");
      }
      try {
        const value = parseManagedWallet(
          await workspaceJson(
            await gFetch(
              setup ? path : `${path}${query}`,
              setup ? { method: "POST", body: JSON.stringify(options) } : undefined,
            ),
          ),
        );
        if (value.workspaceId !== workspaceId)
          throw Error("The wallet response belongs to another workspace.");
        if (active.current && version === requestVersion.current) {
          setData(value);
          if (setup || background) walletChanged();
        }
        return value;
      } catch (e) {
        if (active.current && version === requestVersion.current && !background)
          setError((e as Error).message);
      } finally {
        if (active.current && version === requestVersion.current && !background) setBusy(false);
      }
    },
    [gFetch, path, workspaceId, recoveryAssetId, sourceAccount],
  );
  useEffect(() => {
    active.current = true;
    void load().then((value) => {
      if (active.current && value?.status === "setup_pending") void load(true).then(() => load());
    });
    return () => {
      active.current = false;
    };
  }, [load]);
  const changeAsset = useCallback(
    async (assetId: string) => {
      const version = ++requestVersion.current;
      setBusy(true);
      setError("");
      setCopied(false);
      setDraft(null);
      try {
        const value = parseManagedWallet(
          await workspaceJson(
            await gFetch(path, { method: "PATCH", body: JSON.stringify({ assetId }) }),
          ),
        );
        if (value.workspaceId !== workspaceId) throw Error("Wallet mismatch.");
        if (!active.current || version !== requestVersion.current) return;
        setData(value);
        walletChanged();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [gFetch, path, workspaceId],
  );
  useEffect(() => {
    if (open) {
      setCopied(false);
      setDraft(null);
      setError("");
      setFactor(false);
      setCode("");
      setAmount("");
      setRecipient("");
      setShowTestnets(false);
      void load().then((value) => {
        if (!active.current) return;
        // Add money always starts on a real network, even after a faucet check.
        if (!recoveryAssetId && intent === "receive" && value?.asset.testnet) {
          const mainnet = value.assets.find((a) => !a.testnet && a.symbol === value.asset.symbol);
          if (mainnet) void changeAsset(mainnet.id);
        } else if (value?.asset.testnet) {
          setShowTestnets(true);
        }
      });
    }
  }, [open, intent, load, changeAsset, recoveryAssetId]);
  const recovery =
    recoveryAssetId && sourceAccount
      ? { assetId: recoveryAssetId, accountSymbol: sourceAccount }
      : undefined;
  const ready = managedWalletReady(data, recovery);
  useEffect(() => {
    if (!open || !ready || busy || draft) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(false, true);
    }, 25000);
    return () => clearInterval(timer);
  }, [open, ready, busy, data, load, draft]);
  const visibleAssets =
    data?.assets.filter((a) => showTestnets || !a.testnet || a.id === data.selectedAssetId) ?? [];
  const networks = [...new Set(visibleAssets.map((a) => a.chainId))];
  useEffect(() => {
    if (!ready) return;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const value = await workspaceJson(await gFetch(`${path}/sends`));
        if (!active) return;
        setActivity(value.sends);
        setActivityError("");
        if (value.sends.some((s: Send) => s.state === "submitted" || s.state === "submitting"))
          timer = setTimeout(() => void refresh(), 15000);
      } catch {
        if (active)
          setActivityError(
            "Transfer status could not be refreshed. Pending transfers remain pending.",
          );
      }
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [gFetch, path, ready, draft?.state]);
  const sending = intent === "send" || intent === "allocate";
  async function submit() {
    if (!data || busy || !managedWalletReady(data, recovery)) return;
    setBusy(true);
    setError("");
    try {
      const response = await gFetch(draft ? `${path}/sends/${draft.id}/confirm` : `${path}/sends`, {
        method: "POST",
        body: JSON.stringify(
          draft
            ? { ...(code ? { code } : {}) }
            : {
                assetId: data.selectedAssetId,
                ...(sourceAccount ? { sourceAccount } : {}),
                amount,
                ...(intent === "allocate" ? { toWorkspaceId: to } : { recipient }),
              },
        ),
      });
      const body = await response.json();
      if (!response.ok) {
        if (body.error?.code === "MFA_REQUIRED" || body.error?.code === "MFA_INVALID")
          setFactor(true);
        throw Error(
          body.error?.message ??
            "The transfer could not be prepared. Retry after checking the balance and network.",
        );
      }
      setDraft(body as Send);
      if ((body as Send).state !== "prepared") {
        await load();
        walletChanged();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const destinations = workspaces.filter(
    (w) => w.id !== workspaceId && w.wallet?.status === "ready",
  );
  return (
    <section className="minimal-section abi-mainnet-wallet" aria-busy={busy}>
      <div className="minimal-section-heading">
        <h2>
          <Wallet size={21} aria-hidden="true" />
          {recoveryAssetId ? "Asset recovery" : "On-chain wallet"}
        </h2>
        {!recoveryAssetId && (
          <Button variant="ghost" onClick={() => onOpenChange(true)}>
            <Globe2 size={16} /> Currencies
          </Button>
        )}
      </div>
      <p>
        {ready && data
          ? `${data.asset.symbol} on ${data.asset.network} · ${walletAmount(data)} ${data.asset.symbol}`
          : "Setting up this workspace’s Privy wallet."}
      </p>
      <p className="abi-workspace-note">
        ABI manages this wallet through your account. Google or GitHub sign-in is optional.
      </p>
      {!ready && !(recoveryAssetId && data && !data.accountSymbol) && (
        <Button variant="ghost" disabled={busy} onClick={() => void load(true).then(() => load())}>
          <RefreshCw size={15} />
          {busy ? "Setting up wallet…" : "Retry wallet setup"}
        </Button>
      )}
      {error && !open && <p role="alert">{error}</p>}
      {activity.length > 0 && (
        <div className="abi-wallet-transfers">
          <h3>Recent on-chain transfers</h3>
          <ul>
            {activity.map((t) => (
              <li key={t.id}>
                <div>
                  <strong>
                    {t.amount} {t.symbol}
                  </strong>
                  <small>{t.network}</small>
                </div>
                <span>{t.state}</span>
                {t.explorerUrl ? (
                  <a href={t.explorerUrl} target="_blank" rel="noreferrer">
                    Track <ExternalLink size={13} />
                  </a>
                ) : (
                  <small>{t.state === "unknown" ? "Contact support with " + t.id : ""}</small>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {activityError && <p role="status">{activityError}</p>}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) onOpenChange(v);
        }}
      >
        <DialogContent className="reference-dialog abi-workspace-dialog abi-wallet-action-dialog abi-currency-dialog">
          <span className="abi-dialog-symbol" aria-hidden="true">
            {intent === "receive" ? (
              <ArrowDownLeft size={22} />
            ) : intent === "allocate" ? (
              <ArrowRightLeft size={22} />
            ) : intent === "send" ? (
              <ArrowUpRight size={22} />
            ) : (
              <Globe2 size={22} />
            )}
          </span>
          <DialogTitle>
            {sending
              ? draft
                ? draft.state === "prepared"
                  ? "Review transfer"
                  : "Transfer status"
                : intent === "allocate"
                  ? "Allocate between wallets"
                  : `Send from ${name}`
              : intent === "receive"
                ? `Add money to ${name}`
                : `${name} · currencies`}
          </DialogTitle>
          <DialogDescription>
            {sending
              ? "Transfers move funds on-chain. Check the currency, network and destination before confirming."
              : "Choose an asset under the network you will send it on. Funds go directly to this workspace wallet."}
          </DialogDescription>
          {data && (
            <>
              <label>
                Assets
                <Select
                  value={data.selectedAssetId}
                  disabled={busy || !!draft || !!recoveryAssetId}
                  onValueChange={(id) => void changeAsset(id)}
                >
                  <SelectTrigger aria-label="Asset and network">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="abi-access-select">
                    {networks.map((chainId) => {
                      const assets = visibleAssets.filter((a) => a.chainId === chainId);
                      const network = assets[0]!;
                      return (
                        <SelectGroup key={chainId}>
                          <SelectLabel className="abi-asset-network-heading">
                            {network.network} {network.testnet ? "Testnet" : "Mainnet"}
                          </SelectLabel>
                          {assets.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.symbol} · {a.network}
                              {a.testnet ? " Testnet" : " Mainnet"}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      );
                    })}
                  </SelectContent>
                </Select>
              </label>
              {!draft && !recoveryAssetId && (
                <label className="abi-funding-testnets">
                  <input
                    type="checkbox"
                    checked={showTestnets}
                    disabled={busy}
                    onChange={(event) => {
                      const show = event.target.checked;
                      setShowTestnets(show);
                      if (!show && data.asset.testnet) {
                        const asset = data.assets.find(
                          (a) => !a.testnet && a.symbol === data.asset.symbol,
                        );
                        if (asset) void changeAsset(asset.id);
                      }
                    }}
                  />{" "}
                  Show test networks (faucets only)
                </label>
              )}
              <div className="abi-receive-network">
                <Wallet size={22} aria-hidden="true" />
                <div>
                  <strong>
                    {data.asset.symbol} on {data.asset.network}
                  </strong>
                  <span>
                    {data.asset.testnet ? "Testnet · no monetary value" : "Mainnet"} · Chain{" "}
                    {data.asset.chainId}
                  </span>
                </div>
                <strong className="abi-currency-balance">
                  {walletAmount(data)} <small>{data.asset.symbol}</small>
                </strong>
              </div>
              {data.balanceError && <p role="status">{data.balanceError}</p>}
              {ready && !sending && (
                <>
                  <div className="abi-receive-address">
                    <span>
                      Receiving address · {data.asset.symbol} · {name}
                    </span>
                    <code>{data.address}</code>
                  </div>
                  <Button
                    className="abi-receive-copy"
                    disabled={busy}
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(data.address!)
                        .then(() => setCopied(true))
                        .catch(() =>
                          setError("Clipboard unavailable. Select and copy the address manually."),
                        )
                    }
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                    {copied ? "Address copied" : "Copy address"}
                  </Button>
                  <p className="abi-receive-instruction">
                    Deposit {data.asset.symbol} on {data.asset.network}.{" "}
                    {data.asset.testnet
                      ? "Use a faucet for this test network."
                      : "Use the exact network above when sending funds."}
                  </p>
                  <p className="abi-workspace-note">
                    {data.accountSymbol
                      ? "Each asset has its own receiving address in this workspace. The same asset address works across the supported EVM networks; each network has a separate balance."
                      : "This wallet currently uses one shared ETH and USDC address. Each network has a separate balance. Separate asset addresses are not available here yet."}
                    {data.asset.symbol === "USDC" &&
                      " Use native USDC, not bridged USDC or USDC.e."}{" "}
                    Bitcoin and other assets are not supported by this deposit route.
                    {data.asset.symbol === "USDC" &&
                      (data.accountSymbol
                        ? " To send USDC later, this USDC address also needs ETH on the same network for fees. Your separate ETH address does not pay those fees."
                        : " To send USDC later, this receiving address also needs ETH on the same network for fees.")}
                  </p>
                  <p role="status" className="abi-workspace-note">
                    {data.balance.observedAt
                      ? `Balance checked ${new Date(data.balance.observedAt).toLocaleTimeString()}. `
                      : ""}
                    Balances refresh while this window is open. Mainnet deposits do not fund the
                    testnet agent allowance.
                  </p>
                  <div className="abi-wallet-dialog-footer">
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void load().then(() => walletChanged())}
                    >
                      <RefreshCw size={15} /> Refresh balance
                    </Button>
                    {data.explorerAddress && (
                      <a href={data.explorerAddress} target="_blank" rel="noreferrer">
                        View on explorer <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                </>
              )}
              {ready && sending && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  <p className="abi-workspace-note">
                    {data.accountSymbol
                      ? `Sending from the ${sourceAccount ?? draft?.symbol ?? data.accountSymbol} asset wallet`
                      : "Sending from the workspace wallet"}
                    : <code>{draft?.source ?? data.address}</code>.
                    {sourceAccount &&
                      " Recovery transfers use this address, even when the asset differs from the account label."}
                  </p>
                  {!draft ? (
                    <>
                      {intent === "allocate" ? (
                        <label>
                          To workspace
                          <Select value={to} onValueChange={setTo} disabled={busy}>
                            <SelectTrigger aria-label="Destination wallet">
                              <SelectValue placeholder="Choose a wallet" />
                            </SelectTrigger>
                            <SelectContent className="abi-access-select">
                              {destinations.map((w) => (
                                <SelectItem key={w.id} value={w.id}>
                                  {w.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {!destinations.length && (
                            <small>Open another workspace to finish its wallet setup first.</small>
                          )}
                        </label>
                      ) : (
                        <label>
                          Receiving address
                          <input
                            required
                            placeholder="0x…"
                            value={recipient}
                            onChange={(e) => setRecipient(e.target.value)}
                            maxLength={42}
                          />
                        </label>
                      )}
                      <label>
                        Amount in {data.asset.symbol}
                        <input
                          required
                          inputMode="decimal"
                          placeholder="0.00"
                          pattern="[0-9]+(\.[0-9]{1,18})?"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                        />
                      </label>
                      <p className="abi-workspace-note">
                        ETH on {data.asset.network} at this sending address covers the network fee.
                        {data.accountSymbol &&
                          "ETH in your separate ETH asset wallet does not cover another address’s fees."}
                        A fee estimate appears before you confirm.
                      </p>
                    </>
                  ) : (
                    <>
                      <dl className="abi-send-review">
                        <div>
                          <dt>From</dt>
                          <dd>
                            <code>{draft.source}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Amount</dt>
                          <dd>
                            {draft.amount} {draft.symbol}
                          </dd>
                        </div>
                        <div>
                          <dt>Network</dt>
                          <dd>{draft.network}</dd>
                        </div>
                        <div>
                          <dt>To</dt>
                          <dd>
                            <code>{draft.recipient}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Execution fee estimate</dt>
                          <dd>{draft.maxNetworkFeeEth} ETH</dd>
                        </div>
                        <div>
                          <dt>Status</dt>
                          <dd>{draft.state}</dd>
                        </div>
                      </dl>
                      {draft.network.startsWith("Base") && (
                        <p className="abi-workspace-note">
                          Base also charges an L1 data fee, which is not included in this
                          execution-fee estimate. Keep extra ETH for gas.
                        </p>
                      )}
                      {draft.state === "prepared" && factor && (
                        <label>
                          Authenticator or recovery code
                          <input
                            autoComplete="one-time-code"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                          />
                          <small>Your enabled security factor protects this withdrawal.</small>
                        </label>
                      )}
                      {draft.explorerUrl && (
                        <a href={draft.explorerUrl} target="_blank" rel="noreferrer">
                          Track transaction <ExternalLink size={14} />
                        </a>
                      )}
                      {draft.state === "submitted" && (
                        <p role="status">
                          Submitted to the network. This is pending, not a confirmed transfer.
                        </p>
                      )}
                    </>
                  )}
                  {(!draft || draft.state === "prepared") && (
                    <div className="abi-wallet-dialog-footer">
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={busy}
                        onClick={() => (draft ? setDraft(null) : onOpenChange(false))}
                      >
                        {draft ? "Edit transfer" : "Cancel"}
                      </Button>
                      <Button
                        disabled={
                          busy ||
                          (!draft && (!amount || (intent === "allocate" ? !to : !recipient)))
                        }
                        type="submit"
                      >
                        {busy ? "Checking…" : draft ? "Confirm transfer" : "Review transfer"}
                      </Button>
                    </div>
                  )}
                </form>
              )}
            </>
          )}
          {!ready && (
            <p role="status">
              {busy
                ? "Preparing and verifying this workspace wallet…"
                : recoveryAssetId && data && !data.accountSymbol
                  ? "Asset recovery is not available here yet. Your funds remain at their current address."
                  : "A verified receiving address is not available yet. Close and retry wallet setup."}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {copied && (
            <span role="status" className="sr-only">
              Address copied
            </span>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
/** Backfill real owner workspaces after sign-in, without blocking authentication. */
export function AutomaticCustomerWallet({
  workspaceId,
  gFetch,
}: {
  workspaceId: string;
  gFetch: WorkspaceFetcher;
}) {
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await workspaceJson(await gFetch("/v1/account/workspaces"));
      const all = result.workspaces as Workspace[],
        orgId = all.find((w) => w.id === workspaceId)?.orgId;
      const workspaces = all
        .filter(
          (w) =>
            w.role === "owner" &&
            w.orgId === orgId &&
            (w.id === workspaceId || w.wallet?.status !== "ready"),
        )
        .sort((a, b) => Number(b.id === workspaceId) - Number(a.id === workspaceId))
        .slice(0, 3);
      for (const w of workspaces) {
        if (!active) return;
        setNotice(`Preparing ${w.name} wallet…`);
        const endpoint = `/v1/guardian/workspaces/${encodeURIComponent(w.id)}/wallet`;
        const response = await gFetch(
          endpoint,
          w.wallet?.status === "ready" ? undefined : { method: "POST", body: "{}" },
        );
        if (!response.ok) continue;
        const value = parseManagedWallet(await response.json());
        if (value.workspaceId !== w.id) throw Error();
        if (w.wallet?.status !== "ready") await gFetch(endpoint);
      }
      if (active) {
        setNotice("");
        walletChanged();
      }
    })().catch(() => {
      if (active) setNotice("Wallet setup will retry when you open Wallet.");
    });
    return () => {
      active = false;
    };
  }, [workspaceId, gFetch]);
  return notice ? (
    <p role="status" className="abi-workspace-note">
      {notice}
    </p>
  ) : null;
}
