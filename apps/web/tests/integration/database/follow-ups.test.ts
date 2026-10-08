import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { beforeAll,describe,expect,it } from 'vitest';
import { foundBusiness } from '@/tests/support/founding';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { createOpportunity,createOpportunityStage,getOpportunity,listOpportunities,moveOpportunity,previewOpportunityPipeline,summarizeOpportunities } from '@/lib/domain/opportunities/opportunities';
import { createFollowUp,updateFollowUp,changeFollowUpStatus,listFollowUps } from '@/lib/domain/follow-ups/follow-ups';
import { crmDashboardSummary,winRate } from '@/lib/application/crm/dashboard';
import { dueFilter } from '@/lib/application/crm/follow-ups';
import { todayInZone,zonedDayRange } from '@/lib/domain/scheduling/window';
import { listCustomerTimeline,listRecentActivity } from '@/lib/domain/timeline/timeline';
const url=process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',options);
async function account(){const email=`follow-up-${randomUUID()}@example.test`;const password=randomUUID();const user=await admin.auth.admin.createUser({email,password,email_confirm:true});if(user.error)throw user.error;const db=createClient(url,process.env.SUPABASE_ANON_KEY??'',options);const login=await db.auth.signInWithPassword({email,password});if(login.error)throw login.error;return {email,db,id:user.data.user.id};}
describe('operating CRM under real PostgreSQL RLS',()=>{
  let owner:Awaited<ReturnType<typeof account>>,outsider:Awaited<ReturnType<typeof account>>,limited:Awaited<ReturnType<typeof account>>;
  let organizationId:string,otherOrg:string,customerId:string,secondCustomer:string,otherCustomer:string,opportunityId:string,wrongOpportunity:string,open:string,secondStage:string,won:string,lost:string,member:string,otherMember:string;
  beforeAll(async()=>{
    [owner,outsider,limited]=await Promise.all([account(),account(),account()]);
    organizationId=await foundBusiness({ownerEmail:owner.email,name:'Operating CRM',currency:'CAD'});otherOrg=await foundBusiness({ownerEmail:outsider.email,name:'Private CRM',currency:'USD'});
    customerId=await createCustomer(owner.db,{organizationId,name:'Working customer'});secondCustomer=await createCustomer(owner.db,{organizationId,name:'Different customer'});otherCustomer=await createCustomer(outsider.db,{organizationId:otherOrg,name:'Private customer'});
    open=await createOpportunityStage(owner.db,{organizationId,name:'Review',kind:'open',position:0});secondStage=await createOpportunityStage(owner.db,{organizationId,name:'Proposal',kind:'open',position:1});won=await createOpportunityStage(owner.db,{organizationId,name:'Won',kind:'won',position:2});lost=await createOpportunityStage(owner.db,{organizationId,name:'Lost',kind:'lost',position:3});
    const month=`${todayInZone('America/Toronto').slice(0,7)}-01`;
    opportunityId=await createOpportunity(owner.db,{organizationId,customerId,title:'Main opportunity',stageId:open,amountMinor:125050,currency:'CAD',expectedCloseOn:month});wrongOpportunity=await createOpportunity(owner.db,{organizationId,customerId:secondCustomer,title:'Other customer opportunity',stageId:secondStage});
    member=(await owner.db.from('memberships').select('id').eq('organization_id',organizationId).single()).data!.id;otherMember=(await outsider.db.from('memberships').select('id').eq('organization_id',otherOrg).single()).data!.id;
    const roleId=await createRole(owner.db,{organizationId,name:'CRM reader',capabilities:['customer.update']});await addMember(owner.db,{organizationId,email:limited.email,roleId});
  });
  it('enforces tenant reads, writes, owner scope and Customer/Opportunity consistency',async()=>{
    const input={organizationId,customerId,opportunityId,kind:'call' as const,title:'Private work',dueAt:new Date().toISOString()};
    const id=await createFollowUp(owner.db,input);
    expect(await listFollowUps(outsider.db,{organizationId})).toEqual([]);
    await expect(createFollowUp(outsider.db,input)).rejects.toBeInstanceOf(Error);
    await expect(changeFollowUpStatus(outsider.db,{organizationId,id,status:'completed'})).rejects.toBeInstanceOf(Error);
    for(const fields of [{customerId:otherCustomer},{opportunityId:wrongOpportunity},{ownerMembershipId:otherMember}])await expect(createFollowUp(owner.db,{...input,...fields})).rejects.toBeInstanceOf(Error);
    await expect(createFollowUp(limited.db,input)).rejects.toBeInstanceOf(Error);
    await expect(updateFollowUp(limited.db,{...input,id})).rejects.toBeInstanceOf(Error);
    await expect(changeFollowUpStatus(limited.db,{organizationId,id,status:'cancelled'})).rejects.toBeInstanceOf(Error);
    expect((await owner.db.from('crm_follow_ups').delete().eq('id',id)).error).not.toBeNull();
    const anon=createClient(url,process.env.SUPABASE_ANON_KEY??'',options);expect((await anon.from('crm_follow_ups').select('*')).data??[]).toEqual([]);
    await changeFollowUpStatus(owner.db,{organizationId,id,status:'cancelled'});
  });
  it('creates, reschedules, completes and cancels, with immutable attributed history',async()=>{
    const input={organizationId,customerId,opportunityId,kind:'meeting' as const,title:'Proposal review',dueAt:'2027-03-01T15:00:00Z',ownerMembershipId:member};
    const id=await createFollowUp(owner.db,input);await updateFollowUp(owner.db,{...input,id,title:'Review revised',dueAt:'2027-03-02T15:00:00Z'});
    expect((await listFollowUps(owner.db,{organizationId,opportunityId})).find(f=>f.id===id)).toMatchObject({title:'Review revised',ownerMembershipId:member,status:'open'});
    await changeFollowUpStatus(owner.db,{organizationId,id,status:'completed'});
    const row=(await owner.db.from('crm_follow_ups').select('*').eq('id',id).single()).data!;expect(row.completed_by).toBe(owner.id);expect(row.completed_at).not.toBeNull();
    await expect(updateFollowUp(owner.db,{...input,id})).rejects.toBeInstanceOf(Error);
    expect((await owner.db.from('crm_follow_ups').update({status:'open'}).eq('id',id)).error).not.toBeNull();
    expect((await owner.db.from('crm_follow_ups').update({completed_by:outsider.id}).eq('id',id)).error).not.toBeNull();
    const timeline=await listCustomerTimeline(owner.db,{organizationId,customerId});expect(timeline.some(e=>e.description==='Follow-up completed: Review revised')).toBe(true);
    expect((await listRecentActivity(owner.db,{organizationId,scope:'crm'})).some(e=>e.action==='follow_up.completed')).toBe(true);
  });
  it('derives next action by earliest open due time and removes completed/cancelled actions',async()=>{
    const input={organizationId,customerId,opportunityId,kind:'task' as const,title:'Next action',dueAt:'2028-01-01T15:00:00Z'};
    const later=await createFollowUp(owner.db,input);const earlier=await createFollowUp(owner.db,{...input,title:'Earlier action',dueAt:'2027-12-01T15:00:00Z'});
    expect((await getOpportunity(owner.db,{organizationId,opportunityId}))?.nextFollowUp?.id).toBe(earlier);
    await changeFollowUpStatus(owner.db,{organizationId,id:earlier,status:'completed'});expect((await getOpportunity(owner.db,{organizationId,opportunityId}))?.nextFollowUp?.id).toBe(later);
    await changeFollowUpStatus(owner.db,{organizationId,id:later,status:'cancelled'});expect((await getOpportunity(owner.db,{organizationId,opportunityId}))?.nextFollowUp).toBeNull();
    expect((await listOpportunities(owner.db,{organizationId,kind:'open',noNext:true})).some(o=>o.id===opportunityId)).toBe(true);
  });
  it('counts today/overdue in organization time and forecast/pipeline separately by currency',async()=>{
    const now=new Date();const today=todayInZone('America/Toronto',now);const month=`${today.slice(0,7)}-01`;const range=zonedDayRange(today,'America/Toronto');
    const dueAt=new Date(Math.min(Date.parse(range.endsAt)-1,now.getTime()+60000)).toISOString();
    const id=await createFollowUp(owner.db,{organizationId,customerId,opportunityId,kind:'call',title:'Today action',dueAt});
    const overdue=await createFollowUp(owner.db,{organizationId,customerId,kind:'task',title:'Overdue action',dueAt:new Date(Date.parse(range.startsAt)-1).toISOString()});
    await createOpportunity(owner.db,{organizationId,customerId,title:'USD forecast',stageId:open,amountMinor:9007199254740991,currency:'USD',expectedCloseOn:month});
    await createOpportunity(owner.db,{organizationId,customerId,title:'USD forecast two',stageId:open,amountMinor:9007199254740991,currency:'USD',expectedCloseOn:month});
    const summary=await crmDashboardSummary(owner.db,organizationId,month);expect(summary.customers).toBe(2);expect(summary.open).toBe(4);expect(summary.today).toBe(1);expect(summary.overdue).toBeGreaterThanOrEqual(1);
    expect(summary.forecast).toEqual(expect.arrayContaining([{currency:'CAD',amount_minor:'125050'},{currency:'USD',amount_minor:'18014398509481982'}]));
    expect((await listFollowUps(owner.db,{organizationId,status:'open',...dueFilter('today','America/Toronto',now)})).map(f=>f.id)).toEqual([id]);
    await changeFollowUpStatus(owner.db,{organizationId,id,status:'completed'});await changeFollowUpStatus(owner.db,{organizationId,id:overdue,status:'cancelled'});
    expect((await crmDashboardSummary(owner.db,organizationId,month)).today).toBe(0);
  });
  it('uses recorded Opportunity closures, deduplicates reclosures and preserves closed snapshots',async()=>{
    const month=`${todayInZone('America/Toronto').slice(0,7)}-01`;expect(winRate(0,0)).toBeNull();
    await moveOpportunity(owner.db,{organizationId,opportunityId,stageId:won});await moveOpportunity(owner.db,{organizationId,opportunityId:wrongOpportunity,stageId:lost});
    let summary=await crmDashboardSummary(owner.db,organizationId,month);expect(summary.won).toBe(1);expect(summary.lost).toBe(1);expect(winRate(summary.won,summary.lost)).toBe(0.5);
    await moveOpportunity(owner.db,{organizationId,opportunityId,stageId:open});await moveOpportunity(owner.db,{organizationId,opportunityId,stageId:won});
    summary=await crmDashboardSummary(owner.db,organizationId,month);expect(summary.won).toBe(1);expect(summary.lost).toBe(1);
    expect((await crmDashboardSummary(outsider.db,organizationId,month)).customers).toBe(0);
  });
  it('previews each stage independently of newer records in other stages, retaining exact totals',async()=>{
    const rows=Array.from({length:65},(_,i)=>({organization_id:organizationId,customer_id:customerId,title:`Review ${i}`,stage_id:open,created_by:owner.id}));expect((await owner.db.from('opportunities').insert(rows)).error).toBeNull();
    await createOpportunity(owner.db,{organizationId,customerId,title:'Proposal alone',stageId:secondStage});await createOpportunity(owner.db,{organizationId,customerId,title:'Unstaged alone'});
    const preview=await previewOpportunityPipeline(owner.db,organizationId);expect(preview.filter(o=>o.stageId===open)).toHaveLength(10);expect(preview.filter(o=>o.stageId===secondStage)).toHaveLength(1);expect(preview.filter(o=>o.stageId===null)).toHaveLength(1);expect(preview.some(o=>o.id===opportunityId)).toBe(true);
    const totals=await summarizeOpportunities(owner.db,{organizationId});expect(totals.find(s=>s.stageId===open)?.count).toBe(67);expect(await previewOpportunityPipeline(outsider.db,organizationId)).toEqual([]);
  });
});
