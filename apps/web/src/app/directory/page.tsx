import { MarketingShell } from "../../lib/marketing-shell";
import { MarketplaceCatalog } from "../../lib/marketplace-catalog";
export default function DirectoryPage(){return <MarketingShell active="marketplace"><div className="market-home"><h1>The ABI marketplace</h1><p>Explore published products from reviewed sellers. Stock, delivery and quality information are shown as supplied or verified.</p><MarketplaceCatalog/></div></MarketingShell>;}
