import type express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { CommerceError, createMarketplace, type CommerceActor, type CommerceAdapters } from "./marketplace.js";
import { commerceDatabase, sellerStore, store, type OrgRow } from "./store.js";
import { partnerRoute } from "./routes/partner-auth-routes.js";
import { fetchNoRedirect } from "./outbound-url.js";
import { marketplaceProviderAdapters } from "./marketplace-providers.js";

type AgentAuth = CommerceActor & { scopes: string[] };
type GuardianRoute = (handler: (org: OrgRow, req: express.Request, res: express.Response) => unknown, opts?: { ownerOnly?: boolean }) => express.RequestHandler;

/** Register commerce without changing wallet, settlement or x402 implementations. */
export function registerMarketplaceRoutes(app: express.Express, deps: {
  guardianRoute: GuardianRoute;
  authAgent: (req: express.Request) => AgentAuth | null;
  payment: NonNullable<CommerceAdapters["payment"]>;
  adapters?: Pick<CommerceAdapters, "escrow" | "shipping" | "fulfillment">;
}) {
  const market = () => createMarketplace(commerceDatabase(), {
    ...marketplaceProviderAdapters(deps.payment),
    ...deps.adapters,
    payment: deps.payment,
    vendorName: (orgId) => store.getSellerProfile(orgId)?.displayName ?? orgId,
    sellerReady: (id) => Boolean(store.getSellerProfile(id)?.payoutAddress),
    offer: (id) => {
      const o = sellerStore.getOfferAnyOrg(id);
      return o ? { orgId: o.orgId, endpointUrl: o.endpointUrl, priceMicro: o.priceUsdcMicro, currency: "USDC", published: o.status === "published" && !o.archivedAt && (!o.sunsetAt || Date.parse(o.sunsetAt) > Date.now()) && (o.hosted || sellerStore.isVerifiedOwnerOffer(o)), network: o.network } : undefined;
    },
  });
  const safe = (fn: (req: express.Request, res: express.Response) => unknown): express.RequestHandler => (req,res) => {
    Promise.resolve().then(() => fn(req,res)).catch((e: unknown) => {
      if(e instanceof CommerceError) return res.status(e.status).json({error:{code:e.code,message:e.message}});
      req.log?.error({err:e},"marketplace route error");
      return res.status(500).json({error:{code:"MARKETPLACE_FAILED",message:"The marketplace operation failed; check order status before retrying a payment."}});
    });
  };
  const seller = (fn: (orgId: string,req:express.Request,res:express.Response)=>unknown) => partnerRoute((org,req,res) => safe((r,s)=>fn(org.id,r,s))(req,res,()=>{}));
  const guardian = (fn:(orgId:string,req:express.Request,res:express.Response)=>unknown,owner=false) => deps.guardianRoute((org,req,res)=>safe((r,s)=>fn(org.id,r,s))(req,res,()=>{}),{ownerOnly:owner});
  const agent = (scope:"read"|"pay",fn:(actor:AgentAuth,req:express.Request,res:express.Response)=>unknown) => safe((req,res)=>{
    const actor=deps.authAgent(req);
    if(!actor)return res.status(401).json({error:{code:"UNAUTHORIZED"}});
    if(!actor.scopes.includes(scope))return res.status(403).json({error:{code:"SCOPE_REQUIRED",required:scope}});
    return fn(actor,req,res);
  });
  const reviewer = (orgId:string) => {
    const reviewers=(process.env.ABI_MARKETPLACE_REVIEWER_ORGS??"").split(",").map(s=>s.trim()).filter(Boolean);
    if(!reviewers.includes(orgId))throw new CommerceError("FORBIDDEN","Marketplace reviewer role required",403);
  };
  app.get("/v1/marketplace/capabilities",safe((_req,res)=>res.json(market().capabilities())));
  app.post("/v1/marketplace/tracking",safe((req,res)=>{
    const secret=process.env.ABI_MARKETPLACE_TRACKING_SECRET,timestamp=req.header("x-abi-timestamp")??"",signature=req.header("x-abi-signature")??"";
    if(!secret)return res.status(503).json({error:{code:"TRACKING_NOT_CONFIGURED"}});
    if(!/^\d{10}$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300||!/^\w{64}$/.test(signature))return res.status(401).json({error:{code:"INVALID_SIGNATURE"}});
    const expected=createHmac("sha256",secret).update(`${timestamp}.${JSON.stringify(req.body)}`).digest("hex");
    if(!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return res.status(401).json({error:{code:"INVALID_SIGNATURE"}});
    return res.json(market().tracking(req.body));
  }));
  app.get("/v1/marketplace/products",safe((req,res)=>res.json(market().search(req.query))));
  app.get("/v1/marketplace/products/:id",safe((req,res)=>{
    const m=market(),value=m.product(String(req.params.id)),etag=`"${m.fingerprint(value.product)}"`;
    res.setHeader("Cache-Control","no-store");res.setHeader("ETag",etag);
    return res.json(value);
  }));
  app.get("/v1/marketplace/products/:id/images/:index",safe(async(req,res)=>{
    const value=market().product(String(req.params.id));
    const index=Number(req.params.index);
    if(!Number.isInteger(index)||index<0||index>=value.product.images.length)return res.sendStatus(404);
    const remote=await fetchNoRedirect(value.product.images[index],{signal:AbortSignal.timeout(8000)},"Marketplace image");
    const contentType=remote.headers.get("content-type")?.split(";")[0]??"";
    if(!remote.ok||!["image/png","image/jpeg","image/webp","image/avif","image/gif"].includes(contentType)||!remote.body)return res.sendStatus(502);
    const reader=remote.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const {done,value:chunk}=await reader.read();if(done)break;size+=chunk.byteLength;if(size>5*1024*1024){await reader.cancel();return res.sendStatus(413);}chunks.push(chunk);}}finally{reader.releaseLock();}
    res.setHeader("Content-Type",contentType);res.setHeader("Cache-Control","public, max-age=60");res.setHeader("X-Content-Type-Options","nosniff");return res.send(Buffer.concat(chunks));
  }));
  app.get("/v1/marketplace/vendors/:id",safe((req,res)=>res.json(market().vendor(String(req.params.id)))));
  app.get("/v1/marketplace/vendors/:id/products",safe((req,res)=>res.json(market().search({...req.query,vendorId:String(req.params.id)}))));
  app.get("/v1/marketplace/schema",safe((_req,res)=>res.json({
    $schema:"https://json-schema.org/draft/2020-12/schema",title:"ABI Marketplace Listing v1",type:"object",additionalProperties:false,
    required:["name","description","category","priceMicro","currency","stockLevel","kind","images","attributes"],
    properties:{name:{type:"string",maxLength:200},description:{type:"string",maxLength:4000},category:{type:"string",maxLength:80},priceMicro:{type:"string",pattern:"^[0-9]+$",description:"USDC micro-units, six decimals"},currency:{const:"USDC"},stockLevel:{type:"integer",minimum:0},kind:{enum:["digital","physical","service"]},offerId:{type:"string"},images:{type:"array",maxItems:20,items:{type:"string",format:"uri",pattern:"^https://"}},attributes:{type:"object",properties:{colors:{type:"array",items:{type:"string"}},sizes:{type:"array",items:{type:"string"}},regions:{type:"array",items:{type:"string"}},deliveryDays:{type:"integer",minimum:0,maximum:365},useCases:{type:"array",items:{type:"string"}}}}}}))); 
  app.get("/v1/seller/marketplace/vendor",seller((org,_req,res)=>res.json(market().vendor(org,true))));
  app.put("/v1/seller/marketplace/vendor",seller((org,req,res)=>res.json(market().submitVendor(org,req.body))));
  app.get("/v1/seller/marketplace/products",seller((org,_req,res)=>res.json({products:market().inventory(org)})));
  app.post("/v1/seller/marketplace/products",seller((org,req,res)=>res.status(201).json({product:market().saveProduct(org,req.body)})));
  app.put("/v1/seller/marketplace/products/:id",seller((org,req,res)=>res.json({product:market().saveProduct(org,req.body,String(req.params.id))})));
  app.post("/v1/seller/marketplace/products/:id/publish",seller((org,req,res)=>res.json(market().publish(org,String(req.params.id),req.body.published===true))));
  app.get("/v1/seller/marketplace/orders",seller((org,_req,res)=>res.json({items:market().orders(org,true)})));
  app.post("/v1/seller/marketplace/items/:id/fulfill",seller((org,req,res)=>res.json(market().fulfill(org,String(req.params.id),req.body))));
  app.post("/v1/seller/marketplace/items/:id/label",seller(async(org,req,res)=>res.json(await market().shippingLabel(org,String(req.params.id)))));
  app.get("/v1/seller/marketplace/cases",seller((org,_req,res)=>res.json({cases:market().cases(org)})));
  app.post("/v1/seller/marketplace/cases/:id/messages",seller((org,req,res)=>res.json(market().caseMessage(org,String(req.params.id),req.body.message))));
  app.post("/v1/seller/marketplace/cases/:id/return-received",seller((org,req,res)=>res.json(market().receiveReturn(org,String(req.params.id)))));
  app.post("/v1/guardian/marketplace/vendors/:id/review",guardian((org,req,res)=>{reviewer(org);return res.json(market().verifyVendor(org,String(req.params.id),req.body));},true));
  app.post("/v1/guardian/marketplace/cases/:id/resolve",guardian(async(org,req,res)=>{reviewer(org);return res.json(await market().resolveCase(org,String(req.params.id),req.body));},true));
  app.get("/v1/guardian/marketplace/orders",guardian((org,_req,res)=>res.json({orders:market().orders(org)})));
  app.get("/v1/guardian/marketplace/orders/:id",guardian((org,req,res)=>res.json(market().order(org,String(req.params.id)))));
  app.post("/v1/guardian/marketplace/items/:id/confirm",guardian(async(org,req,res)=>res.json(await market().confirm(org,String(req.params.id))),true));
  app.get("/v1/guardian/marketplace/items/:id/delivery",guardian((org,req,res)=>res.json(market().delivery(org,String(req.params.id)))));
  app.post("/v1/guardian/marketplace/items/:id/review",guardian((org,req,res)=>{
    const ctx=(req as express.Request & {guardianCtx?:{via:string}}).guardianCtx;
    if(ctx?.via!=="session")return res.status(403).json({error:{code:"HUMAN_SESSION_REQUIRED",message:"Human reviews require a signed-in person; agents submit quality signals."}});
    return res.json(market().feedback(org,String(req.params.id),req.body,"human"));
  }));
  app.post("/v1/guardian/marketplace/items/:id/cases",guardian((org,req,res)=>res.status(201).json(market().openCase(org,String(req.params.id),req.body))));
  app.get("/v1/guardian/marketplace/cases",guardian((org,_req,res)=>res.json({cases:market().cases(org)})));
  app.post("/v1/guardian/marketplace/cases/:id/messages",guardian((org,req,res)=>res.json(market().caseMessage(org,String(req.params.id),req.body.message))));
  app.post("/v1/guardian/marketplace/cases/:id/return-label",guardian(async(org,req,res)=>res.json(await market().returnLabel(org,String(req.params.id)))));
  app.get("/v1/agent/marketplace/preferences",agent("read",(a,_req,res)=>res.json(market().preferences(a))));
  app.put("/v1/agent/marketplace/preferences",agent("pay",(a,req,res)=>res.json(market().preferences(a,req.body))));
  app.post("/v1/agent/marketplace/compare",agent("read",(_a,req,res)=>res.json(market().compare(req.body.productIds))));
  app.post("/v1/agent/marketplace/carts",agent("pay",(a,_req,res)=>res.status(201).json(market().cart(a))));
  app.get("/v1/agent/marketplace/carts/:id",agent("read",(a,req,res)=>res.json(market().cart(a,String(req.params.id)))));
  app.put("/v1/agent/marketplace/carts/:id/items",agent("pay",(a,req,res)=>res.json(market().setCart(a,String(req.params.id),req.body))));
  app.post("/v1/agent/marketplace/carts/:id/quote",agent("pay",(a,req,res)=>res.json(market().quote(a,String(req.params.id)))));
  app.post("/v1/agent/marketplace/carts/:id/shipping-quote",agent("pay",async(a,req,res)=>res.json(await market().shippingQuote(a,String(req.params.id),req.body.shippingAddress))));
  app.post("/v1/agent/marketplace/checkout",agent("pay",(a,req,res)=>res.status(201).json(market().checkout(a,req.body.quoteId,req.body.idempotencyKey,req.body.shippingAddress))));
  app.get("/v1/agent/marketplace/orders",agent("read",(a,_req,res)=>res.json({orders:market().orders(a.orgId,false,a.agentId)})));
  app.get("/v1/agent/marketplace/orders/:id",agent("read",(a,req,res)=>res.json(market().order(a.orgId,String(req.params.id),a.agentId))));
  app.post("/v1/agent/marketplace/orders/:id/pay",agent("pay",async(a,req,res)=>res.json(await market().pay(a,String(req.params.id)))));
  app.post("/v1/agent/marketplace/orders/:id/cancel",agent("pay",(a,req,res)=>res.json(market().cancel(a.orgId,String(req.params.id),a.agentId))));
  app.get("/v1/agent/marketplace/items/:id/delivery",agent("read",(a,req,res)=>{
    return res.json(market().delivery(a.orgId,String(req.params.id),a.agentId));
  }));
  app.post("/v1/agent/marketplace/items/:id/signal",agent("pay",(a,req,res)=>res.json(market().feedback(a.orgId,String(req.params.id),req.body,"agent",a.agentId))));
}
