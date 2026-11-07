import { MarketingShell } from "../../../lib/marketing-shell";
import { MarketplaceProductDetail } from "../../../lib/marketplace-catalog";
export default async function ProductPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <MarketingShell><MarketplaceProductDetail id={id}/></MarketingShell>;}
