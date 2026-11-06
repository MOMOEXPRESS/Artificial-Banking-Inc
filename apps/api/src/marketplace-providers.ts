/** Optional fulfillment/escrow integration. No signing keys or model authority leave ABI. */
import { CommerceError, type CommerceAdapters } from "./marketplace.js";
import { fetchNoRedirect, outboundUrlProblem } from "./outbound-url.js";

type Json=Record<string,unknown>;
const required=(value:unknown,name:string)=>{if(typeof value!=="string"||!value||value.length>2000)throw new CommerceError("PROVIDER_INVALID",`Provider omitted ${name}`,502);return value;};
export function marketplaceProviderAdapters(payment:NonNullable<CommerceAdapters["payment"]>):Pick<CommerceAdapters,"escrow"|"shipping"|"fulfillment">{
  const base=process.env.ABI_MARKETPLACE_PROVIDER_URL?.replace(/\/$/,""),token=process.env.ABI_MARKETPLACE_PROVIDER_TOKEN;
  if(!base||!token)return {};
  const problem=outboundUrlProblem(base,"Marketplace provider");
  if(problem||!base.startsWith("https://"))return {};
  const call=async(path:string,input:unknown):Promise<Json>=>{
    const response=await fetchNoRedirect(`${base}${path}`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(input),signal:AbortSignal.timeout(20000)},"Marketplace provider");
    if(!response.ok)throw new CommerceError("PROVIDER_UNAVAILABLE","The configured fulfillment provider did not complete the request",503);
    const data=await response.json();if(!data||typeof data!=="object"||Array.isArray(data))throw new CommerceError("PROVIDER_INVALID","Invalid provider response",502);return data as Json;
  };
  return {
    fulfillment:{quote:async(input)=>{const r=await call("/quotes",input);if(typeof r.expiresAt!=="number")throw new CommerceError("PROVIDER_INVALID","Quote expiry missing",502);return {reference:required(r.reference,"reference"),totalMicro:required(r.totalMicro,"totalMicro"),expiresAt:r.expiresAt};}},
    shipping:{label:async(input)=>{const r=await call("/shipping/labels",input);return {carrier:required(r.carrier,"carrier"),tracking:required(r.tracking,"tracking"),labelUrl:required(r.labelUrl,"labelUrl")};},returnLabel:async(input)=>{const r=await call("/returns/labels",input);return {carrier:required(r.carrier,"carrier"),tracking:required(r.tracking,"tracking"),labelUrl:required(r.labelUrl,"labelUrl")};}},
    escrow:{
      fund:async(actor,input)=>{
        const prepared=await call("/escrow/prepare",{...input,buyerOrgId:actor.orgId,agentId:actor.agentId});
        const reference=required(prepared.reference,"reference"),endpoint=required(prepared.endpointUrl,"endpointUrl");
        if(outboundUrlProblem(endpoint,"Escrow payment"))throw new CommerceError("PROVIDER_INVALID","Invalid escrow endpoint",502);
        // Funding still passes the unchanged deterministic policy and x402 path.
        const result=await payment(actor,{endpointUrl:endpoint,priceMicro:input.amountMicro,idempotencyKey:input.idempotencyKey,orderId:input.orderId});
        if(result.status!==200)return result;
        const receipt=await call("/escrow/status",{reference,itemId:input.itemId});
        if(receipt.state!=="funded"||receipt.sellerOrgId!==input.sellerOrgId||receipt.amountMicro!==input.amountMicro||receipt.itemId!==input.itemId) return {status:202,body:{state:"outcome_unknown",intentId:result.body.intentId,message:"Payment may have settled; escrow funding is not confirmed. Recheck the same order."}};
        return {status:200,body:{...result.body,state:"escrowed",escrowRef:reference}};
      },
      release:async(reference,idempotencyKey)=>{const r=await call("/escrow/release",{reference,idempotencyKey});if(r.state!=="released")throw new CommerceError("ESCROW_UNCONFIRMED","Escrow release is not confirmed; recheck before retrying",503);},
      refund:async(reference,idempotencyKey)=>{const r=await call("/escrow/refund",{reference,idempotencyKey});if(r.state!=="refunded")throw new CommerceError("REFUND_UNCONFIRMED","Refund is not confirmed; recheck before retrying",503);},
    },
  };
}
