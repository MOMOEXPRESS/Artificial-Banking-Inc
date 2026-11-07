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
        ["catalog", "Inventory", "layers"],
        ["orders", "Orders", "list"],
        ["integrations", "Connect", "zap"],
        ["billing", "Payouts", "wallet"],
        ["settings", "Settings", "gear"],
      ]
    : [
        ["overview", "Overview", "home"],
        ["marketplace", "Catalog", "search"],
        ["connect", "Connect", "key"],
        ["billing", "Billing", "wallet"],
        ["settings", "Settings", "gear"],
      ];
  const navigate = (v: string) =>
    onNavigate(v === "orders" ? "catalog" : v, v === "orders" ? "orders" : undefined);
  const controls = links.map(([view, label, icon]) => (
    <button
      key={view}
      aria-current={active === view ? "page" : undefined}
      onClick={() => navigate(view)}
    >
      <Icon name={icon} size={19} />
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
          {
            <label className="minimal-more">
              <span className="sr-only">More workspace pages</span>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) onNavigate(e.target.value);
                }}
              >
                <option value="">More</option>
                {(seller
                  ? [
                      ["overview", "Overview"],
                      ["directory", "Directory"],
                      ["versions", "Versions"],
                      ["sandbox", "Sandbox"],
                      ["analytics", "Analytics"],
                      ["activity", "Activity"],
                      ["policies", "Access policies"],
                      ["webhooks", "Webhooks"],
                      ["developers", "Developers"],
                    ]
                  : [
                      ["chat", "Assistant"],
                      ["agents", "Agents & allowances"],
                      ["treasury", "USDC treasury"],
                      ["payments", "Payments & approvals"],
                      ["insights", "Activity"],
                      ["work", "Agent work"],
                      ["policy", "Policies"],
                      ["ledger", "Ledger"],
                      ["playground", "API playground"],
                      ["webhooks", "Webhooks"],
                    ]
                ).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          }
        </div>
      </nav>
      <nav className="minimal-dock" aria-label="Mobile workspace navigation">
        {controls}
      </nav>
    </>
  );
}
