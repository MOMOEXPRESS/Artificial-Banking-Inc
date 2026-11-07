"use client";

import Link from "next/link";
import { Icon } from "./ui";

export function StudioNav({seller=false,active,onNavigate}:{seller?:boolean;active:string;onNavigate:(view:string,tab?:string)=>void}) {
  const links = seller
    ? [["catalog","Inventory","layers"],["orders","Orders","list"],["billing","Payouts","wallet"],["integrations","Integrations","zap"]]
    : [["marketplace","Shopping","search"],["orders","Orders","book"],["chat","Assistant","spark"],["agents","Agents","key"],["approvals","Approvals","check"]];
  return <nav className="studio-workspace-nav" aria-label="Workspace navigation">
    <Link className="studio-wordmark" href="/">ABI</Link>
    <div className="studio-workspace-switch" aria-label="Workspace"><Link href="/console?view=marketplace" aria-current={!seller?"page":undefined}>Buy</Link><Link href="/partners/login" aria-current={seller?"page":undefined}>Sell</Link></div>
    <div className="studio-workspace-links">{links.map(([view,label,icon])=><button key={view} aria-current={active===view?"page":undefined} onClick={()=>onNavigate(view === "orders" ? seller ? "catalog" : "marketplace" : view,view === "orders" ? "orders" : undefined)}><Icon name={icon} size={17}/><span>{label}</span></button>)}</div>
  </nav>;
}
