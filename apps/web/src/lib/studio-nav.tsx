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
        ["marketplace", "Marketplace", "storefront"],
        ["connect", "Connect", "key"],
        ["billing", "Billing", "creditCard"],
        ["settings", "Settings", "gear"],
      ];
  const controls = links.map(([view, label, icon]) => (
    <button
      key={view}
      aria-current={
        active === view || (view === "overview" && active === "treasury") ? "page" : undefined
      }
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
        {seller && (
          <div className="minimal-nav-end">
            <Link href="/console">Buyer workspace</Link>
          </div>
        )}
      </nav>
      <nav className="minimal-dock" aria-label="Workspace dock">
        {controls}
      </nav>
    </>
  );
}
