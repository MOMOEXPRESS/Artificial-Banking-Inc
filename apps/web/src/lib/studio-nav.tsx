"use client";
import Link from "next/link";
import { Icon } from "./ui";
export function StudioNav({
  seller = false,
  active,
  onNavigate,
}: {
  seller?: boolean;
  active: string;
  onNavigate: (view: string, tab?: string) => void;
}) {
  const links = seller
    ? [
        ["overview", "Overview", "home"],
        ["catalog", "Inventory", "layers"],
        ["integrations", "Connect", "key"],
        ["billing", "Payouts", "wallet"],
        ["settings", "Settings", "gear"],
      ]
    : [
        ["overview", "Overview", "home"],
        ["marketplace", "Marketplace", "search"],
        ["connect", "Connect", "key"],
        ["billing", "Billing", "wallet"],
        ["settings", "Settings", "gear"],
      ];
  const controls = links.map(([view, label, icon]) => (
    <button
      key={view}
      aria-current={active === view ? "page" : undefined}
      onClick={() => onNavigate(view)}
    >
      <Icon name={icon} size={20} />
      <span>{label}</span>
    </button>
  ));
  return (
    <>
      <nav className="studio-workspace-nav" aria-label="Workspace navigation">
        <Link className="studio-wordmark" href="/">
          ABI
        </Link>
        <div className="studio-workspace-links">{controls}</div>
        <div className="minimal-nav-end">
          <Link href={seller ? "/console" : "/partners/login"}>
            {seller ? "Buyer workspace" : "Sell on ABI"}
          </Link>
        </div>
      </nav>
      <nav className="minimal-dock" aria-label="Workspace dock">
        {controls}
      </nav>
    </>
  );
}
