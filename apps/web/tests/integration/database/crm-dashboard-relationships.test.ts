import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll,describe,expect,it } from 'vitest';
import { foundBusiness } from '@/tests/support/founding';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createContact,listContactPage,updateContact } from '@/lib/domain/contacts/contacts';
import { listRecentRelationships,listRecentlyAddedContacts,relationshipOverview } from '@/lib/domain/contacts/relationship-activity';
import { createTask,changeTaskStatus } from '@/lib/domain/tasks/tasks';
import { createOpportunity,createOpportunityStage } from '@/lib/domain/opportunities/opportunities';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
const url=process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',options);
const CONNECTION=process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
async function account(){const email=`crm-dashboard-${randomUUID()}@example.test`;const password=randomUUID();const user=await admin.auth.admin.createUser({email,password,email_confirm:true});if(user.error)throw user.error;const db=createClient(url,process.env.SUPABASE_ANON_KEY??'',options);const login=await db.auth.signInWithPassword({email,password});if(login.error)throw login.error;return {email,db};}
const ids=(rows:{id:string}[])=>rows.map(row=>row.id);
describe('CRM dashboard relationship reads under real PostgreSQL RLS',()=>{
  let owner:Awaited<ReturnType<typeof account>>,outsider:Awaited<ReturnType<typeof account>>,reader:Awaited<ReturnType<typeof account>>;
  let organizationId:string,acme:string,ada:string,ben:string,solo:string,legacy:string,old:string;
  beforeAll(async()=>{
    [owner,outsider,reader]=await Promise.all([account(),account(),account()]);
    organizationId=await foundBusiness({ownerEmail:owner.email,name:'Relationship dashboard',currency:'CAD',timezone:'America/Toronto'});
    await foundBusiness({ownerEmail:outsider.email,name:'Other relationships',currency:'CAD'});
    acme=await createContact(owner.db,{organizationId,name:'Acme Ltd',contactType:'company',lifecycle:'customer'});
    ada=await createContact(owner.db,{organizationId,name:'Ada Person',contactType:'person',companyId:acme,lifecycle:'lead'});
    ben=await createContact(owner.db,{organizationId,name:'Ben Person',contactType:'person',companyId:acme});
    solo=await createContact(owner.db,{organizationId,name:'Solo Person',contactType:'person',lifecycle:'lead'});
    legacy=await createCustomer(owner.db,{organizationId,name:'Legacy record'});
    old=await createContact(owner.db,{organizationId,name:'Old Company',contactType:'company'});
    // No API role may rewrite creation time, so the 40-day-old fixture is dated directly in local PostgreSQL.
    const pg=new Client({connectionString:CONNECTION});await pg.connect();try{await pg.query("update public.contacts set created_at=now()-interval '40 days' where id=$1",[old]);await pg.query('update public.contacts set lifecycle=null where id=$1',[legacy]);}finally{await pg.end();}
    const roleId=await createRole(owner.db,{organizationId,name:'Relationship reader',capabilities:['customer.update']});await addMember(owner.db,{organizationId,email:reader.email,roleId});
  });
  it('counts identity type and lifecycle as separate dimensions, with a 30-day creation window',async()=>{
    // Ada and Solo were created as Leads; Ben and Old Company were created without a lifecycle (V1.4: Unclassified), and the legacy record was cleared.
    const overview=await relationshipOverview(owner.db,organizationId);
    expect(overview).toEqual({total:6,people:3,companies:2,unspecified:1,newLast30Days:5,lifecycles:{lead:2,prospect:0,customer:1,unclassified:3}});
    expect((await relationshipOverview(outsider.db,organizationId)).total).toBe(0);
    // The New contacts link opens the directory filtered to the same window, and the counts agree.
    const added=await listContactPage(owner.db,{organizationId,filter:{page:1,addedSince:new Date(Date.now()-30*86400000).toISOString()}});
    expect(added.total).toBe(overview.newLast30Days);expect(ids(added)).not.toContain(old);
  });
  it('falls back to recently added contacts, newest first, when nothing qualifying is recorded',async()=>{
    expect(await listRecentRelationships(owner.db,{organizationId,includeNextTask:true})).toEqual([]);
    const added=await listRecentlyAddedContacts(owner.db,{organizationId});
    expect(ids(added)).toEqual([legacy,solo,ben,ada,acme,old]);
    expect(added.every(row=>row.activity===null)).toBe(true);
    expect(added.find(row=>row.id===ada)).toMatchObject({companyId:acme,companyName:'Acme Ltd'});
    expect(added.find(row=>row.id===acme)?.companyId).toBeNull();
  });
  it('orders by qualifying activity rather than creation, one row per contact, and ignores routine edits',async()=>{
    // Contact creation and a type-free detail correction are not relationship activity.
    await updateContact(owner.db,{organizationId,customerId:solo,name:'Solo Person',phone:'+14165550100',contactType:'person'});
    expect(await listRecentRelationships(owner.db,{organizationId,includeNextTask:false})).toEqual([]);
    const meeting=await createTask(owner.db,{organizationId,customerId:ada,kind:'meeting',title:'Site walk',dueAt:new Date().toISOString()});
    await changeTaskStatus(owner.db,{organizationId,id:meeting,status:'completed'});
    await updateContact(owner.db,{organizationId,customerId:acme,name:'Acme Ltd',contactType:'company',lifecycle:'prospect'});
    const stage=await createOpportunityStage(owner.db,{organizationId,name:'Talking',kind:'open',position:0});
    await createOpportunity(owner.db,{organizationId,customerId:ben,title:'Roof',stageId:stage});
    const second=await createTask(owner.db,{organizationId,customerId:ada,kind:'call',title:'Second call',dueAt:new Date().toISOString()});
    await changeTaskStatus(owner.db,{organizationId,id:second,status:'completed'});
    let rows=await listRecentRelationships(owner.db,{organizationId,includeNextTask:true});
    expect(ids(rows)).toEqual([ada,ben,acme]);
    expect(rows[0].activity).toMatchObject({action:'follow_up.completed',detail:{kind:'call',title:'Second call'}});
    expect(rows[1].activity?.action).toBe('opportunity.created');
    expect(rows[2].activity).toMatchObject({action:'customer.classification_changed',detail:{to_lifecycle:'prospect'}});
    expect(rows[0]).toMatchObject({contactType:'person',companyId:acme,companyName:'Acme Ltd'});
    expect(rows[2]).toMatchObject({contactType:'company',companyId:null});
    const before=rows.map(row=>row.activity?.occurredAt);
    // Routine corrections, a temperature-only change and an open task do not change recency.
    await updateContact(owner.db,{organizationId,customerId:acme,name:'Acme Limited',phone:'+14165550111',contactType:'company'});
    await updateContact(owner.db,{organizationId,customerId:ben,name:'Ben Person',contactType:'person',leadTemperature:'hot'});
    await createTask(owner.db,{organizationId,customerId:solo,kind:'call',title:'Planned call',dueAt:new Date(Date.now()+86400000).toISOString()});
    rows=await listRecentRelationships(owner.db,{organizationId,includeNextTask:true});
    expect(ids(rows)).toEqual([ada,ben,acme]);expect(rows.map(row=>row.activity?.occurredAt)).toEqual(before);
    expect(rows[2].name).toBe('Acme Limited');
  });
  it('reads the next task only when asked and only from real open tasks',async()=>{
    const planned=await createTask(owner.db,{organizationId,customerId:ben,kind:'email',title:'Send quote',dueAt:new Date(Date.now()+3600000).toISOString()});
    const withTasks=await listRecentRelationships(owner.db,{organizationId,includeNextTask:true});
    expect(withTasks.find(row=>row.id===ben)?.nextTask).toMatchObject({id:planned,title:'Send quote'});
    expect(withTasks.find(row=>row.id===ada)?.nextTask).toBeNull();
    expect((await listRecentRelationships(owner.db,{organizationId,includeNextTask:false})).every(row=>row.nextTask===null)).toBe(true);
  });
  it('bounds the preview and isolates organizations',async()=>{
    expect(await listRecentRelationships(owner.db,{organizationId,limit:2,includeNextTask:false})).toHaveLength(2);
    expect(await listRecentRelationships(outsider.db,{organizationId,includeNextTask:true})).toEqual([]);
    expect(await listRecentlyAddedContacts(outsider.db,{organizationId})).toEqual([]);
    expect(ids(await listRecentRelationships(reader.db,{organizationId,includeNextTask:false}))).toEqual([ada,ben,acme]);
  });
  it('carries the recorded call status so an unanswered call is never shown as a conversation',async()=>{
    const pg=new Client({connectionString:CONNECTION});await pg.connect();
    try{await pg.query("insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload) select $1,c.created_by,'customer',$2,'call.ended',jsonb_build_object('call_id',gen_random_uuid(),'status','no_answer','duration',null) from public.contacts c where c.id=$2",[organizationId,solo]);}finally{await pg.end();}
    const [latest]=await listRecentRelationships(owner.db,{organizationId,limit:1,includeNextTask:false});
    expect(latest).toMatchObject({id:solo,activity:{action:'call.ended',detail:{status:'no_answer'}}});
  });
});
