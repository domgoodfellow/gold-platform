import {randomUUID} from 'node:crypto';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {Client} from 'pg';
import {describe,it,expect} from 'vitest';
import {recordCommercialTerm} from '@/lib/domain/commercial/terms';
import {setModuleEnabled} from '@/lib/domain/tenancy/modules';
import {asPlatformStaff,foundBusiness} from '@/tests/support/founding';
import {saveBusinessProfile,getBusinessProfile} from '@/lib/domain/tenancy/business-profile';
import {createRoute} from '@/lib/domain/reception/routing';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = { db: SupabaseClient; email: string; userId: string; organizationId: string };

async function account(label: string): Promise<{ db: SupabaseClient; email: string; userId: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;

  return { db, email, userId: created.user.id };
}

async function newTenant(label: string): Promise<Tenant> {
  const { db, email, userId } = await account(label);
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 8)}`, currency: 'XXX' });
  return { db, email, userId, organizationId };
}


const CONNECTION=process.env.SUPABASE_DB_URL??'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
describe('business foundations database boundaries',()=>{
 it('saves one revision, rejects stale/invalid/foreign writes and hides foreign profiles',async()=>{
   const mine=await newTenant('profile');const other=await newTenant('foreign-profile');
   const profile={revision:0,nouns:{customer:{singular:'Patient',plural:'Patients'}},navigation:['customers','calls'],labels:{calls:'Phone desk'}};
   await saveBusinessProfile(mine.db,mine.organizationId,profile);
   expect((await getBusinessProfile(mine.db,mine.organizationId))?.revision).toBe(1);
   await expect(saveBusinessProfile(mine.db,mine.organizationId,profile)).rejects.toThrow(/changed|reload/i);
   await expect(saveBusinessProfile(mine.db,mine.organizationId,{...profile,revision:1,navigation:['https://evil.test']})).rejects.toThrow();
   await expect(saveBusinessProfile(other.db,mine.organizationId,{...profile,revision:1})).rejects.toThrow();
   expect(await getBusinessProfile(other.db,mine.organizationId)).toBeNull();
   const direct=await mine.db.from('organization_business_profiles').update({revision:99}).eq('organization_id',mine.organizationId);
   expect(direct.error).not.toBeNull();
   const configure=await mine.db.rpc('configure_voice_receptionist',{p_organization_id:mine.organizationId,p_revision:0,p_deployment_ref:'published-v1',p_enabled:true,p_max_seconds:300,p_budget_seconds:0});
   expect(configure.error).toBeNull();
   const foreign=await other.db.rpc('configure_voice_receptionist',{p_organization_id:mine.organizationId,p_revision:1,p_deployment_ref:'foreign',p_enabled:true,p_max_seconds:300,p_budget_seconds:1000});
   expect(foreign.error?.code).toBe('42501');
   expect((await mine.db.rpc('voice_agent_session_overview')).error?.code).toBe('42501');
   const operations=await (await asPlatformStaff()).rpc('voice_agent_session_overview');
   expect(operations.error).toBeNull();
   expect(JSON.stringify(operations.data)).not.toContain('connection_url');
 });
 it('binds inbound retries, freezes cursors, refuses foreign routes and never resurrects a terminal call',async()=>{
   const tenant=await newTenant('inbound');const other=await newTenant('other-route');
   const route=await createRoute(tenant.db,{organizationId:tenant.organizationId,name:'Main',numberId:null,whenMode:'always',ringStrategy:'round_robin',ringTimeoutSeconds:20,destinationType:'members',fallbackType:'none'});
   const foreign=await createRoute(other.db,{organizationId:other.organizationId,name:'Other',numberId:null,whenMode:'always',ringStrategy:'everyone',ringTimeoutSeconds:20,destinationType:'members',fallbackType:'none'});
   const pg=new Client(CONNECTION);await pg.connect();await pg.query('begin');
   try{
     const binding=(await pg.query("insert into public.organization_provider_bindings(organization_id,provider_key,external_account_id,status) values($1,'twilio','account-test','active') returning id",[tenant.organizationId])).rows[0].id;
     const resource=(await pg.query("insert into public.organization_provider_resources(organization_id,binding_id,resource_type,external_id) values($1,$2,'twilio_phone_number',$3) returning id",[tenant.organizationId,binding,randomUUID()])).rows[0].id;
     const number='+1999'+String(Date.now()).slice(-8);
     await pg.query("insert into public.phone_numbers(organization_id,e164,origin,provider_resource_id,voice_inbound_enabled) values($1,$2,'provisioned',$3,true)",[tenant.organizationId,number,resource]);
     await pg.query('set local role voice_webhook');
     const args=['CA'+randomUUID(),number,'+14165550000','account-test'];
     const read=async()=> (await pg.query('select public.refresh_inbound_routing($1,$2,$3,$4) as context',args)).rows[0].context;
     const first=await read();expect(first.organization_id).toBe(tenant.organizationId);expect((await read()).call_id).toBe(first.call_id);
     expect((await pg.query('select public.refresh_inbound_routing($1,$2,$3,$4) as context',[...args.slice(0,3),'foreign-account'])).rows[0].context).toBeNull();
     const cursor=async()=> (await pg.query('select public.claim_inbound_route_cursor($1,$2) as cursor',[first.call_id,route])).rows[0].cursor;
     expect(await cursor()).toBe(await cursor());
     await pg.query('savepoint foreign_route');
     await expect(pg.query('select public.claim_inbound_route_cursor($1,$2)',[first.call_id,foreign])).rejects.toMatchObject({code:'42501'});
     await pg.query('rollback to savepoint foreign_route');await pg.query('reset role');
     await pg.query("update public.calls set status='completed',ended_at=now() where id=$1",[first.call_id]);
     await pg.query('set local role voice_webhook');expect(await read()).toBeNull();
   }finally{await pg.query('rollback');await pg.end();}
 });
 it('keeps machine sessions private, deduplicates early usage and forbids a second remote binding',async()=>{
   const tenant=await newTenant('voice-events');
   const route=await createRoute(tenant.db,{organizationId:tenant.organizationId,name:'Receptionist',numberId:null,whenMode:'always',ringStrategy:'everyone',ringTimeoutSeconds:20,destinationType:'ai_receptionist',fallbackType:'members'});
   const pg=new Client(CONNECTION);await pg.connect();await pg.query('begin');
   try{
     const call=(await pg.query("insert into public.calls(organization_id,created_by,direction,status,to_number) values($1,$2,'inbound','ringing','+14165550100') returning id",[tenant.organizationId,tenant.userId])).rows[0].id;
     await pg.query("insert into public.voice_inbound_contexts values($1,$2,'account','{}')",[call,randomUUID()]);
     const account=(await pg.query("insert into public.platform_provider_accounts(provider_key,label,credential_kind) values('voice_agent','Test voice','api_key') returning id")).rows[0].id;
     const session=(await pg.query("insert into public.voice_agent_sessions(call_id,organization_id,route_id,provider_account_id,deployment_ref,config_revision,max_seconds,model) values($1,$2,$3,$4,'published',1,300,'voice-runtime') returning id",[call,tenant.organizationId,route,account])).rows[0].id;
     const member=(await pg.query('select id from public.memberships where organization_id=$1 and user_id=$2',[tenant.organizationId,tenant.userId])).rows[0].id;
     await pg.query("insert into public.communication_route_targets(organization_id,route_id,slot,member_id,position) values($1,$2,'fallback',$3,0)",[tenant.organizationId,route,member]);
     await pg.query('set local role provider_operator');
     await pg.query("select public.record_voice_agent_event($1,'transfer-1','remote','transfer_requested',null)",[session]);
     expect((await pg.query('select public.claim_voice_agent_transfer($1) as target',[session])).rows[0].target.member_ids).toEqual([member]);
     expect((await pg.query('select public.claim_voice_agent_transfer($1) as target',[session])).rows[0].target).toBeNull();
     await pg.query("select public.record_voice_agent_event($1,'transfer-2','remote','transfer_requested',null)",[session]);
     expect((await pg.query('select public.claim_voice_agent_transfer($1) as target',[session])).rows[0].target).toBeNull();
     const event=async(id:string,seconds:number)=> (await pg.query("select public.record_voice_agent_event($1,$2,'remote','ended',$3,10,5) as result",[session,id,seconds])).rows[0].result;
     expect(await event('event-1',12)).not.toBeNull();expect(await event('event-1',12)).toBeNull();
     await pg.query("select public.bind_voice_agent_session($1,'remote','wss://voice.test/stream')",[session]);
     expect((await pg.query('select public.voice_agent_session_context($1) as context',[session])).rows[0].context.state).toBe('ended');
     await pg.query('savepoint conflict');await expect(pg.query("select public.bind_voice_agent_session($1,'foreign','wss://voice.test/stream')",[session])).rejects.toMatchObject({code:'23505'});await pg.query('rollback to savepoint conflict');
     await pg.query('reset role');
     const usage=await pg.query("select meter_id,quantity from public.usage_events where organization_id=$1 and reference=$2",[tenant.organizationId,'voice-session:'+session]);
     expect(usage.rows.map(r=>r.meter_id).sort()).toEqual(['ai_tokens_input','ai_tokens_output','ai_voice_seconds']);
     await pg.query('set local role authenticated');await pg.query('savepoint denied');
     await expect(pg.query('select * from public.voice_agent_sessions')).rejects.toMatchObject({code:'42501'});
     await pg.query('rollback to savepoint denied');
   }finally{await pg.query('rollback');await pg.end();}
 });
 it('admits one pinned voice session and reserves the maximum against the business budget',async()=>{
   const tenant=await newTenant('voice-budget');const staff=await asPlatformStaff();
   for(const key of ['assistant','reception']){
     await recordCommercialTerm(staff,{organizationId:tenant.organizationId,productKey:'module:'+key,periodStart:new Date(Date.now()-60000).toISOString(),periodEnd:new Date(Date.now()+86400000).toISOString(),priceMinor:0,currency:'XXX'});
     await setModuleEnabled(tenant.db,{organizationId:tenant.organizationId,key,enabled:true});
   }
   const route=await createRoute(tenant.db,{organizationId:tenant.organizationId,name:'Budgeted voice',numberId:null,whenMode:'always',ringStrategy:'everyone',ringTimeoutSeconds:20,destinationType:'ai_receptionist',fallbackType:'none'});
   const pg=new Client(CONNECTION);await pg.connect();await pg.query('begin');
   try{
     const calls=[];
     for(let n=0;n<2;n++){
       const call=(await pg.query("insert into public.calls(organization_id,created_by,direction,status,to_number) values($1,$2,'inbound','ringing','+14165550100') returning id",[tenant.organizationId,tenant.userId])).rows[0].id;
       await pg.query("insert into public.voice_inbound_contexts values($1,$2,'account','{}')",[call,randomUUID()]);calls.push(call);
     }
     expect((await pg.query('select public.admit_voice_agent_session($1,$2) as session',[calls[0],route])).rows[0].session).toBeNull();
     const secret=(await pg.query("select vault.create_secret('local-test-credential') as id")).rows[0].id;
     const account=(await pg.query("insert into public.platform_provider_accounts(provider_key,label,credential_kind,status,secret_id) values('voice_agent','Budget fixture','api_key','active',$1) returning id",[secret])).rows[0].id;
     await pg.query("insert into public.platform_ai_runtime_assignments(capability,provider_service_id,provider_account_id,model,updated_by) select 'voice_receptionist',id,$1,'voice-test',$2 from public.platform_provider_services where provider_key='voice_agent' and key='voice_session' on conflict(capability) do update set provider_service_id=excluded.provider_service_id,provider_account_id=excluded.provider_account_id,model=excluded.model",[account,tenant.userId]);
     await pg.query("insert into public.voice_receptionist_configs values($1,1,'published-revision',true,300,300)",[tenant.organizationId]);
     await pg.query('set local role provider_operator');
     const admit=async(call:string)=>(await pg.query('select public.admit_voice_agent_session($1,$2) as session',[call,route])).rows[0].session;
     const first=await admit(calls[0]);expect(first.provider_account_id).toBe(account);expect(first.max_seconds).toBe(300);expect((await admit(calls[0])).id).toBe(first.id);
     expect(await admit(calls[1])).toBeNull();
   }finally{await pg.query('rollback');await pg.end();}
 });

});
