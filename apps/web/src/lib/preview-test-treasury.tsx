"use client";
import { useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AllocationSelect } from "./allocation-select";
import { CryptoDeposit } from "./crypto-deposit";
import { workspaceJson, type Workspace, type WorkspaceFetcher } from "./workspace-client";
export const previewTreasurySchema = z.object({
  preview: z.literal(true),
  address: z.string().regex(/^0x[\da-fA-F]{40}$/),
  provider: z.string(),
  chainId: z.literal(84532),
  network: z.literal("Base Sepolia"),
  availableUsdc: z.string(),
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
  const [open, setOpen] = useState(false),
    [source, setSource] = useState(workspaces.find((w) => w.isDefault)?.id ?? ""),
    [target, setTarget] = useState(""),
    [amount, setAmount] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const inFlight = useRef(false),
    attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  async function sync() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
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
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
  return (
    <section className="minimal-section abi-account-treasury">
      <div className="minimal-section-heading">
        <div>
          <h2>Testnet treasury</h2>
          <p>Preview · Base Sepolia · Test funds only.</p>
        </div>
        <Button onClick={() => setOpen(true)}>Add test funds</Button>
      </div>
      <p>
        This is the account’s execution treasury. Confirmed test USDC deposits credit the ledger;
        workspaces spend their allocated share from this same account.
      </p>
      <dl className="abi-pool-balances">
        <div>
          <dt>Unallocated test USDC</dt>
          <dd>{profile.availableUsdc} USDC</dd>
        </div>
      </dl>
      <div className="minimal-actions">
        <Button variant="ghost" disabled={busy} onClick={() => void sync()}>
          Check deposits
        </Button>
        <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">
          Get Base Sepolia test USDC
        </a>
      </div>
      <form
        className="abi-treasury-allocation"
        onSubmit={(e) => {
          e.preventDefault();
          void allocate();
        }}
      >
        <AllocationSelect
          label="From"
          value={source}
          onChange={setSource}
          disabled={busy}
          options={workspaces.map((w) => ({
            value: w.id,
            label: w.isDefault ? "Account treasury" : w.name,
          }))}
        />
        <AllocationSelect
          label="To workspace"
          value={target}
          onChange={setTarget}
          disabled={busy}
          placeholder="Choose a workspace"
          options={workspaces
            .filter((w) => w.id !== source)
            .map((w) => ({ value: w.id, label: w.isDefault ? "Account treasury" : w.name }))}
        />
        <label>
          Test USDC
          <input
            required
            inputMode="decimal"
            pattern="[0-9]+(\.[0-9]{1,6})?"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
          />
        </label>
        <Button disabled={busy || !source || !target || source === target} type="submit">
          Allocate test funds
        </Button>
      </form>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <p className="minimal-note">
        Daily, weekly and monthly caps and approvals still apply. x402 and MPP EVM charge use the
        same Base Sepolia USDC treasury. Existing mainnet wallets and assets have not been moved
        into this preview.
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="reference-dialog abi-workspace-dialog abi-wallet-action-dialog abi-deposit-dialog">
          <DialogTitle>Add test USDC</DialogTitle>
          <DialogDescription>
            Use Base Sepolia only. This address is the treasury that signs agent payments.
          </DialogDescription>
          <CryptoDeposit
            data={view}
            busy={busy}
            error={error}
            onAssetChange={() => {}}
            onRefresh={() => void sync()}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
