import { createMapping, suggestMapping } from '@/lib/domain/integrations/mappings';
import { beginImportRun, resumeImportStaging, applyImportRun, listStagingRows } from '@/lib/domain/integrations/import-runs';
import { getCustomer } from '@/lib/domain/customers/customers';
import {randomUUID} from 'node:crypto';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {Client} from 'pg';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {recordConnection} from '@/lib/domain/integrations/connections';
import {foundBusiness} from '@/tests/support/founding';
import {downloadImportFile,listResourceRecords} from '@/lib/domain/integrations/resources';
import {assignRole,createRole} from '@/lib/domain/tenancy/roles';

let pg:Client,alice:SupabaseClient,bob:SupabaseClient,org:string,connection:string,resource:string;
async function tenant(label:string) {
  const admin=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email=`library-${label}-${randomUUID()}@example.test`,password=randomUUID();
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw created.error;
  const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_ANON_KEY!);
  const signed=await db.auth.signInWithPassword({email,password});if(signed.error)throw signed.error;
  return {db,org:await foundBusiness({ownerEmail:email,name:`Library ${label}`,currency:'EUR'})};
}
async function machine(sql:string,values:unknown[]=[]) {
  await pg.query('begin');
  try{await pg.query('set local role integration_operator');const answer=await pg.query(sql,values);await pg.query('commit');return answer.rows;}
  catch(error){await pg.query('rollback');throw error;}
}
async function claim(){return (await machine('select public.claim_integration_resource_sync($1) as job',[resource]))[0].job;}
async function commit(job:{lease_id:string},rows:unknown[]){await machine("select public.commit_integration_resource_sync($1,$2,$3,'{}',true,true,null)",[resource,job.lease_id,JSON.stringify(rows)]);}
const row=(id:string,value:string)=>({external_id:id,display_name:id,metadata:{value},deleted:false});

describe('imported reads and synchronized records retain database authority',()=>{
  beforeAll(async()=>{
    pg=new Client(process.env.SUPABASE_DB_URL);await pg.connect();
    const a=await tenant('alice');alice=a.db;org=a.org;bob=(await tenant('bob')).db;
    connection=await recordConnection(alice,{organizationId:org,connectorKey:'google_workspace'});
    await pg.query("update public.integration_connections set status='active' where id=$1",[connection]);
    resource=(await machine("select public.record_managed_integration_resource($1,'google_sheet','sheet-test','Sheet','{}') as id",[connection]))[0].id;
  });
  afterAll(async()=>{if(pg){// Preserve imported provenance; leave this isolated fixture disconnected and unscheduled.
    await pg.query('update public.integration_resource_syncs set enabled=false where organization_id=$1',[org]);
    await pg.query("update public.integration_connections set status='disconnected' where id=$1",[connection]);await pg.end();}});
  it('refuses cross-tenant configuration and hides records',async()=>{
    const result=await bob.rpc('configure_integration_resource_sync',{p_resource_id:resource,p_enabled:true,p_parameters:{}});
    expect(result.error?.code).toBe('42501');
    expect((await bob.from('integration_resource_records').select('*').eq('resource_id',resource)).data).toEqual([]);
  });
  it('leases a selection once and refuses parameter changes during a running page',async()=>{
    const configured=await alice.rpc('configure_integration_resource_sync',{p_resource_id:resource,p_enabled:true,p_parameters:{}});expect(configured.error).toBeNull();
    const job=await claim();expect(job).toBeTruthy();expect(await claim()).toBeNull();
    const changed=await alice.rpc('configure_integration_resource_sync',{p_resource_id:resource,p_enabled:true,p_parameters:{range:'Other!A1:B3'}});expect(changed.error?.code).toBe('55000');
    await commit(job,[row('a','first'),row('b','second')]);
  });
  it('reconciles snapshots without duplicates and tombstones missing keys',async()=>{
    await commit(await claim(),[row('a','changed')]);
    const result=await alice.from('integration_resource_records').select('external_id,metadata,deleted').eq('resource_id',resource).order('external_id');
    expect(result.error).toBeNull();expect(result.data).toEqual([{external_id:'a',metadata:{value:'changed'},deleted:false},{external_id:'b',metadata:{value:'second'},deleted:true}]);
    expect((await alice.from('integration_resource_syncs').select('cursor').eq('resource_id',resource)).error).not.toBeNull();
  });
  it('refuses mismatched and cross-tenant reads and tenant job claims',async()=>{
    expect((await alice.rpc('queue_integration_library_read',{p_connection_id:connection,p_capability_key:'piece.stripe.get_customer',p_arguments:{}})).error?.code).toBe('42501');
    expect((await bob.rpc('queue_integration_library_read',{p_connection_id:connection,p_capability_key:'piece.google_sheets.get_values',p_arguments:{}})).error?.code).toBe('42501');
    expect((await alice.rpc('claim_integration_library_job',{p_job_id:randomUUID()})).error).not.toBeNull();
  });
  it('claims a database-authorized job once and clears its transient arguments',async()=>{
    await machine('select public.store_integration_credential($1,$2)',[connection,JSON.stringify({access_token:'fixture-token'})]);
    const queued=await alice.rpc('queue_integration_library_read',{p_connection_id:connection,p_capability_key:'piece.google_calendar.google_calendar_list_calendars',p_arguments:{}});
    expect(queued.error).toBeNull();
    const claimed=(await machine('select public.claim_integration_library_job($1) as job',[queued.data]))[0].job;
    expect(claimed.secret).toBe(JSON.stringify({access_token:'fixture-token'}));
    expect((await machine('select public.claim_integration_library_job($1) as job',[queued.data]))[0].job).toBeNull();
    const argumentsAfter=await pg.query('select arguments,claimed_at from public.integration_library_jobs where id=$1',[queued.data]);
    expect(argumentsAfter.rows[0].arguments).toEqual({});expect(argumentsAfter.rows[0].claimed_at).toBeTruthy();
  });
  it('completed worksheet rows feed the existing mapping preview without a second source store',async()=>{
    await commit(await claim(),[{external_id:'42',display_name:'42',metadata:{headers:['id','name'],values:['42','Alice']},deleted:false}]);
    const parsed=await downloadImportFile(alice,{organizationId:org,resourceId:resource});
    expect(parsed?.headers).toEqual(['id','name']);expect(parsed?.rows).toEqual([{id:'42',name:'Alice',__source_record_id:'42'}]);
  });
  it('keeps saved worksheet identity across updates and preserves CRM history when a source row disappears', async()=>{
    const metadata=(name:string)=>({headers:['source_record_id','name','lifecycle','temperature'],values:['42',name,'lead','warm']});
    await commit(await claim(),[{external_id:'42',display_name:'42',metadata:metadata('Worksheet contact'),deleted:false}]);
    const mapping = suggestMapping(['source_record_id','name','lifecycle','temperature'],[]);
    const mappingId=await createMapping(alice,{organizationId:org,resourceId:resource,fields:mapping});
    expect((await alice.rpc('configure_crm_import_sync',{p_organization_id:org,p_mapping_id:mappingId,p_enabled:true})).error).toBeNull();
    expect((await bob.rpc('configure_crm_import_sync',{p_organization_id:org,p_mapping_id:mappingId,p_enabled:false})).error?.code).toBe('42501');
    async function run(){const runId=await beginImportRun(alice,{organizationId:org,mappingId});await resumeImportStaging(alice,{organizationId:org,runId});await applyImportRun(alice,{organizationId:org,runId});return (await listStagingRows(alice,{organizationId:org,runId}))[0];}
    const first=await run();const id=first.matchedCustomerId!;
    expect(await getCustomer(alice,{organizationId:org,customerId:id})).toMatchObject({id,name:'Worksheet contact',lifecycle:'lead',leadTemperature:'warm'});
    await commit(await claim(),[{external_id:'42',display_name:'42',metadata:metadata('Worksheet renamed'),deleted:false}]);
    expect((await run()).matchedCustomerId).toBe(id);
    expect(await getCustomer(alice,{organizationId:org,customerId:id})).toMatchObject({id,name:'Worksheet renamed'});
    await commit(await claim(),[]);
    expect((await listResourceRecords(alice,org,resource))).toHaveLength(0);
    expect(await getCustomer(alice,{organizationId:org,customerId:id})).toMatchObject({id,name:'Worksheet renamed'});
    const events=await alice.from('events').select('action').eq('organization_id',org).eq('entity_id',id);expect(events.data?.length).toBeGreaterThanOrEqual(2);
    await commit(await claim(),[{external_id:'42',display_name:'42',metadata:metadata('Worksheet renamed'),deleted:false}]);
  });
  it('keeps the page reader tenant-scoped and refuses sync changes and record reads to a member without integration.manage',async()=>{
    expect(await listResourceRecords(bob,org,resource)).toEqual([]);
    expect((await listResourceRecords(alice,org,resource)).length).toBeGreaterThan(0);
    const limited=await createRole(alice,{organizationId:org,name:'No Integrations',capabilities:['role.manage','customer.create']});
    const membership=await alice.from('memberships').select('id').eq('organization_id',org).single();
    await assignRole(alice,{membershipId:membership.data!.id,roleId:limited});
    const refused=await alice.rpc('configure_integration_resource_sync',{p_resource_id:resource,p_enabled:false,p_parameters:{}});
    expect(refused.error?.code).toBe('42501');
    expect((await alice.from('integration_resource_records').select('external_id').eq('resource_id',resource)).data).toEqual([]);
  });
});
