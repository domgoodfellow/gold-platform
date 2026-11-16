import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {createClient} from '@supabase/supabase-js';
import {beforeAll,describe,it,expect} from 'vitest';
import {foundBusiness} from '@/tests/support/founding';
import {createRole} from '@/lib/domain/tenancy/roles';
import {addMember} from '@/lib/domain/tenancy/members';
import {createCustomer} from '@/lib/domain/customers/customers';
import {createWorkItemType} from '@/lib/domain/work-items/types';
import {createWorkItemStatus} from '@/lib/domain/work-items/statuses';
import {createWorkItem} from '@/lib/domain/work-items/work-items';
import {scheduleWorkItem} from '@/lib/domain/scheduling/schedule';
import {saveCalendarEvent} from '@/lib/domain/calendar/events';
import {loadOrganizationCalendar} from '@/lib/application/calendar/organization-calendar';
import {listOrganizationActivity} from '@/lib/domain/timeline/timeline';
import type {Database} from '@/lib/db/types';
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient<Database>(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,options);
async function account(){const email=`shared-${randomUUID()}@example.test`,password=randomUUID();const user=await admin.auth.admin.createUser({email,password,email_confirm:true});if(user.error)throw user.error;const db=createClient<Database>(process.env.SUPABASE_URL!,process.env.SUPABASE_ANON_KEY!,options);const login=await db.auth.signInWithPassword({email,password});if(login.error)throw login.error;return{db,email,id:user.data.user.id};}
describe('shared Calendar and organization Activity under real RLS',()=>{
 let owner:Awaited<ReturnType<typeof account>>,member:Awaited<ReturnType<typeof account>>,outsider:Awaited<ReturnType<typeof account>>,organizationId:string,otherOrg:string,workId:string;
 const secret='Restricted contact details',within={startsAt:'2027-01-01T00:00:00Z',endsAt:'2027-02-01T00:00:00Z'};
 beforeAll(async()=>{
  [owner,member,outsider]=await Promise.all([account(),account(),account()]);
  organizationId=await foundBusiness({ownerEmail:owner.email,name:'Shared surfaces',currency:'CAD',displayName:'Shared owner'});otherOrg=await foundBusiness({ownerEmail:outsider.email,name:'Foreign activity',currency:'CAD'});
  const roleId=await createRole(owner.db,{organizationId,name:'No contact or finance access',capabilities:[]});await addMember(owner.db,{organizationId,email:member.email,roleId});
  const customerId=await createCustomer(owner.db,{organizationId,name:secret});
  const typeId=await createWorkItemType(owner.db,{organizationId,name:'Shared work',schedulable:true});const statusId=await createWorkItemStatus(owner.db,{organizationId,typeId,name:'Booked'});
  workId=await createWorkItem(owner.db,{organizationId,title:'Authorized Work',statusId,customerId});
  await scheduleWorkItem(owner.db,{workItemId:workId,resourceIds:[],startsAt:'2027-01-05T09:00:00Z',endsAt:'2027-01-05T10:00:00Z'});
  await saveCalendarEvent(owner.db,{organizationId,workspace:'crm',title:'Business-shared native event',startsAt:'2027-01-05T11:00:00Z',endsAt:'2027-01-05T12:00:00Z'});
 });
 it('keeps native events available without Tasks and projects readable Work without restricted contact details',async()=>{
  const data=await loadOrganizationCalendar(member.db,{organizationId,source:'all',within});
  expect(data.events.some(event=>event.title==='Business-shared native event')).toBe(true);
  expect(data.events.some(event=>event.source==='work'&&event.workId===workId)).toBe(true);
  expect(JSON.stringify(data)).not.toContain(secret);expect(data.mayManageTasks).toBe(false);
  const narrowed=await loadOrganizationCalendar(member.db,{organizationId,source:'events',workspace:'crm',within});expect(narrowed.events.map(event=>event.source)).toEqual(['calendar']);
 });
 it('refuses foreign organization aggregation even for a signed-in actor',async()=>{
  await expect(loadOrganizationCalendar(member.db,{organizationId:otherOrg,source:'all',within})).rejects.toMatchObject({code:'calendar.forbidden'});
  await expect(listOrganizationActivity(member.db,{organizationId:otherOrg})).rejects.toMatchObject({code:'activity.forbidden'});
 });
 it('returns only authorized descriptions and canonical links with tenant actor attribution',async()=>{
  const data=await listOrganizationActivity(member.db,{organizationId});
  expect(data.entries.some(entry=>entry.record?.id===workId&&entry.href===`/organizations/${organizationId}/work/${workId}`&&entry.actorName==='Shared owner')).toBe(true);
  expect(data.entries.some(entry=>entry.record?.type==='customer')).toBe(false);
  expect(JSON.stringify(data)).not.toContain(secret);
  const full=await listOrganizationActivity(owner.db,{organizationId});expect(full.entries.some(entry=>entry.record?.type==='customer'&&entry.href?.includes('/crm/contacts/'))).toBe(true);
 });
 it('does not format an inaccessible record or a financial/private payload merely because its event is readable',async()=>{
  // Synthetic malicious/local fixture rows exercise the aggregation boundary, not a new event writer.
  const pg=new Client(process.env.SUPABASE_DB_URL);await pg.connect();
  try{for(const row of [
    ['work_item',randomUUID(),'work_item.created',{title:'Hidden foreign Work snapshot'}],
    ['work_item',workId,'payment.recorded',{amount_minor:887799,currency:'CAD'}],
    ['customer',randomUUID(),'service_disclosure.saved',{title:'Private service payload'}],
    ['work_item',workId,'call.placed',{direction:'outbound'}],
  ])await pg.query('insert into events(organization_id,actor_id,entity_type,entity_id,action,payload) values($1,$2,$3,$4,$5,$6)',[organizationId,owner.id,...row]);}finally{await pg.end();}
  const data=await listOrganizationActivity(member.db,{organizationId});
  expect(JSON.stringify(data)).not.toContain('Hidden foreign Work snapshot');expect(JSON.stringify(data)).not.toContain('Private service payload');expect(data.entries.some(entry=>entry.action==='payment.recorded')).toBe(false);
  const full=await listOrganizationActivity(owner.db,{organizationId});
  expect(full.entries.some(entry=>entry.action==='call.placed'&&entry.record?.id===workId)).toBe(false);
 });
 it('bounds history and orders ties deterministically without an unread model',async()=>{
  const data=await listOrganizationActivity(owner.db,{organizationId,limit:1});expect(data.entries).toHaveLength(1);expect(data.more).toBe(true);expect(data).not.toHaveProperty('unread');
 });
});
