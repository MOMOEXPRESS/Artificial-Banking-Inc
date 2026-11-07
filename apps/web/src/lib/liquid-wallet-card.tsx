"use client";

import { ABMark } from "./brand";
import { cardholderName } from "./vault-card-format";
import type { PointerEvent } from "react";

/** A workspace wallet, with semantic content over the approved optical-glass material. */
export function LiquidWalletCard({
  name,
  network,
  onOpen,
}: {
  name?: string | null;
  network: string;
  onOpen?: () => void;
}) {
  const content = (
    <>
      <span className="liquid-card-material" aria-hidden="true" />
      <span className="liquid-card-watermark" aria-hidden="true">
        <ABMark size={112} tone="#262626" />
      </span>
      <span className="liquid-card-top">
        <span className="liquid-card-brand">
          <ABMark size={25} tone="#262626" /> ABI VAULT
        </span>
        <span className="liquid-card-token">USDC</span>
      </span>
      <span className="liquid-card-purpose">Workspace wallet</span>
      <span className="liquid-card-bottom">
        <span>{cardholderName(name)}</span>
        <span>{network.toUpperCase()}</span>
      </span>
    </>
  );
  function highlight(e: PointerEvent<HTMLElement>) {
    if (e.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--glass-x", `${((e.clientX - r.left) / r.width) * 100}%`);
    e.currentTarget.style.setProperty("--glass-y", `${((e.clientY - r.top) / r.height) * 100}%`);
  }
  return onOpen ? (
    <button
      type="button"
      className="liquid-wallet-card"
      onClick={onOpen}
      onPointerMove={highlight}
      aria-label={`Open ${name || "workspace"} wallet`}
    >
      {content}
    </button>
  ) : (
    <div
      className="liquid-wallet-card"
      onPointerMove={highlight}
      role="group"
      aria-label={`${name || "Workspace"} wallet, USDC on ${network}`}
    >
      {content}
    </div>
  );
}
