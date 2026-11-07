/** Fictional fixtures. Never sent to catalog, checkout, wallet or settlement APIs. */
export const DEMO_PRODUCTS = [
  { id: "pack", name: "Trailhead daypack", seller: "Northline Supply", category: "Outdoors", kind: "physical", price: 6800, stock: 14, color: "Forest green", detail: "22 L · recycled nylon · water resistant", delivery: "3–5 days", rating: "4.8 · 36 simulated reviews", image: 0 },
  { id: "headphones", name: "Quiet hours headphones", seller: "Form Audio", category: "Electronics", kind: "physical", price: 12900, stock: 8, color: "Chalk", detail: "Over-ear · wireless · 30-hour battery", delivery: "2–4 days", rating: "4.7 · 21 simulated reviews", image: 1 },
  { id: "lamp", name: "Clay desk light", seller: "Studio Common", category: "Home & living", kind: "physical", price: 3800, stock: 6, color: "Terracotta", detail: "Ceramic · 28 cm · warm LED included", delivery: "3–5 days", rating: "4.9 · 18 simulated reviews", image: 2 },
  { id: "desk", name: "Everyday desk kit", seller: "Fieldwork Goods", category: "Electronics", kind: "physical", price: 8900, stock: 0, color: "Slate blue / silver", detail: "Notebook · 500 GB SSD · USB-C cable", delivery: "Restock pending", rating: "4.6 · 12 simulated reviews", image: 3 },
  { id: "guide", name: "Weekend trail guide", seller: "Northline Digital", category: "Digital goods", kind: "digital", price: 1200, stock: 100, color: "Digital download", detail: "PDF · 40 routes · personal-use license", delivery: "Instant demo download", rating: "4.8 · 24 simulated reviews", image: null },
  { id: "software", name: "Focus workspace templates", seller: "Softdesk Studio", category: "Software", kind: "digital", price: 2400, stock: 100, color: "Light & dark layouts", detail: "Markdown templates · lifetime personal license", delivery: "Instant demo delivery", rating: "4.9 · 31 simulated reviews", image: null },
] as const;
export type DemoProduct = (typeof DEMO_PRODUCTS)[number];
export type DemoScenario = { id: string; title: string; brief: string; budget: number; approvalAbove: number; products: string[] };
export const DEMO_SCENARIOS: DemoScenario[] = [
  { id: "hiking", title: "A gift for a hiker", brief: "Find a green daypack and a trail guide under 95 USDC. Check availability and delivery.", budget: 9500, approvalAbove: 10000, products: ["pack", "guide"] },
  { id: "approval", title: "An upgrade that needs approval", brief: "Compare wireless headphones. Request my approval for purchases above 100 USDC.", budget: 16000, approvalAbove: 10000, products: ["headphones"] },
  { id: "digital", title: "Instant software delivery", brief: "Find workspace templates under 30 USDC and retrieve the files after checkout.", budget: 3000, approvalAbove: 10000, products: ["software"] },
  { id: "stock", title: "Find an in-stock alternative", brief: "The desk kit is out of stock. Choose a desk light and workspace templates under 100 USDC.", budget: 10000, approvalAbove: 10000, products: ["lamp", "software"] },
];
export const demoPrice = (cents: number) => `${(cents / 100).toFixed(2)} USDC`;
export function demoQuote(ids: string[], budget: number, approvalAbove: number) {
  const items = ids.map(id => DEMO_PRODUCTS.find(p => p.id === id)).filter((p): p is DemoProduct => !!p);
  const subtotal = items.reduce((sum, p) => sum + p.price, 0);
  const shipping = items.some(p => p.kind === "physical") ? 600 : 0;
  const total = subtotal + shipping;
  return { items, subtotal, shipping, total, valid: !!items.length && items.every(p => p.stock > 0) && total <= budget, needsApproval: total > approvalAbove };
}
