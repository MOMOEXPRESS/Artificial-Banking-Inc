"use client";
import { useCallback, useEffect, useState } from "react";
import { Wallet, ShieldCheck, RefreshCw, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { workspaceJson, type WorkspaceFetcher } from "./workspace-client";
type Trial = {
  provider: "privy";
  network: "base-sepolia";
  control: "application-controlled-test";
  spendingEnabled: false;
  configured: boolean;
  available: boolean;
  wallet: {
    address: string | null;
    providerWalletId: string | null;
    status: string;
    verifiedAt: string | null;
  } | null;
};
function validated(value: Trial): Trial {
  if (
    value?.provider !== "privy" ||
    value.network !== "base-sepolia" ||
    value.control !== "application-controlled-test" ||
    value.spendingEnabled !== false ||
    typeof value.configured !== "boolean" ||
    typeof value.available !== "boolean" ||
    (value.wallet?.address && !/^0x[a-fA-F0-9]{40}$/.test(value.wallet.address))
  )
    throw Error("The wallet connection could not be confirmed. Refresh to try again.");
  return value;
}
export function PrivyTrialPanel({
  workspaceId,
  gFetch,
}: {
  workspaceId: string;
  gFetch: WorkspaceFetcher;
}) {
  const [data, setData] = useState<Trial | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [hidden, setHidden] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const path = `/v1/guardian/workspaces/${encodeURIComponent(workspaceId)}/privy`;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await gFetch(path);
      if (r.status === 403) {
        setHidden(true);
        return;
      }
      setData(validated(await workspaceJson(r)));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [gFetch, path]);
  useEffect(() => {
    void load();
  }, [load]);
  async function run(verify: boolean) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = validated(
        await workspaceJson(
          await gFetch(path + (verify ? "/verify" : ""), {
            method: "POST",
            body: JSON.stringify(verify ? {} : { acknowledgeTestOnly: true }),
          }),
        ),
      );
      setData(result);
      setNotice(
        verify
          ? "Signing connection verified. No payment was made."
          : "Your test wallet is ready. Verify its signing connection next.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (hidden) return null;
  return (
    <section className="minimal-section abi-privy-trial" aria-busy={loading || busy}>
      <div className="minimal-section-heading">
        <h2>
          <Wallet size={21} aria-hidden="true" />
          Privy test wallet
        </h2>
        <span>Base Sepolia</span>
      </div>
      <p>
        A separate wallet for testing the provider connection. ABI controls this trial wallet; your
        existing funds and agent spending stay unchanged. Use test tokens only.
      </p>
      {loading ? (
        <p role="status">Checking the wallet connection…</p>
      ) : data?.wallet?.address ? (
        <>
          <div className="abi-privy-address">
            <code>{data.wallet.address}</code>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Copy test wallet address"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(data.wallet!.address!);
                  setNotice("Test wallet address copied.");
                } catch {
                  setError("Copy was unavailable. Select the address to copy it.");
                }
              }}
            >
              <Copy size={16} />
            </Button>
          </div>
          <p>
            {data.wallet.verifiedAt
              ? `Last verified ${new Date(data.wallet.verifiedAt).toLocaleString()}`
              : "Signing connection has not been verified yet."}
          </p>
        </>
      ) : (
        <p>
          {data?.configured
            ? "Create this workspace’s test wallet, then verify a non-payment signature."
            : "The Privy trial is awaiting provider configuration."}
        </p>
      )}
      <div className="abi-workspace-actions">
        <Button
          disabled={loading || busy || !data?.configured || !data.available}
          onClick={() => void run(Boolean(data?.wallet?.address))}
        >
          {data?.wallet?.address ? <ShieldCheck size={16} /> : <Wallet size={16} />}{" "}
          {busy
            ? "Connecting…"
            : data?.wallet?.address
              ? "Verify signing connection"
              : "Create test wallet"}
        </Button>
        <Button variant="ghost" disabled={loading || busy} onClick={() => void load()}>
          <RefreshCw size={16} />
          Refresh connection
        </Button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
