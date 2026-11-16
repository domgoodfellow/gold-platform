import {test,expect} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import {loadDemoContext,OWNER_STORAGE_STATE} from './helpers';
import {chooseOption,selectFieldValue} from './select-field';
import {DEMO_PASSWORD} from '../scripts/demo/businesses';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createRole} from '../lib/domain/tenancy/roles';
import {addMember} from '../lib/domain/tenancy/members';
import {createTask} from '../lib/domain/tasks/tasks';
import {loadOrganizationCalendar} from '../lib/application/calendar/organization-calendar';
import {listOrganizationActivity} from '../lib/domain/timeline/timeline';
import {createContact} from '../lib/domain/contacts/contacts';
import {todayInZone,shiftDate} from '../lib/domain/scheduling/window';

test.describe('shared organization Calendar',()=>{
 test.use({storageState:OWNER_STORAGE_STATE});
 test('uses one shared destination, retains filters, and creates edits and cancels attributed events',async({page},info)=>{
  test.setTimeout(180000);
  const context=loadDemoContext(), base=`/organizations/${context.organizationId}`;
  const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const login=await db.auth.signInWithPassword({email:context.ownerEmail,password:DEMO_PASSWORD});if(login.error)throw login.error;
  const org=await db.from('organizations').select('timezone').eq('id',context.organizationId).single();if(org.error)throw org.error;
  const date=shiftDate(todayInZone(org.data.timezone),1), title=`Shared Calendar ${Date.now()}`;
  await page.goto(`${base}/calendar?on=${date}`);
  await page.getByRole('button',{name:'New event',exact:true}).click();
  let drawer=page.getByRole('dialog',{name:'New event',exact:true});
  await expect(selectFieldValue(drawer.getByLabel('Workspace',{exact:true}))).toHaveValue('');
  await chooseOption(drawer.getByLabel('Workspace',{exact:true}),'field');
  await drawer.getByLabel('Title',{exact:true}).fill(title);
  await drawer.getByRole('button',{name:'Save event',exact:true}).click();await expect(drawer).toBeHidden();
  await expect(page.getByRole('button',{name:title,exact:true})).toBeAttached();
  const record=await db.from('calendar_events').select('id,workspace,created_by').eq('organization_id',context.organizationId).eq('title',title).single();if(record.error)throw record.error;
  expect(record.data).toMatchObject({workspace:'field',created_by:login.data.user.id});
  await page.getByRole('button',{name:title,exact:true}).click();drawer=page.getByRole('dialog',{name:'Edit event',exact:true});
  await drawer.getByLabel('Title',{exact:true}).fill(`${title} edited`);await drawer.getByRole('button',{name:'Save event',exact:true}).click();await expect(drawer).toBeHidden();
  for(const viewport of [{width:1720,height:1000},{width:1440,height:900},{width:768,height:1024},{width:390,height:844}]){
   await page.setViewportSize(viewport);await page.goto(`${base}/calendar?on=${date}&workspace=field&source=events`);
   await expect(page.getByRole('heading',{level:1,name:'Calendar',exact:true})).toBeAttached();
   for(const view of ['Week','Month','Day']){
    await page.getByRole('link',{name:view,exact:true}).click();const q=new URL(page.url()).searchParams;
    expect(q.get('workspace')).toBe('field');expect(q.get('source')).toBe('events');expect(q.get('on')).toBe(date);
    await expect(page.getByRole('button',{name:`${title} edited`,exact:true})).toBeAttached();
   }
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   await page.screenshot({path:info.outputPath(`calendar-${viewport.width}.png`),fullPage:true});
   if(viewport.width<768)await page.locator('header').getByRole('button',{name:'Menu',exact:true}).click();
   const nav=page.getByRole('navigation',{name:'This business',exact:true}).filter({visible:true});
   await expect(nav.getByRole('link',{name:'Calendar',exact:true})).toHaveAttribute('aria-current','page');
   if(viewport.width<768)await page.keyboard.press('Escape');
  }
  await page.goto(`${base}/crm/calendar?view=month&on=${date}&source=events`);
  await expect(page).toHaveURL(/\/calendar\?.*workspace=crm/);expect(new URL(page.url()).searchParams.get('on')).toBe(date);
  await expect(page.getByRole('button',{name:`${title} edited`,exact:true})).toHaveCount(0);
  await page.goto(`${base}/crm/tasks/calendar?view=week&on=${date}&source=events`);
  await expect(page).toHaveURL(/\/calendar\?.*view=week.*source=events.*workspace=crm/);
  await page.goto(`${base}/field/calendar?view=day&on=${date}`);await expect(page).toHaveURL(/\/calendar\?.*workspace=field/);
  await page.getByRole('button',{name:`${title} edited`,exact:true}).click();drawer=page.getByRole('dialog',{name:'Edit event',exact:true});await drawer.getByRole('button',{name:'Cancel event',exact:true}).click();await expect(drawer).toBeHidden();
  await expect(page.getByRole('button',{name:`${title} edited`,exact:true})).toHaveCount(0);
  expect((await db.from('calendar_events').select('workspace,created_by,status').eq('id',record.data.id).single()).data).toMatchObject({workspace:'field',created_by:login.data.user.id,status:'cancelled'});
 });
});


test.describe('global organization Activity',()=>{
 test.use({storageState:OWNER_STORAGE_STATE});
 test('keeps global and page Activity independent, preserves drafts, and shares responsive arbitration with Agent',async({page},info)=>{
  test.setTimeout(180000);
  const context=loadDemoContext(),base=`/organizations/${context.organizationId}`;
  const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const login=await db.auth.signInWithPassword({email:context.ownerEmail,password:DEMO_PASSWORD});if(login.error)throw login.error;
  const label=`Activity contact ${Date.now()}`;let latest='';
  for(let i=0;i<23;i++){latest=await createContact(db,{organizationId:context.organizationId,name:`${label} ${i}`,contactType:'person'});}
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  for(const viewport of [{width:1720,height:1000},{width:1440,height:900},{width:768,height:1024},{width:390,height:844}]){
   await page.setViewportSize(viewport);await page.goto(`${base}/crm`);
   const trigger=page.locator('header').getByRole('button',{name:'Organization activity',exact:true});
   await expect(trigger).toBeVisible();await expect(trigger).toHaveAttribute('aria-expanded','false');
   await page.locator('[data-slot="workspace-intro"]').getByRole('button',{name:'Activity',exact:true}).click();
   const local=page.getByRole('dialog',{name:'CRM activity',exact:true});await expect(local).toBeVisible();
   await trigger.focus();await page.keyboard.press('Enter');const global=page.getByRole('dialog',{name:'Organization activity',exact:true});
   await expect(global).toBeVisible();await expect(global).toHaveAttribute('aria-modal','false');await expect(local).toBeHidden();
   await expect(global.locator(`a[href="${base}/crm/contacts/${latest}"]`)).toBeVisible();await expect(global.getByText(`CRM: ${label} 22`,{exact:true})).toBeVisible();
   await expect(global.getByRole('listitem')).toHaveCount(20);await global.getByRole('button',{name:'Load more',exact:true}).click();
   await expect.poll(()=>global.getByRole('listitem').count()).toBeGreaterThan(20);
   const box=await global.boundingBox();expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width+1);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   await page.screenshot({path:info.outputPath(`activity-${viewport.width}.png`),fullPage:true});
   await global.getByRole('button',{name:'Close organization activity'}).focus();await page.keyboard.press('Escape');
   await expect(global).toBeHidden();await expect(trigger).toBeFocused();await expect(local).toBeVisible();
   await local.getByRole('button',{name:'Close',exact:true}).click();await expect(local).toBeHidden();
   await trigger.click();await expect(global).toBeVisible();
   if(viewport.width>=768){
    const nav=page.getByRole('navigation',{name:'This business',exact:true}).filter({visible:true});await nav.getByRole('link',{name:'Home',exact:true}).click();await expect(global).toBeVisible();
    await nav.getByRole('link',{name:'Work',exact:true}).click();await expect(page).toHaveURL(`${base}/field`);await expect(global).toBeVisible();
    const agent=page.locator('header').getByRole('button',{name:'Agent',exact:true});await agent.click();await expect(page.getByRole('button',{name:'Close Agent'})).toBeVisible();await expect(global).toBeHidden();
    if(viewport.width>=1280){
     await trigger.click();await expect(global).toBeVisible();await expect(page.getByRole('button',{name:'Close Agent'})).toBeHidden();
     await agent.click();await expect(page.getByRole('button',{name:'Close Agent'})).toBeVisible();await expect(global).toBeHidden();
    }
    await page.getByRole('button',{name:'Close Agent'}).click();await expect(global).toBeVisible();
   }else{
    await page.locator('header').getByRole('button',{name:'Menu',exact:true}).click();
    await page.getByRole('button',{name:'Agent',exact:true}).filter({visible:true}).click();
    await expect(page.getByRole('button',{name:'Close Agent'})).toBeVisible();await expect(global).toBeHidden();
    await page.getByRole('button',{name:'Close Agent'}).click();await expect(global).toBeVisible();
   }
   await global.getByRole('button',{name:'Close organization activity'}).click();
   await page.goto(`${base}/calendar`);await page.getByRole('button',{name:'New event',exact:true}).click();const draft=page.getByRole('dialog',{name:'New event',exact:true});await draft.getByLabel('Title',{exact:true}).fill('Keep this native event draft');
   await trigger.click();await expect(global).toBeVisible();await global.getByRole('button',{name:'Close organization activity'}).click();await expect(draft.getByLabel('Title',{exact:true})).toHaveValue('Keep this native event draft');
  }
  expect(errors).toEqual([]);
 });
});


test('entitled shared sources respect a real member without contact or management rights',async()=>{
 const context=loadDemoContext(),options={auth:{persistSession:false,autoRefreshToken:false}};
 const admin=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,options);
 const owner=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_ANON_KEY!,options);
 const login=await owner.auth.signInWithPassword({email:context.ownerEmail,password:DEMO_PASSWORD});if(login.error)throw login.error;
 const email=`shared-viewer-${randomUUID()}@example.test`,password=randomUUID();const user=await admin.auth.admin.createUser({email,password,email_confirm:true});if(user.error)throw user.error;
 const manifestPath=path.join(process.env.E2E_FIXTURE_DIR!,'fixtures.json');const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));manifest.userIds.push(user.data.user.id);writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
 const roleId=await createRole(owner,{organizationId:context.organizationId,name:`Read-only shared ${Date.now()}`,capabilities:[]});await addMember(owner,{organizationId:context.organizationId,email,roleId});
 const member=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_ANON_KEY!,options);const signed=await member.auth.signInWithPassword({email,password});if(signed.error)throw signed.error;
 const secret=`Restricted source contact ${randomUUID()}`,customerId=await createContact(owner,{organizationId:context.organizationId,name:secret,contactType:'person'});
 const dueAt=new Date(Date.now()+3600000).toISOString();const taskId=await createTask(owner,{organizationId:context.organizationId,customerId,kind:'meeting',title:'Authorized task without directory rights',dueAt});
 const calendar=await loadOrganizationCalendar(member,{organizationId:context.organizationId,source:'all',workspace:'crm',within:{startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString()}});
 expect(calendar.followUpsEnabled).toBe(true);expect(calendar.events.some(event=>event.source==='follow-ups'&&event.followUp.id===taskId)).toBe(true);expect(calendar.mayManageTasks).toBe(false);expect(JSON.stringify(calendar)).not.toContain(secret);
 const activity=await listOrganizationActivity(member,{organizationId:context.organizationId});expect(activity.entries.some(entry=>entry.record?.id===taskId)).toBe(true);expect(JSON.stringify(activity)).not.toContain(secret);
});
