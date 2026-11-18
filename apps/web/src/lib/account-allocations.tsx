"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { workspaceJson, type Workspace, type WorkspaceFetcher } from "./workspace-client";
export type Treasury = {
  activityAvailable: boolean;
  activityFromBlock: string;
  activityToBlock: string;
  activity: {
    hash: string;
    direction: string;
    amountUsdc: string;
    block: string;
    counterparty: string;
  }[];
  network: string;
  confirmedUsdc: string;
  allocatedUsdc: string;
  unallocatedUsdc: string;
  pendingTransfer: boolean;
  reconciliationRequired: boolean;
  allocations: { workspaceId: string; name: string; amountUsdc: string }[];
  events: {
    id: string;
    workspaceId: string;
    amountMicro: string;
    direction: string;
    createdAt: string;
  }[];
};
export function AccountAllocations({
  workspaces,
  gFetch,
}: {
  workspaces: Workspace[];
  gFetch: WorkspaceFetcher;
}) {
  const inFlight = useRef(false);
  const [assetId, setAssetId] = useState("base:usdc"),
    [data, setData] = useState<Treasury | null>(null),
    [target, setTarget] = useState(""),
    [amount, setAmount] = useState(""),
    [direction, setDirection] = useState<"allocate" | "return">("allocate"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState<{ fingerprint: string; key: string } | null>(null);
  const load = useCallback(async () => {
    setError("");
    setData(null);
    setData(
      await workspaceJson(
        await gFetch(`/v1/guardian/account/treasury?assetId=${encodeURIComponent(assetId)}`),
      ),
    );
  }, [gFetch, assetId]);
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    void gFetch(`/v1/guardian/account/treasury?assetId=${encodeURIComponent(assetId)}`)
      .then(workspaceJson)
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [gFetch, assetId]);
  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const fingerprint = JSON.stringify({ assetId, target, amount, direction }),
      key = attempt?.fingerprint === fingerprint ? attempt.key : crypto.randomUUID();
    setAttempt({ fingerprint, key });
    try {
      await workspaceJson(
        await gFetch("/v1/guardian/account/treasury/allocations", {
          method: "POST",
          body: JSON.stringify({
            assetId,
            workspaceId: target,
            amountUsdc: amount,
            direction,
            idempotencyKey: key,
          }),
        }),
      );
      setAmount("");
      setAttempt(null);
      setNotice(
        direction === "allocate"
          ? "USDC allocated inside the account. No blockchain transfer or conversion occurred."
          : "Allocation returned to the account. No blockchain transfer occurred.",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="abi-account-allocations">
      <h3>Workspace allocations · mainnet USDC</h3>
      <p>
        Funds remain at the account address. Allocations reserve a workspace’s share without
        creating another wallet or paying network fees. Mainnet agent purchases are not enabled;
        allocated funds do not increase the separate testnet allowance.
      </p>
      <div className="minimal-actions">
        <label>
          Network
          <select
            value={assetId}
            disabled={busy}
            onChange={(e) => {
              setAssetId(e.target.value);
              setNotice("");
            }}
          >
            <option value="base:usdc">Base · USDC</option>
            <option value="ethereum:usdc">Ethereum · USDC</option>
          </select>
        </label>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          Refresh treasury
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!data && !error && <p role="status">Checking confirmed treasury funds…</p>}
      {data && (
        <>
          <dl className="abi-pool-balances">
            <div>
              <dt>Confirmed on-chain</dt>
              <dd>{data.confirmedUsdc} USDC</dd>
            </div>
            <div>
              <dt>Allocated</dt>
              <dd>{data.allocatedUsdc} USDC</dd>
            </div>
            <div>
              <dt>Unallocated</dt>
              <dd>{data.unallocatedUsdc} USDC</dd>
            </div>
          </dl>
          {data.reconciliationRequired && (
            <p role="alert">Balance reconciliation is required. Allocation changes are blocked.</p>
          )}
          {data.pendingTransfer && (
            <p role="status">
              A transfer is prepared or pending. Allocation changes wait until it is resolved or the
              review expires.
            </p>
          )}
          <form
            className="abi-treasury-allocation"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label>
              Workspace
              <select
                required
                disabled={busy}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Choose workspace</option>
                {workspaces
                  .filter((w) => !w.isDefault)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              USDC
              <input
                required
                inputMode="decimal"
                pattern="[0-9]+(\.[0-9]{1,6})?"
                value={amount}
                disabled={busy}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              Action
              <select
                value={direction}
                disabled={busy}
                onChange={(e) => setDirection(e.target.value as "allocate" | "return")}
              >
                <option value="allocate">Allocate to workspace</option>
                <option value="return">Return to account</option>
              </select>
            </label>
            <Button
              disabled={busy || !target || data.reconciliationRequired || data.pendingTransfer}
              type="submit"
            >
              {busy ? "Saving…" : "Confirm allocation"}
            </Button>
          </form>
          <div className="abi-vendor-rows">
            {data.allocations.map((a) => (
              <article key={a.workspaceId}>
                <strong>{a.name}</strong>
                <span>{a.amountUsdc} USDC allocated</span>
              </article>
            ))}
          </div>
          <details>
            <summary>USDC deposits & withdrawals</summary>
            <p className="minimal-note">
              Confirmed token transfers, blocks {data.activityFromBlock}–{data.activityToBlock} on
              this scan. Internal allocations are listed separately. Earlier deposits may be outside
              the scan range.
            </p>
            {!data.activityAvailable && (
              <p role="status">
                The latest on-chain history scan is unavailable. Previously observed transfers may
                still be shown.
              </p>
            )}
            {data.activity.map((entry, index) => (
              <p key={`${entry.hash}:${index}`}>
                {entry.direction} · {entry.amountUsdc} USDC · Block {entry.block} ·{" "}
                <a
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`${assetId.startsWith("base:") ? "https://basescan.org" : "https://etherscan.io"}/tx/${entry.hash}`}
                >
                  View transaction
                </a>
              </p>
            ))}
            {data.activityAvailable && !data.activity.length && (
              <p>No token transfers found in this scan range.</p>
            )}
          </details>
          <details>
            <summary>Allocation history</summary>
            {data.events.map((e) => (
              <p key={e.id}>
                {new Date(e.createdAt).toLocaleString()} · {e.direction} · {format(e.amountMicro)}{" "}
                USDC · {workspaces.find((w) => w.id === e.workspaceId)?.name ?? e.workspaceId}
              </p>
            ))}
            {!data.events.length && <p>No allocations on this network yet.</p>}
          </details>
        </>
      )}
    </div>
  );
}
function format(v: string) {
  const n = BigInt(v);
  return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "") || "00"}`;
}
