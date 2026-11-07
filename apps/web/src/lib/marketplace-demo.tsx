"use client";

import { useState } from "react";
import { Icon } from "./ui";
import { DEMO_PRODUCTS, DEMO_SCENARIOS, demoPrice, demoQuote, type DemoProduct } from "./marketplace-demo-data";

type Stage = "browse" | "quote" | "approval" | "ordered" | "received";
export function MarketplaceDemo() {
  const [comparisonOnly, setComparisonOnly] = useState(true);
  const [hasRun, setHasRun] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All products");
  const [scenarioId, setScenarioId] = useState("hiking");
  const [cart, setCart] = useState<string[]>([]);
  const [stage, setStage] = useState<Stage>("browse");
  const [notice, setNotice] = useState("");
  const [download, setDownload] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const scenario = DEMO_SCENARIOS.find(s => s.id === scenarioId)!;
  const quote = demoQuote(cart, scenario.budget, scenario.approvalAbove);
  const locked = stage === "approval" || stage === "ordered" || stage === "received";
  const physical = quote.items.some(p => p.kind === "physical");
  const digital = quote.items.some(p => p.kind === "digital");
  const products = DEMO_PRODUCTS.filter(p => (!comparisonOnly || scenario.products.includes(p.id)) && (category === "All products" || p.category === category) && `${p.name} ${p.category} ${p.color} ${p.detail} ${p.seller}`.toLowerCase().includes(query.toLowerCase()));
  function reset(id = scenarioId) { setHasRun(false);setComparisonOnly(true);setQuery("");setCategory("All products"); setScenarioId(id); setCart([]); setStage("browse"); setNotice(""); setDownload(false); setReviewed(false); }
  function run() { setHasRun(true);setComparisonOnly(true);setQuery("");setCategory("All products"); setCart([...scenario.products]); setStage("browse"); setDownload(false); setReviewed(false); setNotice(scenario.id === "stock" ? "Demo agent: the desk kit is unavailable. I found an in-stock lamp and workspace templates within your budget." : "Demo agent: I checked the listed stock, product attributes and delivery estimates. Your shortlist is ready to review."); }
  function add(p: DemoProduct) { if (!p.stock || locked) return; setCart(v => v.includes(p.id) ? v : [...v, p.id]); setStage("browse"); setNotice(`${p.name} added to your demo shortlist.`); }
  function order() { if (!quote.valid) return; setStage(quote.needsApproval ? "approval" : "ordered"); setNotice(quote.needsApproval ? "The simulated purchase is held for the owner. No payment or fulfillment has occurred." : "Demo order created. Each seller has its own order item; digital delivery is ready and physical items have simulated tracking."); }
  return <div className="market-workspace market-demo">
    <div className="market-demo-heading"><div><h1>{scenarioId === "hiking" ? "A hiking gift, handled thoughtfully." : scenario.title}</h1><p>Compare the details. Stay in control of the purchase.</p></div><span className="pill">Demo catalog</span></div>
    <p className="market-demo-disclosure">Demo scenario · Fictional listings, stock and reviews. Purchases are simulated; no money moves.</p>
    <div className="studio-shopping-layout"><aside className="studio-brief"><section className="market-demo-agent" aria-label="Shopping scenario">
      <div><h2>Your shopping brief</h2><label htmlFor="demo-scenario">Try a shopping scenario</label><select id="demo-scenario" value={scenarioId} onChange={e => reset(e.target.value)}>{DEMO_SCENARIOS.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select><label htmlFor="studio-shopping-brief">Scenario brief</label><textarea id="studio-shopping-brief" value={scenario.brief} readOnly rows={4}/><button onClick={run}>Run demo agent <Icon name="arrowRight" size={16}/></button></div>
      <dl><dt>Owner’s budget</dt><dd>{demoPrice(scenario.budget)}</dd><dt>Approval required above</dt><dd>{demoPrice(scenario.approvalAbove)}</dd><dt>Payment mode</dt><dd>Simulation only</dd></dl>
    </section>
    <section className="studio-agent-progress" aria-label="Demo agent progress"><h2>Agent progress</h2><ol>{["Check product details", "Compare available stock", "Prepare a quote"].map((label,i)=><li key={label} className={hasRun ? "is-complete" : ""}><Icon name={hasRun ? "check" : "clock"} size={17}/><div><strong>{label}</strong><span>{hasRun ? i === 2 ? "Shortlist ready for your review" : "Checked in this demo scenario" : "Waiting for you to run the scenario"}</span></div></li>)}</ol></section><p className="studio-demo-note">Assistant simulation. Your budget and approval threshold are shown above; no money moves.</p></aside><div className="studio-results">
    {notice && <p className="market-notice" role="status">{notice}</p>}
    <div className="market-demo-layout"><section className="market-demo-browse" aria-label="Demo product listings">
      <div className="market-section-heading"><h2>{comparisonOnly ? "Compare your options" : "Browse demo products"}</h2><button className="studio-text-button" onClick={()=>setComparisonOnly(v=>!v)}>{comparisonOnly ? "Browse all products" : "Compare scenario picks"}</button></div>
<div className="studio-catalog-toolbar">      <label className="market-demo-search"><Icon name="search" size={18}/><span className="market-visually-hidden">Search demo products</span><input type="search" placeholder="Search products, software, colors or sellers" value={query} onChange={e => {setQuery(e.target.value);setComparisonOnly(false);}}/></label>
<label className="studio-category-filter">Category<select value={category} onChange={e=>{setCategory(e.target.value);setComparisonOnly(false);}}>{["All products", "Outdoors", "Electronics", "Home & living", "Software", "Digital goods"].map(c=><option key={c}>{c}</option>)}</select></label></div>      <div className="market-demo-products">{products.map(p => <article key={p.id} className="market-product">
        <div className={`market-demo-image ${p.image === null ? "is-digital" : ""}`}>{p.image !== null ? <img src="/marketplace/demo-collection.webp" alt={`Illustration of ${p.name}`} width={1536} height={1024} loading="lazy" style={{left: `${-(p.image % 2) * 100}%`, top: `${-Math.floor(p.image / 2) * 100}%`}}/> : <div><Icon name={p.id === "software" ? "sliders" : "list"} size={36}/><strong>{p.id === "software" ? "Focus workspace" : "Weekend trails"}</strong><span>{p.id === "software" ? "Software templates" : "Digital field guide"}</span></div>}<span className="market-demo-image-label">{p.kind === "digital" ? "Digital" : "Demo product"}</span></div>
        <div className="market-product-copy"><p>{p.seller}</p><h3>{p.name}</h3><strong>{demoPrice(p.price)}</strong><dl className="studio-product-facts"><dt>Availability</dt><dd>{p.stock ? `${p.stock} in stock` : "Out of stock"}</dd><dt>Color / format</dt><dd>{p.color}</dd><dt>Delivery</dt><dd>{p.delivery}</dd></dl><details><summary>Product details</summary><p>{p.detail}</p><p>Fictional listing information for this demonstration.</p></details><button disabled={!p.stock || locked || cart.includes(p.id)} onClick={() => add(p)}>{!p.stock ? "Out of stock" : cart.includes(p.id) ? "In shortlist" : "Add to shortlist"}</button></div>
      </article>)}</div>{!products.length && <p role="status" className="market-empty">No demo products match. Try another category or search term.</p>}
    </section><aside className="market-demo-summary" aria-label="Demo purchase summary"><h2>Your shortlist</h2>{cart.length ? <><ul>{quote.items.map(p => <li key={p.id}><div><strong>{p.name}</strong><span>{p.seller}</span></div><span>{demoPrice(p.price)}</span>{!locked && <button className="market-demo-remove" onClick={() => {setCart(v => v.filter(id => id !== p.id)); setStage("browse");}} aria-label={`Remove ${p.name}`}>Remove</button>}</li>)}</ul><dl><dt>Products</dt><dd>{demoPrice(quote.subtotal)}</dd><dt>Simulated shipping</dt><dd>{demoPrice(quote.shipping)}</dd><dt>Total · demo tax 0</dt><dd>{demoPrice(quote.total)}</dd><dt>Budget remaining</dt><dd>{demoPrice(scenario.budget - quote.total)}</dd></dl>{!quote.valid && <p role="alert">This shortlist exceeds the budget or contains unavailable stock. Remove an item before continuing.</p>}
      {stage === "browse" && <button disabled={!quote.valid} onClick={() => setStage("quote")}>Review demo quote</button>}
      {stage === "quote" && <div><h3>Review before purchase</h3><p>{quote.items.length} items across {new Set(quote.items.map(p => p.seller)).size} sellers. {physical ? "Physical goods use simulated escrow and tracking." : "Digital files arrive immediately in this demo."}</p><button disabled={!quote.valid} onClick={order}>Confirm simulated purchase</button></div>}
      {stage === "approval" && <div><h3>Waiting for owner approval</h3><p>The total is above the scenario’s approval threshold.</p><button onClick={() => {setStage("ordered");setNotice("Demo owner approved. The simulated order can now be fulfilled.");}}>Approve as demo owner</button><button onClick={() => {setStage("browse");setNotice("Demo purchase declined. No stock or funds changed.");}}>Decline</button></div>}
      {(stage === "ordered" || stage === "received") && <div className="market-demo-receipt"><h3>Demo order · {stage === "received" || !physical ? "delivered" : "in progress"}</h3><p>Simulated payment: {physical && stage !== "received" ? "held in escrow for physical items" : "settled"}.</p>{digital && <><p>Digital items: ready to retrieve.</p><button onClick={() => setDownload(true)}>Retrieve demo files</button></>}{physical && <><p>Physical items: {stage === "received" ? "receipt confirmed · escrow released" : "shipped · DEMO-TRACK-2048"}.</p>{stage === "ordered" && <button onClick={() => {setStage("received");setNotice("Demo buyer confirmed delivery. Simulated escrow was released to the physical seller.");}}>Simulate receipt and release</button>}</>}{(stage === "received" || !physical) && <button disabled={reviewed} onClick={() => {setReviewed(true);setNotice("Demo purchase review recorded for this scenario only.");}}>{reviewed ? "Demo review recorded" : "Record a demo purchase review"}</button>}{download && <pre className="market-delivery">{`ABI DEMO DELIVERY\n${quote.items.filter(p => p.kind === "digital").map(p => p.name).join("\n")}\nSample files only. No real license or paid content.`}</pre>}</div>}
      </> : <p>Add a product or run a scenario. Your agent checks the details before you approve a purchase.</p>}
      <button className="market-demo-reset" onClick={() => reset()}>Reset demo</button><p className="market-fine">Demo progress resets when you leave this tab. Switch to the live marketplace for real seller listings and durable orders.</p>
    </aside></div></div></div>
  </div>;
}
