import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { foundBusiness } from '@/tests/support/founding';
import { createCustomer } from '@/lib/domain/customers/customers';
import type { Database, Db } from '@/lib/db/types';
import { listCustomerTimeline } from '@/lib/domain/timeline/timeline';

let pg: Client; let db: Db; let foreign: Db;
let actor: string; let foreignActor: string; let org: string; let tenant: string; let other: string;
let customer: string; let relationship: string; let engagement: string; let planned: string;
const site = randomUUID(); const form = randomUUID(); const agent = randomUUID(); const deployment = randomUUID(); const automation = randomUUID(); const wrongSite = randomUUID();
const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
async function account() {
  const email = `engagement-${randomUUID()}@example.test`; const password = `pw-${randomUUID()}`;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const result = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if(result.error) throw result.error;
  const db = createClient<Database>(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const login = await db.auth.signInWithPassword({ email, password }); if(login.error) throw login.error;
  return { db, email, id: result.data.user.id };
}
beforeAll(async () => {
  pg = new Client(process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'); await pg.connect();
  const seller = await account(); const owner = await account(); db = seller.db; foreign = owner.db; actor = seller.id; foreignActor = owner.id;
  org = await foundBusiness({ ownerEmail: seller.email, name: 'Services', currency: 'CAD' });
  tenant = await foundBusiness({ ownerEmail: owner.email, name: 'Tenant', currency: 'CAD' });
  other = await foundBusiness({ ownerEmail: owner.email, name: 'Wrong tenant', currency: 'CAD' });
  customer = await createCustomer(db, { organizationId: org, name: 'Service customer' });
  await pg.query('insert into platform_staff(user_id,name) values($1,$2)', [actor, 'Verified operator']);
  await pg.query('insert into platform_staff(user_id,name) values($1,$2)',[foreignActor,'Tenant-manager approver']);
  await pg.query('insert into memberships(organization_id,user_id,role_id,display_name,created_by) select organization_id,$2,role_id,$3,$4 from memberships where organization_id=$1 and user_id=$4',[org,foreignActor,'Tenant manager approval',actor]);
  const link = await foreign.rpc('link_existing_client_tenant',{p_organization_id:org,p_customer_id:customer,p_tenant_id:tenant,p_authority_basis:'Verified service contract TEST-42'});
  if(link.error) throw link.error; relationship = link.data;
  await pg.query('delete from memberships where organization_id=$1 and user_id=$2',[org,foreignActor]);
  await pg.query('delete from platform_staff where user_id=$1',[foreignActor]);
  await pg.query('insert into public_sites(organization_id,id,created_by) values($1,$2,$3),($4,$5,$3)',[tenant,site,foreignActor,other,wrongSite]);
  await pg.query('insert into forms(organization_id,id,name,slug,created_by) values($1,$2,$3,$4,$5)',[tenant,form,'Client intake','client-intake',foreignActor]);
  await pg.query('insert into ai_assistants(organization_id,id,name,created_by,updated_by) values($1,$2,$3,$4,$4)',[tenant,agent,'Receptionist',foreignActor]);
  await pg.query('insert into ai_assistant_deployments(organization_id,id,assistant_id,surface) values($1,$2,$3,$4)',[tenant,deployment,agent,'operator_copilot']);
  await pg.query('insert into automation_rules(organization_id,id,name,trigger_kind,trigger_event_action,created_by) values($1,$2,$3,$4,$5,$6)',[tenant,automation,'Client workflow','event','work_item.created',foreignActor]);
});
afterAll(async()=>{await pg?.end();});
describe('Service engagements and typed deliverables',()=>{
  it('creates an engagement without tenant and refuses foreign customer, relationship and service kind',async()=>{
    const result=await db.rpc('create_service_engagement',{p_organization_id:org,p_customer_id:customer,p_name:'Discovery',p_service_kind:'implementation'});
    expect(result.error).toBeNull();
    planned=result.data!;
    const row=await db.from('service_engagements').select('*').eq('organization_id',org).eq('id',result.data!).single();
    expect(row.data).toMatchObject({tenant_organization_id:null,status:'planned',created_by:actor});
    expect((await foreign.rpc('create_service_engagement',{p_organization_id:org,p_customer_id:customer,p_name:'Forged',p_service_kind:'website'})).error?.code).toBe('42501');
    expect((await db.rpc('create_service_engagement',{p_organization_id:org,p_customer_id:randomUUID(),p_name:'Forged',p_service_kind:'website'})).error?.code).toBe('42501');
    expect((await db.rpc('create_service_engagement',{p_organization_id:org,p_customer_id:customer,p_name:'Forged',p_service_kind:'website',p_relationship_id:randomUUID()})).error?.code).toBe('42501');
    expect((await db.rpc('create_service_engagement',{p_organization_id:org,p_customer_id:customer,p_name:'Forged',p_service_kind:'billing'})).error?.code).toBe('23514');
  });
  it('relationship and platform staff grant no artifact selectors or reads',async()=>{
    const result=await db.rpc('create_service_engagement',{p_organization_id:org,p_customer_id:customer,p_name:'Website implementation',p_service_kind:'website',p_relationship_id:relationship});
    expect(result.error).toBeNull(); engagement=result.data!;
    expect((await db.rpc('service_deliverable_options',{p_organization_id:org,p_engagement_id:engagement})).data).toEqual([]);
    expect((await db.rpc('attach_engagement_deliverable',{p_organization_id:org,p_engagement_id:engagement,p_kind:'website',p_artifact_id:site})).error?.code).toBe('42501');
    const privateSites = await db.from('public_sites').select('id').eq('organization_id',tenant);
    expect(privateSites.data ?? []).toEqual([]);
    if (privateSites.error) expect(privateSites.error.code).toBe('42501');
    const privateWrite = await db.rpc('save_ai_assistant', { p_organization_id: tenant, p_id: agent, p_name: 'Forged edit', p_instructions: 'Forged instructions', p_configuration: { policy: 'read_only' }, p_expected_draft: 1 });
    expect(privateWrite.error?.code).toBe('42501');
  });
  it('binds a pre-provisioning engagement once and retains cancellation history',async()=>{
    await pg.query('delete from platform_staff where user_id=$1',[actor]);
    expect((await db.rpc('bind_service_engagement_tenant',{p_organization_id:org,p_engagement_id:planned,p_relationship_id:randomUUID()})).error?.code).toBe('42501');
    expect((await db.rpc('bind_service_engagement_tenant',{p_organization_id:org,p_engagement_id:planned,p_relationship_id:relationship})).error).toBeNull();
    expect((await db.rpc('bind_service_engagement_tenant',{p_organization_id:org,p_engagement_id:planned,p_relationship_id:relationship})).error?.code).toBe('42501');
    expect((await db.rpc('transition_service_engagement',{p_organization_id:org,p_engagement_id:planned,p_status:'cancelled'})).error).toBeNull();
    const row=await db.from('service_engagements').select('*').eq('organization_id',org).eq('id',planned).single();
    expect(row.data).toMatchObject({status:'cancelled',tenant_organization_id:tenant,updated_by:actor});
    expect(row.data?.ended_at).not.toBeNull();
    expect((await db.rpc('transition_service_engagement',{p_organization_id:org,p_engagement_id:planned,p_status:'active'})).error?.code).toBe('22023');
  });
  it('explicit tenant membership admits safe selectors and four canonical artifacts',async()=>{
    await pg.query('insert into memberships(organization_id,user_id,role_id,display_name,created_by) select organization_id,$2,role_id,$3,$4 from memberships where organization_id=$1 and user_id=$4',[tenant,actor,'Authorized operator',foreignActor]);
    await pg.query("insert into organization_modules(organization_id,module_key,enabled_by) values($1,'automations',$2) on conflict do nothing",[tenant,foreignActor]);
    const options=await db.rpc('service_deliverable_options',{p_organization_id:org,p_engagement_id:engagement});
    expect(options.error).toBeNull(); expect(options.data?.map(a=>a.kind).sort()).toEqual(['ai_deployment','automation','form','website']);
    for(const [kind,id] of [['website',site],['form',form],['ai_deployment',deployment],['automation',automation]]){
      expect((await db.rpc('attach_engagement_deliverable',{p_organization_id:org,p_engagement_id:engagement,p_kind:kind,p_artifact_id:id})).error).toBeNull();
    }
    expect((await db.rpc('engagement_deliverable_summaries',{p_organization_id:org,p_engagement_id:engagement})).data).toHaveLength(4);
  });
  it('refuses forged IDs, wrong tenant, duplicate references and direct mutation',async()=>{
    for(const id of [randomUUID(),wrongSite]) expect((await db.rpc('attach_engagement_deliverable',{p_organization_id:org,p_engagement_id:engagement,p_kind:'website',p_artifact_id:id})).error?.code).toBe('42501');
    expect((await db.rpc('attach_engagement_deliverable',{p_organization_id:org,p_engagement_id:engagement,p_kind:'website',p_artifact_id:site})).error?.code).toBe('23505');
    expect((await db.from('engagement_deliverables').insert({organization_id:org,engagement_id:engagement,tenant_organization_id:other,site_id:wrongSite,created_by:actor})).error).not.toBeNull();
    expect((await foreign.from('service_engagements').select('*').eq('organization_id',org)).data).toEqual([]);
    expect((await foreign.rpc('engagement_deliverable_summaries',{p_organization_id:org,p_engagement_id:engagement})).data).toEqual([]);
    await expect(pg.query('insert into engagement_deliverables(organization_id,engagement_id,tenant_organization_id,site_id,created_by) values($1,$2,$3,$4,$5)',[org,engagement,other,wrongSite,actor])).rejects.toMatchObject({code:'23503'});
  });
  it('revoked tenant membership immediately hides selectors and live artifact metadata',async()=>{
    await pg.query('delete from memberships where organization_id=$1 and user_id=$2',[tenant,actor]);
    expect((await db.rpc('service_deliverable_options',{p_organization_id:org,p_engagement_id:engagement})).data).toEqual([]);
    const result=await db.rpc('engagement_deliverable_summaries',{p_organization_id:org,p_engagement_id:engagement});
    expect(result.data).toHaveLength(4); expect(result.data?.every(d=>!d.available && d.label==='Restricted artifact')).toBe(true);
    expect((await db.rpc('attach_engagement_deliverable',{p_organization_id:org,p_engagement_id:engagement,p_kind:'website',p_artifact_id:site})).error?.code).toBe('42501');
    await pg.query('insert into memberships(organization_id,user_id,role_id,display_name,created_by) select organization_id,$2,role_id,$3,$4 from memberships where organization_id=$1 and user_id=$4',[tenant,actor,'Restored authorized operator',foreignActor]);
  });
  it('references Customer Work without changing task state and refuses unrelated tasks',async()=>{
    const type=randomUUID(); const status=randomUUID(); const work=randomUUID(); const unrelated=randomUUID();
    await pg.query('insert into work_item_types(organization_id,id,name,created_by,schedulable) values($1,$2,$3,$4,false)',[org,type,'Implementation',actor]);
    await pg.query('insert into work_item_statuses(organization_id,id,type_id,name,created_by) values($1,$2,$3,$4,$5)',[org,status,type,'Planned',actor]);
    await pg.query('insert into work_items(organization_id,id,type_id,status_id,title,customer_id,created_by) values($1,$2,$3,$4,$5,$6,$7),($1,$8,$3,$4,$5,null,$7)',[org,work,type,status,'Build client website',customer,actor,unrelated]);
    expect((await db.rpc('attach_engagement_work',{p_organization_id:org,p_engagement_id:engagement,p_work_item_id:work})).error).toBeNull();
    expect((await db.rpc('attach_engagement_work',{p_organization_id:org,p_engagement_id:engagement,p_work_item_id:unrelated})).error?.code).toBe('42501');
    expect((await db.rpc('attach_engagement_work',{p_organization_id:org,p_engagement_id:engagement,p_work_item_id:randomUUID()})).error?.code).toBe('42501');
    expect((await pg.query('select status_id from work_items where organization_id=$1 and id=$2',[org,work])).rows[0].status_id).toBe(status);
    expect((await db.from('engagement_work_items').select('*').eq('organization_id',org).eq('engagement_id',engagement)).data?.[0].created_by).toBe(actor);
  });
  it('completes with unchanged artifacts and retained historical attribution',async()=>{
    const before=await pg.query('select enabled,version_id from ai_assistant_deployments where id=$1',[deployment]);
    expect((await db.rpc('transition_service_engagement',{p_organization_id:org,p_engagement_id:engagement,p_status:'active'})).error).toBeNull();
    expect((await db.rpc('transition_service_engagement',{p_organization_id:org,p_engagement_id:engagement,p_status:'completed'})).error).toBeNull();
    const row=await db.from('service_engagements').select('*').eq('organization_id',org).eq('id',engagement).single();
    expect(row.data?.completed_at).not.toBeNull(); expect(row.data?.updated_by).toBe(actor);
    expect((await pg.query('select enabled,version_id from ai_assistant_deployments where id=$1',[deployment])).rows).toEqual(before.rows);
    expect((await db.from('engagement_deliverables').select('*').eq('organization_id',org).eq('engagement_id',engagement)).data).toHaveLength(4);
    expect((await db.rpc('transition_service_engagement',{p_organization_id:org,p_engagement_id:engagement,p_status:'active'})).error?.code).toBe('22023');
  });
  it('projects attributable service operations in the canonical Customer activity timeline',async()=>{
    const entries=await listCustomerTimeline(db,{organizationId:org,customerId:customer});
    expect(entries.some(e=>e.description==='Service engagement created')).toBe(true);
    expect(entries.some(e=>e.description==='Deliverable attached to a service engagement')).toBe(true);
    expect(entries.filter(e=>e.description.includes('service engagement')).every(e=>e.actorName!==null)).toBe(true);
  });
  it('ending relationship removes status projection and retains artifacts and deliverables',async()=>{
    expect((await db.rpc('end_client_tenant_relationship',{p_organization_id:org,p_relationship_id:relationship})).error).toBeNull();
    const result=await db.rpc('engagement_deliverable_summaries',{p_organization_id:org,p_engagement_id:engagement});
    expect(result.data).toHaveLength(4); expect(result.data?.every(d=>!d.available && d.artifact_status==='Relationship ended')).toBe(true);
    expect((await db.rpc('create_service_engagement',{p_organization_id:org,p_customer_id:customer,p_name:'Forged',p_service_kind:'website',p_relationship_id:relationship})).error?.code).toBe('42501');
    expect((await pg.query('select id from public_sites where organization_id=$1',[tenant])).rows).toHaveLength(1);
    expect((await db.from('invoices').select('id').eq('organization_id',org)).data).toEqual([]);
  });
});
