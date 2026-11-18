"use client";
import { AccountAllocations } from "./account-allocations";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CustomerWalletPanel } from "./customer-wallet-panel";
import { workspaceJson, type Workspace, type WorkspaceFetcher } from "./workspace-client";
export function AccountTreasury({
  workspaces,
  gFetch,
  onChanged,
  readOnly,
}: {
  workspaces: Workspace[];
  gFetch: WorkspaceFetcher;
  onChanged: () => Promise<void>;
  readOnly: boolean;
}) {
  const inFlight = useRef(false);
  const treasury = workspaces.find((w) => w.isDefault),
    targets = workspaces.filter((w) => !w.isDefault);
  const [open, setOpen] = useState(false),
    [intent, setIntent] = useState<"receive" | "allocate">("receive"),
    [target, setTarget] = useState(""),
    [amount, setAmount] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState<{ target: string; amount: string; key: string } | null>(
    null,
  );
  if (!treasury || readOnly) return null;
  async function allocate() {
    if (!treasury || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const key =
      attempt?.target === target && attempt.amount === amount ? attempt.key : crypto.randomUUID();
    setAttempt({ target, amount, key });
    try {
      const data = await workspaceJson(
        await gFetch(`/v1/guardian/workspaces/${treasury.id}/allocations`, {
          method: "POST",
          body: JSON.stringify({ toWorkspaceId: target, amountUsdc: amount, idempotencyKey: key }),
        }),
      );
      setNotice(
        data.allocation.status === "pending"
          ? "Allocation awaiting approval. Funds have not moved."
          : "Agent allowance allocated. No on-chain transfer occurred.",
      );
      setAmount("");
      setAttempt(null);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="minimal-section abi-account-treasury">
      <div className="minimal-section-heading">
        <div>
          <h2>Account treasury</h2>
          <p>Top up your account, then distribute funds to workspaces.</p>
        </div>
        <Button
          onClick={() => {
            setIntent("receive");
            setOpen(true);
          }}
        >
          Top up account
        </Button>
      </div>
      <p className="minimal-note">
        Account deposits use the existing {treasury.name} wallet. Existing receiving addresses and
        balances are preserved. Mainnet crypto, the Base Sepolia agent allowance, and card-funded
        USD credits remain separate.
      </p>
      <AccountAllocations key={treasury.orgId} workspaces={workspaces} gFetch={gFetch} />
      <details>
        <summary>Existing wallet transfers · on-chain</summary>
        <p>
          Transfers to separate workspace wallets pay network fees. Use internal allocations above
          for funds that should stay in the account.
        </p>
        <div className="minimal-actions">
          <Button
            variant="ghost"
            disabled={!targets.length}
            onClick={() => {
              setIntent("allocate");
              setOpen(true);
            }}
          >
            Transfer crypto to workspace
          </Button>
        </div>
      </details>
      <details>
        <summary>Allocate agent allowance · Base Sepolia</summary>
        <p>
          Internal allocations use the ledger. They do not transfer or convert mainnet crypto.
          Account allowance available: {treasury.balance.availableUsdc} USDC. Existing General
          agents may also use this allowance.
        </p>
        <form
          className="abi-treasury-allocation"
          onSubmit={(e) => {
            e.preventDefault();
            void allocate();
          }}
        >
          <label>
            Workspace
            <select
              required
              value={target}
              disabled={busy}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Choose workspace</option>
              {targets.map((w) => (
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
          <Button disabled={busy || !target} type="submit">
            {busy ? "Allocating…" : "Allocate allowance"}
          </Button>
        </form>
      </details>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {open && (
        <CustomerWalletPanel
          workspaceId={treasury.id}
          name="Account treasury"
          gFetch={gFetch}
          open={open}
          onOpenChange={setOpen}
          intent={intent}
          workspaces={workspaces}
        />
      )}
    </section>
  );
}
