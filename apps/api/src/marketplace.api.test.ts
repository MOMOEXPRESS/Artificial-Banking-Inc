import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after,before,test } from "node:test";
const directory=mkdtempSync(join(tmpdir(),"abi-marketplace-api-"));
process.env.POLICYVAULT_DB=join(directory,"market.db");
process.env.ABI_KEY_PEPPER="marketplace-test-pepper";
process.env.ABI_NO_LISTEN="1";
process.env.POLICYVAULT_MOCK_TRANSFER="1";
process.env.ABI_CHAT_LLM="0";
process.env.ABI_CHAT_AGENT="0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP="0";
process.env.ABI_MARKETPLACE_REVIEWER_ORGS="";
process.env.ABI_MARKETPLACE_PROVIDER_URL="";
process.env.ABI_MARKETPLACE_PROVIDER_TOKEN="";
process.env.ABI_MARKETPLACE_TRACKING_SECRET="";
const {store}=await import("./store.js");
const {app}=await import("./index.js");
let base="",server:ReturnType<typeof app.listen>;
before(async()=>{server=app.listen(0);await new Promise<void>(resolve=>server.once("listening",resolve));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;});
after(()=>{server?.close();rmSync(directory,{recursive:true,force:true});});
const request=(path:string,key?:string,body?:unknown)=>fetch(base+path,{method:body===undefined?"GET":"POST",headers:{...(key?{authorization:`Bearer ${key}`}:{}) ,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
test("public listing schema, empty catalog and capabilities are usable without seller credentials",async()=>{
  const schema=await request("/v1/marketplace/schema");assert.equal(schema.status,200);assert.equal((await schema.json() as {properties:{currency:{const:string}}}).properties.currency.const,"USDC");
  const products=await request("/v1/marketplace/products?q=hiking");assert.equal(products.status,200);assert.equal((await products.json() as {total:number}).total,0);
  const capabilities=await request("/v1/marketplace/capabilities");assert.equal((await capabilities.json() as {physicalEscrow:boolean}).physicalEscrow,false);
});
test("anonymous checkout, seller product creation and reviewer writes are denied",async()=>{
  assert.equal((await request("/v1/agent/marketplace/checkout",undefined,{})).status,401);
  assert.equal((await request("/v1/seller/marketplace/products",undefined,{})).status,401);
  const org=store.createOrg("Buyer",0n);
  assert.equal((await request("/v1/guardian/marketplace/vendors/seller/review",org.guardianKey,{status:"verified",reference:"self"})).status,403);
});
test("agent carts cannot be read by another agent in the same organization or a different organization",async()=>{
  const org=store.createOrg("Buyer",0n),other=store.createOrg("Other",0n);
  const a=store.createAgent(org.id,"A"),b=store.createAgent(org.id,"B"),c=store.createAgent(other.id,"C");
  const created=await request("/v1/agent/marketplace/carts",a.apiKey,{});assert.equal(created.status,201);const cart=await created.json() as {id:string};
  assert.equal((await request(`/v1/agent/marketplace/carts/${cart.id}`,a.apiKey)).status,200);
  assert.equal((await request(`/v1/agent/marketplace/carts/${cart.id}`,b.apiKey)).status,404);
  assert.equal((await request(`/v1/agent/marketplace/carts/${cart.id}`,c.apiKey)).status,404);
});
test("unconfigured tracking refuses webhook data rather than trusting a carrier claim",async()=>{
  assert.equal((await request("/v1/marketplace/tracking",undefined,{eventId:"fake",state:"delivered"})).status,503);
});
