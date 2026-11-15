"use client";
import { useState } from "react";
import { Check, ChevronsUpDown, Plus, Search, Wallet, ArrowUpRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { workspaceJson, type Workspace, type WorkspaceFetcher } from "./workspace-client";
import { walletAmount } from "./managed-wallet-client";
export function WalletPicker({
  items,
  current,
  onSelect,
  gFetch,
  onChanged,
  readOnly,
}: {
  items: Workspace[];
  current: Workspace;
  onSelect: (id: string) => void;
  gFetch: WorkspaceFetcher;
  onChanged: () => Promise<void>;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [createOpen, setCreateOpen] = useState(false),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [requestKey, setRequestKey] = useState("");
  const filtered = items.filter((w) =>
    w.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  async function create() {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const d = await workspaceJson(
        await gFetch("/v1/guardian/workspaces", {
          method: "POST",
          body: JSON.stringify({ name: name.trim(), idempotencyKey: requestKey }),
        }),
      );
      await onChanged();
      onSelect(d.workspace.id);
      setCreateOpen(false);
      setName("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Popover
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (v) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <button className="abi-wallet-trigger" aria-label={`Choose wallet: ${current.name}`}>
            <span className="abi-wallet-mark">
              <Wallet size={25} />
            </span>
            <span className="abi-wallet-title">
              <strong>
                {current.name}
                <ChevronsUpDown size={17} />
              </strong>
              <small>Workspace wallet</small>
            </span>
            <span className="abi-wallet-available">
              <strong>
                {walletAmount(current.wallet)}{" "}
                <small>{current.wallet?.asset.symbol ?? "USDC"}</small>
              </strong>
              <small>
                {current.wallet?.asset.network ?? "Wallet setup"} <ArrowUpRight size={14} />
              </small>
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={10}
          className="abi-wallet-popover"
          collisionPadding={16}
          onKeyDown={(e) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
            const rows = Array.from(
              e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=option]"),
            );
            if (!rows.length) return;
            const at = rows.indexOf(document.activeElement as HTMLButtonElement);
            e.preventDefault();
            rows[
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? rows.length - 1
                  : e.key === "ArrowDown"
                    ? (at + 1) % rows.length
                    : (at - 1 + rows.length) % rows.length
            ]?.focus();
          }}
        >
          <label className="abi-wallet-search">
            <Search size={19} />
            <input
              aria-label="Find a wallet"
              placeholder="Find a wallet"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button
            className="abi-wallet-create"
            disabled={readOnly}
            onClick={() => {
              setOpen(false);
              setError("");
              setRequestKey(crypto.randomUUID());
              setCreateOpen(true);
            }}
          >
            <Plus size={24} />
            Create wallet
          </button>
          <div className="abi-wallet-options" role="listbox" aria-label="Wallets">
            {filtered.map((w) => (
              <button
                key={w.id}
                role="option"
                aria-selected={w.id === current.id}
                onClick={() => {
                  onSelect(w.id);
                  setOpen(false);
                }}
              >
                <span className="abi-wallet-mark">
                  <Wallet size={22} />
                </span>
                <span>
                  <strong>{w.name}</strong>
                  <small>
                    {w.orgId === current.orgId ? "Workspace wallet" : "Another account"} ·{" "}
                    {walletAmount(w.wallet)} {w.wallet?.asset.symbol ?? "USDC"} ·{" "}
                    {w.wallet?.asset.network ?? "Setting up"}
                  </small>
                </span>
                {w.id === current.id && (
                  <span className="abi-wallet-selected">
                    <Check size={16} aria-hidden="true" />
                  </span>
                )}
              </button>
            ))}
            {!filtered.length && <p className="abi-wallet-empty">No wallets match “{query}”.</p>}
          </div>
        </PopoverContent>
      </Popover>
      <Dialog
        open={createOpen}
        onOpenChange={(v) => {
          if (!busy) setCreateOpen(v);
        }}
      >
        <DialogContent className="reference-dialog abi-workspace-dialog abi-wallet-action-dialog">
          <span className="abi-dialog-symbol" aria-hidden="true">
            <Wallet size={22} />
          </span>
          <DialogTitle>Create wallet</DialogTitle>
          <DialogDescription>
            A new workspace with its own ABI card and shared spending limit.
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label>
              Wallet name
              <input
                autoFocus
                required
                maxLength={80}
                placeholder="Travel, research, operations…"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <p>
              Starts with zero funds and a zero spending limit. Allocate funds and set a limit when
              you’re ready.
            </p>
            {error && <p role="alert">{error}</p>}
            <Button disabled={busy || !name.trim()} type="submit">
              {busy ? "Creating…" : "Create wallet"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
