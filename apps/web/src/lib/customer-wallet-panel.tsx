"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Wallet, Globe2, ShieldCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { workspaceJson, type WorkspaceFetcher } from "./workspace-client";
const schema = z.object({
  provider: z.literal("privy"),
  control: z.literal("customer-owned"),
  environment: z.literal("mainnet"),
  workspaceId: z.string(),
  status: z.enum(["verified", "verification_pending", "setup_pending", "identity_required"]),
  verifiedAt: z.string().nullable(),
  receiveEnabled: z.literal(false),
  spendingEnabled: z.literal(false),
  address: z.null(),
  assets: z
    .array(
      z.object({
        id: z.enum(["base:eth", "base:usdc", "ethereum:eth", "ethereum:usdc"]),
        symbol: z.enum(["ETH", "USDC"]),
        network: z.enum(["Base", "Ethereum"]),
        chainId: z.union([z.literal(1), z.literal(8453)]),
        decimals: z.union([z.literal(6), z.literal(18)]),
        contract: z
          .string()
          .regex(/^0x[\da-fA-F]{40}$/)
          .nullable(),
      }),
    )
    .length(4),
});
type State = z.infer<typeof schema>;
export function CustomerWalletPanel({
  workspaceId,
  name,
  gFetch,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  name: string;
  gFetch: WorkspaceFetcher;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<State | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [hidden, setHidden] = useState(false),
    [assetId, setAssetId] = useState("base:usdc");
  const active = useRef(true),
    attempted = useRef(false);
  const path = `/v1/guardian/workspaces/${encodeURIComponent(workspaceId)}/wallet`;
  const load = useCallback(
    async (setup = false) => {
      setBusy(true);
      setError("");
      try {
        const response = await gFetch(path, setup ? { method: "POST", body: "{}" } : undefined);
        if (response.status === 403 || response.status === 401) {
          const body = await response.json();
          if (!active.current) return;
          if (body.error?.code === "LINKED_IDENTITY_REQUIRED") {
            setError(body.error.message);
            return;
          }
          setHidden(true);
          return;
        }
        const value = schema.parse(await workspaceJson(response));
        if (value.workspaceId !== workspaceId)
          throw Error("The wallet response belongs to a different workspace.");
        if (active.current) setData(value);
        return value;
      } catch (e) {
        if (active.current) {
          setData(null);
          setError(
            e instanceof z.ZodError
              ? "Wallet details could not be verified. Retry to refresh them."
              : (e as Error).message,
          );
        }
      } finally {
        if (active.current) setBusy(false);
      }
    },
    [gFetch, path, workspaceId],
  );
  useEffect(() => {
    active.current = true;
    void load().then((value) => {
      if (active.current && value?.status === "setup_pending" && !attempted.current) {
        attempted.current = true;
        void load(true);
      }
    });
    return () => {
      active.current = false;
    };
  }, [load]);
  const asset = data?.assets.find((a) => a.id === assetId);
  const verified = data?.status === "verified";
  if (hidden) return null;
  return (
    <section className="minimal-section abi-mainnet-wallet" aria-busy={busy}>
      <div className="minimal-section-heading">
        <h2>
          <Wallet size={21} aria-hidden="true" /> Wallet currencies
        </h2>
        <Button variant="ghost" onClick={() => onOpenChange(true)}>
          <Globe2 size={16} /> Currencies
        </Button>
      </div>
      <p>
        {verified
          ? "Wallet ownership verified. Mainnet activation is pending."
          : data?.status === "identity_required"
            ? "Link Google or GitHub sign-in to prepare your customer-owned wallet."
            : "Preparing a customer-owned wallet for this workspace."}
      </p>
      <p className="abi-workspace-note">
        ETH and USDC on Base and Ethereum. Deposits, withdrawals and agent payments are awaiting
        recovery and settlement checks.
      </p>
      {error && <p role="alert">{error}</p>}
      <Button
        variant="ghost"
        disabled={busy || data?.status === "identity_required"}
        onClick={() => void load(true)}
      >
        <RefreshCw size={15} />{" "}
        {busy ? "Checking wallet…" : verified ? "Verify connection" : "Retry wallet setup"}
      </Button>
      {data?.status === "identity_required" && (
        <p>
          Use Google or GitHub at sign-in, then confirm linking to your existing ABI account.
          Matching email alone does not link wallets.
        </p>
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="reference-dialog abi-workspace-dialog abi-mainnet-dialog">
          <DialogTitle>{name} · currencies</DialogTitle>
          <DialogDescription>
            Choose a currency and network for this workspace’s wallet.
          </DialogDescription>
          {data ? (
            <>
              <label htmlFor="wallet-currency">Currency and network</label>
              <Select value={assetId} onValueChange={setAssetId}>
                <SelectTrigger id="wallet-currency" className="abi-access-select-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="abi-access-select">
                  {data.assets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.symbol} · {a.network}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {asset && (
                <div className="abi-mainnet-asset">
                  <Globe2 size={24} aria-hidden="true" />
                  <div>
                    <strong>
                      {asset.symbol} on {asset.network}
                    </strong>
                    <p>Mainnet · Chain {asset.chainId}</p>
                  </div>
                </div>
              )}
              <p>ETH and USDC share this wallet’s EVM address. Network balances remain separate.</p>
              <div className="abi-mainnet-status">
                <ShieldCheck size={18} aria-hidden="true" />
                <span>{verified ? "Ownership verified" : "Wallet setup pending"}</span>
              </div>
              <p role="status">
                Receiving address unavailable until recovery, withdrawals and settlement
                verification are complete. Please do not send funds yet.
              </p>
              <p className="abi-workspace-note">
                Your existing Base Sepolia balance and receiving route remain separate.
              </p>
            </>
          ) : (
            <p role="status">
              {busy
                ? "Loading wallet currencies…"
                : "Wallet details are unavailable. Close and retry wallet setup."}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Provider setup runs after login, keeping sign-in independent of wallet availability. */
export function AutomaticCustomerWallet({
  workspaceId,
  gFetch,
}: {
  workspaceId: string;
  gFetch: WorkspaceFetcher;
}) {
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const path = `/v1/guardian/workspaces/${encodeURIComponent(workspaceId)}/wallet`;
      const response = await gFetch(path, { signal: controller.signal });
      if (!response.ok || controller.signal.aborted) return;
      const state = schema.parse(await response.json());
      if (state.workspaceId !== workspaceId) throw Error();
      if (state.status !== "setup_pending") return;
      setNotice("Preparing your mainnet wallet…");
      const setup = await gFetch(path, { method: "POST", body: "{}", signal: controller.signal });
      if (!setup.ok) throw Error();
      const prepared = schema.parse(await setup.json());
      if (prepared.workspaceId !== workspaceId || prepared.status !== "verified") throw Error();
      if (!controller.signal.aborted)
        setNotice("Wallet ownership verified · mainnet activation pending");
    })().catch(() => {
      if (!controller.signal.aborted)
        setNotice("Mainnet wallet preparation is pending. Open Wallet to retry.");
    });
    return () => controller.abort();
  }, [gFetch, workspaceId]);
  return notice ? (
    <p className="abi-workspace-note" role="status">
      {notice}
    </p>
  ) : null;
}
