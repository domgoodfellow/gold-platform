import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { foundBusiness } from '@/tests/support/founding';
import { commandMarketing, readMarketing, type InquiryDetail } from '@/lib/domain/marketing/marketing';
import { createForm, saveFormDraft, publishFormRevision, formEditorState } from '@/lib/domain/forms/forms';
import { submitPublicFormByKey } from '@/lib/domain/forms/public-forms';
import { createCustomerStage } from '@/lib/domain/customers/stages';
import { createCustomer } from '@/lib/domain/customers/customers';
import type { Db } from '@/lib/db/types';

const url=process.env.SUPABASE_URL??'http://127.0.0.1:54321';
const key=process.env.SUPABASE_ANON_KEY??'';
const admin=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY??'',{auth:{persistSession:false,autoRefreshToken:false}});
const pg=new Client(process.env.SUPABASE_DB_URL??'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
let a:{db:Db;org:string;user:string};let b:typeof a;
let campaign:string, form:string, revision:string, publicKey:string, token:string, inquiry:string;
async function tenant(label:string) {
  const email=`marketing-${label}-${randomUUID()}@example.test`,password=randomUUID();
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw created.error;
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}) as Db;
  await db.auth.signInWithPassword({email,password});
  const org=await foundBusiness({ownerEmail:email,name:`Marketing ${label}`,currency:'CAD',timezone:'America/Toronto'});
  return{db,org,user:created.data.user.id};
}
async function capture(requestId=randomUUID(), useToken=token) {
  const visitor=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}) as Db;
  return submitPublicFormByKey(visitor,{publicKey,revisionId:revision,answers:{name:'Reviewed prospect'},source:'hosted',attribution:{token:useToken,utm:{utm_source:'newsletter',utm_medium:'email'},requestId}});
}
describe('Marketing operating domain',()=>{
  beforeAll(async()=>{
    await pg.connect();a=await tenant('a');b=await tenant('b');
    campaign=await commandMarketing(a.db,a.org,'campaign.create',{name:'Winter acquisition',objective:'lead_generation',channels:['form']});
    const f=await createForm(a.db,{organizationId:a.org,name:'Winter inquiry'});form=f.formId;revision=f.revisionId;
    await saveFormDraft(a.db,{organizationId:a.org,revisionId:revision,definition:{title:'Winter inquiry',submitLabel:'Submit',confirmation:{title:'Thank you',message:'We will review your inquiry.'},fields:[{id:'name',type:'short_text',label:'Your name',required:true}]}});
    await publishFormRevision(a.db,{organizationId:a.org,revisionId:revision});
    publicKey=(await formEditorState(a.db,a.org,form))!.form.publicKey;
    await commandMarketing(a.db,a.org,'campaign.form',{id:campaign,form});
    token=(await readMarketing(a.db,a.org,'detail',{campaign})).campaigns[0].forms[0].token;
  });
  afterAll(async()=>{await pg.end();await a?.db.auth.signOut();await b?.db.auth.signOut();});
  it('validates lifecycle, dates, owner and organization boundaries',async()=>{
    await expect(commandMarketing(a.db,a.org,'campaign.status',{id:campaign,status:'completed'})).rejects.toThrow();
    await expect(commandMarketing(a.db,a.org,'campaign.create',{name:'Invalid',objective:'lead_generation',start:'2026-10-30',end:'2026-10-01'})).rejects.toThrow();
    const foreignMember=(await pg.query('select id from memberships where organization_id=$1',[b.org])).rows[0].id;
    await expect(commandMarketing(a.db,a.org,'campaign.create',{name:'Invalid owner',objective:'awareness',owner:foreignMember})).rejects.toThrow();
    await expect(commandMarketing(b.db,a.org,'campaign.status',{id:campaign,status:'active'})).rejects.toThrow();
    expect((await b.db.from('marketing_campaigns').select('id').eq('organization_id',a.org)).data).toEqual([]);
    await expect(readMarketing(b.db,a.org,'home')).rejects.toThrow();
    expect((await capture()).ok).toBe(false);
    await commandMarketing(a.db,a.org,'campaign.status',{id:campaign,status:'active'});
  });
  it('captures a real Studio response and one inquiry across concurrent retries',async()=>{
    const request=randomUUID();const results=await Promise.all([capture(request),capture(request)]);
    expect(results.every(r=>r.ok)).toBe(true);
    const data=await readMarketing(a.db,a.org,'home');
    expect(data.summary).toMatchObject({active:1,acquired:1,attributed:1,handoffs:0,submissions:1});
    expect(data.inquiries).toHaveLength(1);inquiry=data.inquiries[0].id;
    const detail=await readMarketing<InquiryDetail>(a.db,a.org,'inquiry',{id:inquiry});
    expect(detail.answers.name).toBe('Reviewed prospect');expect(detail.definition.fields[0].label).toBe('Your name');
    expect(detail.source_context.utm_source).toBe('newsletter');expect(detail.customer_id).toBeNull();
    await expect(readMarketing(b.db,a.org,'inquiry',{id:inquiry})).rejects.toThrow();
  });
  it('rejects forged public cross-tenant attribution and invalid UTM metadata',async()=>{
    const foreign=await createForm(b.db,{organizationId:b.org,name:'Foreign inquiry'});
    await saveFormDraft(b.db,{organizationId:b.org,revisionId:foreign.revisionId,definition:{title:'Foreign inquiry',submitLabel:'Submit',confirmation:{title:'Thanks',message:'Received.'},fields:[{id:'name',type:'short_text',label:'Name'}]}});
    await publishFormRevision(b.db,{organizationId:b.org,revisionId:foreign.revisionId});
    const visitor=createClient(url,key,{auth:{persistSession:false}}) as Db;
    const result=await submitPublicFormByKey(visitor,{publicKey:(await formEditorState(b.db,b.org,foreign.formId))!.form.publicKey,revisionId:foreign.revisionId,answers:{name:'Forgery'},source:'hosted',attribution:{token,utm:{},requestId:randomUUID()}});
    expect(result.ok).toBe(false);expect((await readMarketing(b.db,b.org,'home')).summary.acquired).toBe(0);
    expect((await capture(randomUUID(),randomUUID())).ok).toBe(false);
    const authenticated=createClient(url,key,{auth:{persistSession:false}}) as Db;await authenticated.auth.signInAnonymously();
    const invalid=await authenticated.rpc('submit_marketing_form',{p_public_key:publicKey,p_revision_id:revision,p_answers:{name:'Bad UTM'},p_source:'hosted',p_token:token,p_utm:{organization_id:b.org},p_request_id:randomUUID()});expect(invalid.error).not.toBeNull();
  });
  it('reviews and creates a canonical Customer once under concurrent handoff retries',async()=>{
    await commandMarketing(a.db,a.org,'inquiry.review',{id:inquiry,status:'in_review'});
    const input={id:inquiry,create:true,name:'Explicit CRM prospect',email:`lead-${randomUUID()}@example.test`};
    await Promise.all([commandMarketing(a.db,a.org,'inquiry.handoff',input),commandMarketing(a.db,a.org,'inquiry.handoff',input)]);
    const detail=await readMarketing<InquiryDetail>(a.db,a.org,'inquiry',{id:inquiry});expect(detail.status).toBe('handed_off');expect(detail.customer_id).toBeTruthy();
    const customers=await a.db.from('customers').select('id',{count:'exact'}).eq('organization_id',a.org).eq('email',input.email);expect(customers.count).toBe(1);
    const data=await readMarketing(a.db,a.org,'performance');expect(data.summary).toMatchObject({acquired:1,cohort_handoffs:1,handoffs:1});expect(data.campaigns[0]).toMatchObject({leads:1,handoffs:1});
    await commandMarketing(a.db,a.org,'campaign.edit',{id:campaign,name:'Renamed campaign',objective:'lead_generation'});
    expect((await readMarketing<InquiryDetail>(a.db,a.org,'inquiry',{id:inquiry})).campaign_name_at_capture).toBe('Winter acquisition');
  });
  it('calculates dynamic audiences without copying identities',async()=>{
    const stage=await createCustomerStage(a.db,{organizationId:a.org,name:'Marketing target',position:1});
    const audience=await commandMarketing(a.db,a.org,'audience.save',{name:'Target segment',stage});
    const preview=()=>readMarketing<{total:number}>(a.db,a.org,'audience',{id:audience});expect((await preview()).total).toBe(0);
    const customer=await createCustomer(a.db,{organizationId:a.org,name:'Audience member'});
    await pg.query('update customers set stage_id=$1 where organization_id=$2 and id=$3',[stage,a.org,customer]);expect((await preview()).total).toBe(1);
    await commandMarketing(a.db,a.org,'campaign.audience',{id:campaign,audience});
    await pg.query('update customers set stage_id=null where organization_id=$1 and id=$2',[a.org,customer]);expect((await preview()).total).toBe(0);
  });
  it('enforces read-only Marketing and separate Customer creation authority',async()=>{
    const role=(await pg.query('select role_id from memberships where organization_id=$1 and user_id=$2',[a.org,a.user])).rows[0].role_id;
    const original=(await pg.query('select capabilities from roles where id=$1',[role])).rows[0].capabilities;
    try{
      await pg.query("update roles set capabilities=array['role.manage','marketing.read'] where id=$1",[role]);
      expect((await readMarketing(a.db,a.org,'home')).campaign_total).toBe(1);
      await expect(commandMarketing(a.db,a.org,'campaign.create',{name:'Refused',objective:'awareness'})).rejects.toThrow();
      expect((await a.db.from('marketing_campaigns').insert({organization_id:a.org,name:'Direct',objective:'awareness',created_by:a.user})).error).not.toBeNull();
      await pg.query("update roles set capabilities=array['role.manage','marketing.manage'] where id=$1",[role]);
      expect((await capture()).ok).toBe(true);
      const pending=(await readMarketing(a.db,a.org,'leads',{status:'new'})).inquiries[0];
      await expect(commandMarketing(a.db,a.org,'inquiry.handoff',{id:pending.id,create:true,name:'Refused Customer'})).rejects.toThrow();
      await expect(commandMarketing(a.db,a.org,'inquiry.link',{id:pending.id,customer:(await createCustomer(b.db,{organizationId:b.org,name:'Foreign customer'}))})).rejects.toThrow();
    }finally{await pg.query('update roles set capabilities=$1 where id=$2',[original,role]);}
  });
  it('keeps untracked Studio submissions working without inventing Marketing inquiries',async()=>{
    const before=await readMarketing(a.db,a.org,'home');
    const visitor=createClient(url,key,{auth:{persistSession:false}}) as Db;
    expect((await submitPublicFormByKey(visitor,{publicKey,revisionId:revision,answers:{name:'Unattributed'},source:'hosted'})).ok).toBe(true);
    const after=await readMarketing(a.db,a.org,'home');expect(after.summary.acquired).toBe(before.summary.acquired);expect(after.summary.submissions).toBe(before.summary.submissions+1);
  });
  it('keeps exact aggregates beyond previews and separates acquisition and handoff dates',async()=>{
    const c=await commandMarketing(b.db,b.org,'campaign.create',{name:'Reporting cohort',objective:'lead_generation'});
    const f=await createForm(b.db,{organizationId:b.org,name:'Reporting source'});
    const customer=await createCustomer(b.db,{organizationId:b.org,name:'Reporting Customer'});
    await pg.query(`with submissions as (
      insert into form_submissions(organization_id,form_id,form_revision_id,submitted_by,answers,submitted_at)
      select $1,$2,$3,$4,'{}',case when n=31 then '2026-09-30 23:59:59 America/Toronto'::timestamptz else '2026-10-01 00:00:00 America/Toronto'::timestamptz end
      from generate_series(1,31) n returning id,submitted_at
    ), numbered as (select *,row_number() over(order by submitted_at,id) n from submissions)
    insert into marketing_inquiries(organization_id,campaign_id,form_id,submission_id,form_name_at_capture,source,occurred_at,status,customer_id,handed_off_at)
    select $1,$5,$2,id,'Reporting source','hosted',submitted_at,case when n<=11 then 'handed_off' else 'new' end,
      case when n<=11 then $6::uuid end,case when n<=11 then '2026-10-02 12:00:00 America/Toronto'::timestamptz end from numbered`,[b.org,f.formId,f.revisionId,b.user,c,customer]);
    const filters={campaign:c,from:'2026-10-01',to:'2026-10-31'};
    const report=await readMarketing(b.db,b.org,'performance',filters);
    expect(report.summary).toMatchObject({acquired:30,attributed:30,cohort_handoffs:10,handoffs:11});
    expect(report.inquiries).toHaveLength(8);expect(report.inquiry_total).toBe(30);
    expect(report.sources.reduce((total,row)=>total+row.acquired,0)).toBe(30);
    const first=await readMarketing(b.db,b.org,'leads',filters),second=await readMarketing(b.db,b.org,'leads',{...filters,page:'2'});
    expect(first.inquiries).toHaveLength(25);expect(second.inquiries).toHaveLength(5);
    expect(new Set([...first.inquiries,...second.inquiries].map(i=>i.id)).size).toBe(30);
    const handoffs=await readMarketing(b.db,b.org,'leads',{...filters,handoff:'true',status:'handed_off'});
    expect(handoffs.inquiry_total).toBe(11);
    expect((await readMarketing(b.db,b.org,'leads',{...filters,q:'Missing source'})).inquiry_total).toBe(0);
  });

});
