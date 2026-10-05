import { NextResponse } from 'next/server';
import { getPublicDb } from '@/lib/db/public';
type Rpc = (name:string,args?:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string}|null}>;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request:Request) {
 try { const body=await request.json() as Record<string,unknown>; const siteId=String(body.siteId??''); const visitorKey=String(body.visitorKey??''); const message=String(body.message??'').trim();
  if(!ID.test(siteId)||!ID.test(visitorKey)||!message||message.length>2000) return NextResponse.json({error:'Message rejected.'},{status:400});
  const db=getPublicDb(); const rpc=db.rpc.bind(db) as unknown as Rpc;
  const rate=await rpc('consume_public_communication_rate_limit',{p_site_id:siteId,p_visitor_key:visitorKey}); const row=Array.isArray(rate.data)?rate.data[0] as {allowed?:boolean;retry_after?:number}:null; if(rate.error||!row?.allowed)return NextResponse.json({error:'Please wait before sending another message.'},{status:429,headers:{'Retry-After':String(row?.retry_after??60)}});
  const deployment=await rpc('public_assistant_deployment',{p_site_id:siteId}); if(deployment.error||!deployment.data) return NextResponse.json({error:'Messaging is unavailable.'},{status:404});
  const saved=await rpc('record_public_communication',{p_site_id:siteId,p_visitor_key:visitorKey,p_body:message}); if(saved.error) return NextResponse.json({error:'Message could not be recorded.'},{status:403});
  const configured=deployment.data as {deploymentId:string;handoffMessage:string}; const api=process.env.ASSISTANT_API_URL; const secret=process.env.PUBLIC_CHAT_API_SECRET;
  if(!api||!secret) { await rpc('record_public_communication_reply',{p_site_id:siteId,p_visitor_key:visitorKey,p_body:configured.handoffMessage,p_handoff:true}); return NextResponse.json({answer:configured.handoffMessage,unavailable:true,handoff:true}); }
  const reply=await fetch(`${api.replace(/\/$/,'')}/public_chat`,{method:'POST',headers:{'content-type':'application/json','x-gold-public-chat-key':secret},body:JSON.stringify({message,deploymentId:configured.deploymentId}),signal:AbortSignal.timeout(60_000)});
  if(!reply.ok) { await rpc('record_public_communication_reply',{p_site_id:siteId,p_visitor_key:visitorKey,p_body:configured.handoffMessage,p_handoff:true}); return NextResponse.json({answer:configured.handoffMessage,unavailable:true,handoff:true}); }
  const response=await reply.json() as {answer?:string;handoff?:boolean}; const handoff=Boolean(response.handoff); const answer=String(response.answer??configured.handoffMessage).slice(0,4000); await rpc('record_public_communication_reply',{p_site_id:siteId,p_visitor_key:visitorKey,p_body:answer,p_handoff:handoff}); return NextResponse.json({answer,handoff});
 } catch { return NextResponse.json({error:'Messaging is unavailable.'},{status:503}); }
}
