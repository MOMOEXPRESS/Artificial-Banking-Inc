import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createMarketplace, CommerceError, type CommerceDatabase, type CommerceAdapters } from "./marketplace.js";

function fixture(overrides: CommerceAdapters = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE products(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,name TEXT,description TEXT,category TEXT,price_micro TEXT,currency TEXT,stock_level INTEGER,vendor_id TEXT,images_json TEXT,attributes_json TEXT,created_at TEXT,updated_at TEXT);`);
  let time = Date.now();
  const calls: string[] = [];
  const offers = new Map<string, { orgId: string; priceMicro: string; endpointUrl: string; currency: string; published: boolean; network: string }>();
  const adapters: CommerceAdapters = {
    now: () => time,
    sellerReady: () => true,
    offer: (id) => offers.get(id),
    payment: async (_actor,input) => {calls.push(input.idempotencyKey);return {status:200,body:{ok:true,txHash:"0xreceipt",resource:{content:{license:"purchased-content"}}}};},
    ...overrides,
  };
  const m = createMarketplace(db as unknown as CommerceDatabase,adapters);
  const a = {orgId:"buyer",agentId:"agent"};
  const product = (org="seller",extra:Record<string,unknown>={}) => {
    m.submitVendor(org,{legalName:"Vendor",country:"FR",registration:"REG-1",contact:"seller@example.com"});
    m.verifyVendor("reviewer",org,{status:"verified",reference:"reviewed evidence"});
    offers.set(`offer-${org}`,{orgId:org,priceMicro:"1000000",endpointUrl:`https://${org}.example/item`,currency:"USDC",published:true,network:"base-sepolia"});
    const p=m.saveProduct(org,{name:"Trail backpack",description:"A green backpack for hiking",category:"outdoor",kind:"digital",priceMicro:"1000000",currency:"USDC",stockLevel:2,images:["https://images.example/backpack.jpg"],attributes:{colors:["green"],sizes:["28L"],regions:["EU"],deliveryDays:3,useCases:["hiking","gift"]},offerId:`offer-${org}`,...extra});
    m.publish(org,p.id,true);return p;
  };
  const cart = (productId:string,actor=a) => {const c=m.cart(actor);m.setCart(actor,c.id,{productId,quantity:1,revision:1});return c;};
  const order = (productId:string,key="checkout-1",actor=a) => {const c=cart(productId,actor);const q=m.quote(actor,c.id);return m.checkout(actor,q.id,key);};
  return {db,m,a,calls,offers,product,cart,order,adapters,advance:(ms:number)=>{time+=ms;}};
}

test("products bind vendor identity to the authenticated seller and publish only after review",()=>{
  const f=fixture();const p=f.product();assert.equal(p.vendorId,"seller");assert.equal(f.m.product(p.id).vendor.status,"verified");
  assert.throws(()=>f.m.saveProduct("other",{name:"Hijack"},p.id),/not found/);
  assert.throws(()=>f.m.verifyVendor("seller","seller",{status:"verified",reference:"self"}),/themselves/);
  f.m.verifyVendor("reviewer","seller",{status:"suspended",reference:"case"});
  assert.throws(()=>f.m.product(p.id),/not found/);
});
test("unverified vendor and mismatched payment offer cannot publish",()=>{
  const f=fixture();const p=f.product();f.offers.get("offer-seller")!.priceMicro="2000000";
  assert.throws(()=>f.m.publish("seller",p.id,true),/exact product price/);
});
test("agent-readable catalog returns live stock, appearance, provenance and no invented ratings",()=>{
  const f=fixture();const p=f.product();const value=f.m.product(p.id);
  assert.equal(value.availability.availableUnits,2);assert.deepEqual(value.appearance.colors,["green"]);
  assert.equal(value.quality.humanReviews.average,null);assert.equal(value.delivery.estimatedDays,3);
  assert.equal(value.appearance.source,"seller-provided");assert.equal(value.schemaVersion,"abi.marketplace.v1");
});
test("vague discovery expands hiking intent while respecting price, region, color and availability",()=>{
  const f=fixture();f.product();assert.equal(f.m.search({q:"a gift for someone who likes hiking",color:"green",region:"EU"}).total,1);
  assert.equal(f.m.search({q:"hiking",maxPriceMicro:"1"}).total,0);assert.equal(f.m.search({color:"red"}).total,0);
});
test("cart revision protects stale edits and agents cannot access another agent's cart",()=>{
  const f=fixture();const p=f.product();const c=f.cart(p.id);
  assert.throws(()=>f.m.setCart(f.a,c.id,{productId:p.id,quantity:1,revision:1}),/Refresh/);
  assert.throws(()=>f.m.cart({...f.a,agentId:"other"},c.id),/not found/);
});
test("checkout is durable across service instances and idempotent",()=>{
  const f=fixture();const p=f.product();const c=f.cart(p.id),q=f.m.quote(f.a,c.id);
  const o=f.m.checkout(f.a,q.id,"key");const second=createMarketplace(f.db as unknown as CommerceDatabase,f.adapters);
  assert.equal(second.checkout(f.a,q.id,"key").id,o.id);assert.equal(second.product(p.id).availability.availableUnits,1);
  assert.throws(()=>second.checkout(f.a,"different","key"),/different quote/);
});
test("last-unit race has one successful checkout and no overselling",()=>{
  const f=fixture();const p=f.product("seller",{stockLevel:1});const a=f.cart(p.id),b=f.cart(p.id,{orgId:"buyer2",agentId:"agent2"});
  const qa=f.m.quote(f.a,a.id),qb=f.m.quote({orgId:"buyer2",agentId:"agent2"},b.id);
  f.m.checkout(f.a,qa.id,"first");assert.throws(()=>f.m.checkout({orgId:"buyer2",agentId:"agent2"},qb.id,"second"),/Stock changed/);
  assert.equal(f.m.product(p.id).availability.availableUnits,0);
});
test("expired quotes and changed listings never debit or reserve",()=>{
  const f=fixture();const p=f.product();const c=f.cart(p.id),q=f.m.quote(f.a,c.id);f.advance(11*60_000);
  assert.throws(()=>f.m.checkout(f.a,q.id,"expired"),/fresh quote/);assert.equal(f.m.product(p.id).availability.availableUnits,2);
});
test("digital payments use the governed adapter and entitlements survive service reload",async()=>{
  const f=fixture();const p=f.product();const o=f.order(p.id);await f.m.pay(f.a,o.id);await f.m.pay(f.a,o.id);
  assert.equal(f.calls.length,1);assert.equal(f.m.order(f.a.orgId,o.id).items[0].fulfillmentState,"delivered");
  const second=createMarketplace(f.db as unknown as CommerceDatabase,f.adapters);
  assert.deepEqual(second.delivery(f.a.orgId,o.items[0].id).content,{license:"purchased-content"});
  assert.throws(()=>second.delivery("other",o.items[0].id),/not found/);
});
test("unknown payment outcome retains stock and never becomes delivered on timeout",async()=>{
  const f=fixture({payment:async()=>{throw Error("network timeout");}});const p=f.product();const o=f.order(p.id);
  await assert.rejects(f.m.pay(f.a,o.id),/timeout/);f.advance(60*60_000);f.m.search();
  assert.equal(f.m.order(f.a.orgId,o.id).items[0].paymentState,"unknown");assert.equal(f.m.product(p.id).availability.availableUnits,1);
  assert.throws(()=>f.m.delivery(f.a.orgId,o.items[0].id),/No digital delivery/);
});
test("approval parks one stable item payment key and retry resolves to paid",async()=>{
  let calls=0;const keys:string[]=[];const f=fixture({payment:async(_a,i)=>{keys.push(i.idempotencyKey);return ++calls===1?{status:202,body:{outcome:"review",state:"awaiting_approval",approvalId:"approval"}}:{status:200,body:{ok:true,resource:{content:"license"}}};}});
  const p=f.product(),o=f.order(p.id);await f.m.pay(f.a,o.id);assert.equal(f.m.order(f.a.orgId,o.id).items[0].paymentState,"awaiting_approval");
  await f.m.pay(f.a,o.id);assert.equal(keys[0],keys[1]);assert.equal(f.m.order(f.a.orgId,o.id).items[0].paymentState,"paid");
});
test("multi-vendor order retains successful line when another vendor requires approval",async()=>{
  const f=fixture({payment:async(_a,i)=>i.endpointUrl.includes("second")?{status:202,body:{outcome:"review"}}:{status:200,body:{ok:true,resource:{content:"ok"}}}});
  const p=f.product(),p2=f.product("second");const c=f.cart(p.id);f.m.setCart(f.a,c.id,{productId:p2.id,quantity:1,revision:2});
  const q=f.m.quote(f.a,c.id),o=f.m.checkout(f.a,q.id,"multi");const paid=await f.m.pay(f.a,o.id);
  assert.deepEqual(paid.items.map(i=>i.paymentState).sort(),["awaiting_approval","paid"]);
});
test("expired unpaid reservation returns stock once and cancel never releases unknown payment",async()=>{
  const f=fixture();const p=f.product();const o=f.order(p.id);f.advance(16*60_000);f.m.search();f.m.search();
  assert.equal(f.m.product(p.id).availability.availableUnits,2);assert.equal(f.m.order(f.a.orgId,o.id).items[0].paymentState,"expired");
});
test("payment offer edits cannot redirect a previously quoted purchase",async()=>{
  const f=fixture();const p=f.product(),o=f.order(p.id);f.offers.get("offer-seller")!.endpointUrl="https://attacker.example";
  await assert.rejects(f.m.pay(f.a,o.id),/bound offer changed/);assert.equal(f.calls.length,0);
});
test("verified feedback separates human reviews and agent quality signals",async()=>{
  const f=fixture();const p=f.product(),o=f.order(p.id),item=o.items[0].id;
  assert.throws(()=>f.m.feedback(f.a.orgId,item,{score:5,body:"nice"},"agent",f.a.agentId),/paid, delivered/);
  await f.m.pay(f.a,o.id);f.m.feedback(f.a.orgId,item,{score:4,body:"meets specification"},"agent",f.a.agentId);
  assert.equal(f.m.quality(p.id).agentSignals.count,1);assert.equal(f.m.quality(p.id).humanReviews.count,0);
  assert.throws(()=>f.m.feedback(f.a.orgId,item,{score:5,body:"fake"},"agent","other"),/not found/);
});
test("disputes are participant-scoped and financial refunds cannot be fabricated",async()=>{
  const f=fixture();const p=f.product(),o=f.order(p.id);await f.m.pay(f.a,o.id);const c=f.m.openCase(f.a.orgId,o.items[0].id,{kind:"dispute",reason:"Wrong specification"});
  assert.throws(()=>f.m.caseMessage("stranger",c.id,"intrude"),/not found/);
  await assert.rejects(f.m.resolveCase("seller",c.id,{action:"close",resolution:"self"}),/own case/);
  await assert.rejects(f.m.resolveCase("reviewer",c.id,{action:"refund",resolution:"refund"}),/cannot fabricate/);
});
test("physical checkout fails closed without cross-vendor escrow, never uses same-org primitive",()=>{
  const f=fixture();const p=f.product("seller",{kind:"physical",offerId:undefined});const c=f.cart(p.id),q=f.m.quote(f.a,c.id);
  assert.throws(()=>f.m.checkout(f.a,q.id,"physical",{country:"FR"}), (e:unknown)=>e instanceof CommerceError&&e.code==="ESCROW_UNAVAILABLE");
  assert.equal(f.m.product(p.id).availability.availableUnits,2);
});
test("product input and preference records are bounded and session-scoped",()=>{
  const f=fixture();assert.throws(()=>f.product("seller",{priceMicro:"1.2"}),/integer USDC/);
  f.m.preferences(f.a,{region:"EU",colors:["green"],maxPriceMicro:"1000000"});assert.equal(f.m.preferences({...f.a,agentId:"other"}).region,undefined);
});

test("configured physical fulfillment funds cross-vendor escrow and releases only on buyer confirmation",async()=>{
  const released:string[]=[],funded:string[]=[],labels:string[]=[];
  const f=fixture({
    fulfillment:{quote:async()=>({reference:"shipping-quote",totalMicro:"1500000",expiresAt:Date.now()+120000})},
    escrow:{fund:async(_a,i)=>{funded.push(i.sellerOrgId);return {status:200,body:{state:"escrowed",escrowRef:"escrow-reference"}};},release:async(r)=>{released.push(r);},refund:async()=>{}},
    shipping:{label:async(i)=>{labels.push(i.idempotencyKey);return {carrier:"Test Carrier",tracking:"TRACK-1",labelUrl:"https://carrier.example/label"};}},
  });
  const p=f.product("outside-vendor",{kind:"physical",offerId:undefined});const c=f.cart(p.id);
  const address={name:"Buyer",line1:"1 Example Street",city:"Paris",postalCode:"75001",country:"FR"};
  const q=await f.m.shippingQuote(f.a,c.id,address);const o=f.m.checkout(f.a,q.id,"physical",address);
  const paid=await f.m.pay(f.a,o.id);assert.equal(paid.items[0].paymentState,"escrowed");assert.deepEqual(funded,["outside-vendor"]);
  assert.equal(released.length,0);await f.m.shippingLabel("outside-vendor",o.items[0].id);await f.m.shippingLabel("outside-vendor",o.items[0].id);assert.equal(labels.length,1);
  await f.m.confirm(f.a.orgId,o.items[0].id);assert.deepEqual(released,["escrow-reference"]);
  assert.equal(f.m.order(f.a.orgId,o.id).items[0].fulfillmentState,"delivered");
});
test("physical quotes bind shipping address and dispute blocks escrow release",async()=>{
  let released=0;
  const f=fixture({fulfillment:{quote:async()=>({reference:"quote",totalMicro:"1200000",expiresAt:Date.now()+120000})},escrow:{fund:async()=>({status:200,body:{state:"escrowed",escrowRef:"held"}}),release:async()=>{released++;},refund:async()=>{}}});
  const p=f.product("seller",{kind:"physical",offerId:undefined}),c=f.cart(p.id);const address={name:"B",line1:"1 Road",city:"Paris",postalCode:"75001",country:"FR"};
  const q=await f.m.shippingQuote(f.a,c.id,address);
  assert.throws(()=>f.m.checkout(f.a,q.id,"wrong",{...address,country:"US"}),/differs/);
  const o=f.m.checkout(f.a,q.id,"right",address);await f.m.pay(f.a,o.id);f.m.fulfill("seller",o.items[0].id,{state:"shipped",carrier:"Carrier",tracking:"track"});
  f.m.openCase(f.a.orgId,o.items[0].id,{kind:"dispute",reason:"Wrong goods"});await assert.rejects(f.m.confirm(f.a.orgId,o.items[0].id),/open case/);assert.equal(released,0);
});

test("carrier tracking is idempotent, rejects mismatches and never releases escrow",async()=>{
  let released=0;const f=fixture({fulfillment:{quote:async()=>({reference:"q",totalMicro:"1000000",expiresAt:Date.now()+120000})},escrow:{fund:async()=>({status:200,body:{state:"escrowed",escrowRef:"held"}}),release:async()=>{released++;},refund:async()=>{}}});
  const p=f.product("seller",{kind:"physical",offerId:undefined}),c=f.cart(p.id),address={name:"B",line1:"Road",city:"Paris",postalCode:"75001",country:"FR"};
  const q=await f.m.shippingQuote(f.a,c.id,address),o=f.m.checkout(f.a,q.id,"track",address);await f.m.pay(f.a,o.id);const item=o.items[0];f.m.fulfill("seller",item.id,{state:"shipped",carrier:"Carrier",tracking:"TRACK"});
  const event={eventId:"event-1",itemId:item.id,tracking:"TRACK",state:"delivered",observedAt:Date.now()};f.m.tracking(event);assert.equal(f.m.tracking(event).replayed,true);assert.equal(released,0);
  assert.equal(f.m.order(f.a.orgId,o.id).items[0].fulfillmentState,"shipped");
  assert.throws(()=>f.m.tracking({...event,state:"returned"}),/reused/);assert.throws(()=>f.m.tracking({...event,eventId:"event-2",tracking:"OTHER"}),/does not match/);
});
