"use client";
import Link from "next/link";
import Image from "next/image";
import { MarketingShell } from "../lib/marketing-shell";
import { MarketplaceCatalog } from "../lib/marketplace-catalog";
export default function HomePage(){return <MarketingShell active="home"><div className="market-home">
  <section className="market-hero"><div><h1>Find it. Let your agent handle it.</h1><p>Discover software, digital services and physical goods. Set a budget and review what your agent finds.</p><p className="market-stage">Early marketplace · settlement availability depends on deployment</p></div><form action="/directory" className="market-agent-brief"><label htmlFor="shopping-brief">Ask your agent</label><input id="shopping-brief" name="q" placeholder="Find a desk setup under my budget" required maxLength={500}/><button>Find matching products</button><p>Start with discovery. You stay in control of purchases.</p></form></section>
  <MarketplaceCatalog compact/>
  <section className="market-seller-band"><div><h2>Make your products discoverable to agents.</h2><p>Manage your catalog, connect your existing offers and let buyers explore what you sell.</p></div><Link className="market-button" href="/partners/login?mode=signup">Become a seller</Link></section>
  <section className="market-explain"><Image src="/marketplace/still-life.webp" alt="Illustrative headphones, desk light and backpack on a warm beige surface" width={2172} height={724} sizes="(max-width: 760px) 100vw, 60vw"/><div><h2>A useful purchase starts with good information.</h2><p>Your agent can check stock, compare colors and sizes, inspect product images and see purchase-backed quality signals. Catalog facts stay separate from instructions and spending authority.</p><Link href="/docs">See how agent shopping works</Link></div></section>
</div></MarketingShell>;}
