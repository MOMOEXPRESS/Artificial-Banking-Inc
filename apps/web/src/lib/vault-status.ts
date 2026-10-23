/**
 * Money tab status strip — pure state derivation.
 *
 * The strip under "Vault assets" answers one question: is anything happening
 * with this vault right now, and if not, what was the last thing that
 * happened? Everything here is derived from data the Fund tab already loads
 * (in-flight console actions, pending treasury moves, on-chain deposits seen
 * but not yet credited, vault activity, executed moves). Nothing is invented:
 * no data means "idle", never a fake "processed".
 */

export type VaultStatusState = "idle" | "processing" | "processed";

export type StatusActivity = {
  id: string;
  label: string;
  at: string;
  amountUsdc: string;
  direction: "in" | "out";
  symbol?: string;
  assetId?: string;
  explorerUrl?: string;
};

export type StatusMove = {
  id: string;
  amountUsdc: string;
  status: string;
  createdAt: string;
  /** Human route, e.g. "Org treasury → Budget · Ops". */
  route?: string;
};

export type StatusDeposit = {
  txHash: string;
  amountUsdc: string;
  status: "detected" | "credited";
};

export type LastProcessed = {
  label: string;
  at: string;
  explorerUrl?: string;
};

export type VaultStatus = {
  state: VaultStatusState;
  title: string;
  detail: string;
  /** Most recent completed action, when one exists (also shown while processing). */
  last: LastProcessed | null;
};

export type VaultStatusInput = {
  /** Asset currently selected in the Vault assets picker. */
  assetId: string;
  symbol: string;
  /** A console action (receive, send, move, re-scan…) is in flight. */
  actionInFlight: boolean;
  moves: StatusMove[];
  deposits: StatusDeposit[];
  activity: StatusActivity[];
};

export const USDC_ASSET_ID = "asset_usdc";

function time(at: string): number {
  const t = Date.parse(at);
  return Number.isNaN(t) ? -Infinity : t;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Activity rows that belong to the selected asset (rows without an asset id are USDC). */
export function activityForAsset(activity: StatusActivity[], assetId: string): StatusActivity[] {
  return activity.filter((a) => (a.assetId ? a.assetId === assetId : assetId === USDC_ASSET_ID));
}

function fmtUsd(amount: string): string {
  const n = Number(amount);
  if (Number.isNaN(n)) return `$${amount}`;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

/** Latest completed action for the selected asset, or null when there is none. */
export function lastProcessed(input: VaultStatusInput): LastProcessed | null {
  const candidates: (LastProcessed & { t: number })[] = [];
  for (const a of activityForAsset(input.activity, input.assetId)) {
    const sign = a.direction === "in" ? "+" : "−";
    candidates.push({
      label: `${sign}${a.amountUsdc} ${a.symbol ?? input.symbol} · ${a.label}`,
      at: a.at,
      explorerUrl: a.explorerUrl,
      t: time(a.at),
    });
  }
  // Treasury moves are USDC ledger moves; they only describe the USDC rail.
  if (input.assetId === USDC_ASSET_ID) {
    for (const m of input.moves) {
      if (m.status !== "executed") continue;
      candidates.push({
        label: `Moved ${fmtUsd(m.amountUsdc)}${m.route ? ` · ${m.route}` : ""}`,
        at: m.createdAt,
        t: time(m.createdAt),
      });
    }
  }
  const valid = candidates.filter((c) => Number.isFinite(c.t));
  if (valid.length === 0) return null;
  valid.sort((a, b) => b.t - a.t);
  const { t: _t, ...best } = valid[0]!;
  return best;
}

export function deriveVaultStatus(input: VaultStatusInput): VaultStatus {
  const last = lastProcessed(input);
  const isUsdc = input.assetId === USDC_ASSET_ID;
  const pendingMoves = isUsdc ? input.moves.filter((m) => m.status === "pending").length : 0;
  const confirming = isUsdc ? input.deposits.filter((d) => d.status === "detected").length : 0;

  const reasons: string[] = [];
  if (input.actionInFlight) reasons.push("Submitting a treasury action");
  if (confirming > 0) reasons.push(`${plural(confirming, "deposit")} seen on-chain, crediting`);
  if (pendingMoves > 0) reasons.push(`${plural(pendingMoves, "move")} awaiting approval`);

  if (reasons.length > 0) {
    return { state: "processing", title: "Processing", detail: reasons.join(" · "), last };
  }
  if (last) {
    return { state: "processed", title: "Last processed", detail: last.label, last };
  }
  return {
    state: "idle",
    title: "Idle",
    detail: `Nothing in progress for ${input.symbol}`,
    last: null,
  };
}

/** "just now", "5 min ago", "3 h ago", "2 d ago" — compact and locale-neutral. */
export function relativeTime(at: string, now: number = Date.now()): string {
  const t = time(at);
  if (!Number.isFinite(t)) return "";
  const s = Math.round((now - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

/** Short absolute timestamp for the strip, e.g. "23 Oct, 17:05". */
export function shortTimestamp(at: string, locale?: string): string {
  const t = time(at);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type ChainSnapshot = {
  ok: boolean;
  error?: string;
  networkName?: string;
  nativeBalanceEth?: string;
  hasGas?: boolean;
};

export type StripChip = { key: string; text: string; tone: "ok" | "warn" | "mute"; title?: string };

/**
 * Small inline facts for the strip. USDC carries the critical chain facts
 * (network, chain read, gas); other assets say how their balance is backed.
 */
export function stripChips(args: {
  assetId: string;
  chain: ChainSnapshot | null;
  checking: boolean;
  backing?: { checked: boolean; ok: boolean; driftUsdc: string } | null;
  holding?: {
    backing?: { kind: "chain" | "chain-unconfigured" | "manual"; reason?: string };
    onchainError?: string;
  } | null;
}): StripChip[] {
  const chips: StripChip[] = [];
  if (args.assetId === USDC_ASSET_ID) {
    const c = args.chain;
    chips.push({ key: "net", text: c?.networkName ?? "Base Sepolia", tone: "mute" });
    if (args.checking && !c) {
      chips.push({ key: "chain", text: "Checking chain…", tone: "mute" });
    } else if (!c || !c.ok) {
      chips.push({
        key: "chain",
        text: "Chain status unavailable",
        tone: "warn",
        title: c?.error
          ? `Latest chain read failed: ${c.error}`
          : "The chain has not been read yet.",
      });
    } else {
      chips.push(
        c.hasGas
          ? { key: "gas", text: `Gas ${c.nativeBalanceEth ?? "?"} ETH`, tone: "ok" }
          : {
              key: "gas",
              text: "No gas",
              tone: "warn",
              title: "The vault needs native ETH to pay network gas before it can send on-chain.",
            },
      );
      if (args.backing?.checked && !args.backing.ok) {
        chips.push({ key: "drift", text: `Drift ${args.backing.driftUsdc} USDC`, tone: "warn" });
      }
    }
    return chips;
  }
  const kind = args.holding?.backing?.kind;
  if (kind === "chain") {
    chips.push(
      args.holding?.onchainError
        ? {
            key: "chain",
            text: "Chain status unavailable",
            tone: "warn",
            title: args.holding.onchainError,
          }
        : { key: "chain", text: "Read on-chain", tone: "ok" },
    );
  } else if (kind === "chain-unconfigured") {
    chips.push({
      key: "chain",
      text: "Not read on-chain",
      tone: "mute",
      title: args.holding?.backing?.reason,
    });
  } else if (kind === "manual") {
    chips.push({
      key: "chain",
      text: "Recorded by hand",
      tone: "mute",
      title: args.holding?.backing?.reason,
    });
  }
  return chips;
}
