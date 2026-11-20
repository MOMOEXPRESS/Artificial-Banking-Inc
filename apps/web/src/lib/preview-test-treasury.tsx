"use client";
import { useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { ArrowDownToLine, ArrowRight, ArrowRightLeft, Check, Wallet } from "lucide-react";
import "./treasury-funding.css";
import { AllocationSelect } from "./allocation-select";
import { CryptoDeposit } from "./crypto-deposit";
import { workspaceJson, type Workspace, type WorkspaceFetcher } from "./workspace-client";
export const previewTreasurySchema = z.object({
  preview: z.literal(true),
  address: z.string().regex(/^0x[\da-fA-F]{40}$/),
  provider: z.string(),
  chainId: z.literal(84532),
  network: z.literal("Base Sepolia"),
  availableUsdc: z.string().regex(/^[0-9]+([.][0-9]{1,6})?$/),
  explorerAddress: z.string().url(),
  asset: z.object({
    id: z.literal("base-sepolia:usdc"),
    symbol: z.literal("USDC"),
    network: z.literal("Base Sepolia"),
    chainId: z.literal(84532),
    testnet: z.literal(true),
  }),
});
export type PreviewTreasuryProfile = z.infer<typeof previewTreasurySchema>;
export function PreviewTestTreasury({
  profile,
  workspaces,
  gFetch,
  onChanged,
  onRefresh,
}: {
  profile: PreviewTreasuryProfile;
  workspaces: Workspace[];
  gFetch: WorkspaceFetcher;
  onChanged: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [review, setReview] = useState(false),
    [source, setSource] = useState(workspaces.find((w) => w.isDefault)?.id ?? ""),
    [target, setTarget] = useState(""),
    [amount, setAmount] = useState(""),
    [busy, setBusy] = useState(false),
    [syncing, setSyncing] = useState(false),
    [depositError, setDepositError] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const inFlight = useRef(false),
    attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  async function sync() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setSyncing(true);
    setDepositError("");
    try {
      const result = await workspaceJson(
        await gFetch("/v1/guardian/treasury/onchain/sync", { method: "POST", body: "{}" }),
      );
      await onChanged();
      await onRefresh();
      setNotice(
        result.creditedCount
          ? `${result.creditedCount} confirmed deposit(s) credited.`
          : "No new confirmed deposits. The existing ledger balance is unchanged.",
      );
    } catch (e) {
      setDepositError((e as Error).message);
    } finally {
      setBusy(false);
      setSyncing(false);
      inFlight.current = false;
    }
  }
  async function allocate() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const fingerprint = JSON.stringify({ source, target, amount });
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const result = await workspaceJson(
        await gFetch(`/v1/guardian/workspaces/${source}/allocations`, {
          method: "POST",
          body: JSON.stringify({
            toWorkspaceId: target,
            amountUsdc: amount,
            idempotencyKey: attempt.current!.key,
          }),
        }),
      );
      await onChanged();
      await onRefresh();
      setNotice(
        result.allocation.status === "pending"
          ? "Allocation awaiting approval. Funds have not moved."
          : "Test funds allocated. No on-chain transfer occurred.",
      );
      setReview(false);
      setAmount("");
      attempt.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  const view = {
    status: "ready" as const,
    address: profile.address,
    receiveEnabled: true,
    selectedAssetId: profile.asset.id,
    asset: profile.asset,
    assets: [profile.asset],
    explorerAddress: profile.explorerAddress,
  };
  const sourceWorkspace = workspaces.find((w) => w.id === source);
  const sourceAvailable = sourceWorkspace?.isDefault
    ? profile.availableUsdc
    : (sourceWorkspace?.balance.availableUsdc ?? "0");
  const labelFor = (id: string) =>
    workspaces.find((w) => w.id === id)?.isDefault
      ? "Account treasury"
      : (workspaces.find((w) => w.id === id)?.name ?? "Workspace");
  const balancesKnown = workspaces.every(
    (w) =>
      /^[0-9]+([.][0-9]{1,6})?$/.test(w.balance.availableUsdc) &&
      /^[0-9]+([.][0-9]{1,6})?$/.test(w.balance.heldUsdc),
  );
  const allocated = workspaces
    .filter((w) => !w.isDefault)
    .reduce((sum, w) => sum + micro(w.balance.availableUsdc) + micro(w.balance.heldUsdc), 0n);
  const held = workspaces.reduce((sum, w) => sum + micro(w.balance.heldUsdc), 0n);
  return (
    <section className="abi-funding" aria-label="Account treasury">
      <header className="abi-treasury-summary">
        <div className="abi-treasury-title">
          <span className="abi-funding-symbol">
            <Wallet size={22} />
          </span>
          <div>
            <h2>Account treasury</h2>
            <p>Base Sepolia · Test USDC</p>
          </div>
        </div>
        <div className="abi-treasury-balance">
          <span>Available to allocate</span>
          <strong>
            {display(micro(profile.availableUsdc))}
            <small>USDC</small>
          </strong>
        </div>
        <dl className="abi-treasury-breakdown">
          <div>
            <dt>Allocated to workspaces</dt>
            <dd>{balancesKnown ? `${display(allocated)} USDC` : "Unavailable"}</dd>
          </div>
          <div>
            <dt>Reserved across account</dt>
            <dd>{balancesKnown ? `${display(held)} USDC` : "Unavailable"}</dd>
          </div>
        </dl>
        <p className="minimal-note">
          One account treasury. Each workspace spends only its allocated funds, within its limits
          and approvals.
        </p>
      </header>
      <div className="abi-funding-columns">
        <section className="abi-funding-receive" aria-labelledby="treasury-deposit-title">
          <header className="abi-funding-heading">
            <ArrowDownToLine size={20} />
            <div>
              <h3 id="treasury-deposit-title">Top up with crypto</h3>
              <p>Send test USDC directly to your account.</p>
            </div>
          </header>
          <CryptoDeposit
            data={view}
            busy={syncing}
            error={depositError}
            onAssetChange={() => {}}
            onRefresh={() => void sync()}
          />
          <a
            className="abi-funding-faucet"
            href="https://faucet.circle.com/"
            target="_blank"
            rel="noreferrer"
          >
            Get Base Sepolia test USDC <ArrowRight size={15} />
          </a>
        </section>
        <section className="abi-funding-allocate" aria-labelledby="treasury-allocate-title">
          <header className="abi-funding-heading">
            <ArrowRightLeft size={20} />
            <div>
              <h3 id="treasury-allocate-title">Allocate funds</h3>
              <p>Move spending capacity between your treasury and workspaces.</p>
            </div>
          </header>
          <form
            className="abi-allocation-composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (micro(amount) <= 0n) return;
              if (!review) setReview(true);
              else void allocate();
            }}
          >
            <div className="abi-allocation-route">
              <AllocationSelect
                label="From"
                value={source}
                onChange={(id) => {
                  setSource(id);
                  if (id === target) setTarget("");
                  setReview(false);
                }}
                disabled={busy}
                options={workspaces.map((w) => ({ value: w.id, label: labelFor(w.id) }))}
              />
              <p className="abi-source-available">{sourceAvailable} USDC available</p>
              <span className="abi-allocation-connector" aria-hidden="true">
                <ArrowDownToLine size={17} />
              </span>
              <AllocationSelect
                label="To"
                value={target}
                onChange={(id) => {
                  setTarget(id);
                  setReview(false);
                }}
                disabled={busy}
                placeholder="Choose a workspace"
                options={workspaces
                  .filter((w) => w.id !== source)
                  .map((w) => ({ value: w.id, label: labelFor(w.id) }))}
              />
            </div>
            <label className="abi-allocation-amount">
              Amount
              <div>
                <input
                  required
                  aria-label="Allocation amount"
                  inputMode="decimal"
                  pattern="[0-9]+([.][0-9]{1,6})?"
                  value={amount}
                  placeholder="0.00"
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setReview(false);
                  }}
                  disabled={busy}
                />
                <span>USDC</span>
              </div>
            </label>
            <button
              className="abi-allocation-max"
              type="button"
              disabled={busy}
              onClick={() => {
                setAmount(sourceAvailable);
                setReview(false);
              }}
            >
              Use available balance
            </button>
            {review && (
              <div className="abi-allocation-review" role="status">
                <strong>{amount} USDC</strong>
                <p>
                  {labelFor(source)} <ArrowRight size={14} /> {labelFor(target)}
                </p>
                <small>This is an internal allocation. Approval rules still apply.</small>
              </div>
            )}
            <Button
              className="minimal-primary"
              disabled={busy || !source || !target || source === target || micro(amount) <= 0n}
              type="submit"
            >
              {busy ? "Allocating…" : review ? "Confirm allocation" : "Review allocation"}
              {review ? <Check size={16} /> : <ArrowRight size={16} />}
            </Button>
          </form>
          <p className="minimal-note">
            Funds stay in the account’s on-chain treasury. An allocation changes which workspace can
            spend them.
          </p>
        </section>
      </div>
      {(error || depositError) && (
        <p role="alert" className="minimal-error">
          {error || depositError}
        </p>
      )}
      {notice && (
        <p role="status" className="abi-funding-notice">
          {notice}
        </p>
      )}
    </section>
  );
}
function micro(value: string) {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) return 0n;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}
function display(value: bigint) {
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return (
    new Intl.NumberFormat("en-GB").format(value / 1_000_000n) + (fraction ? `.${fraction}` : ".00")
  );
}
