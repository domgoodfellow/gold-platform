import {test,expect} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import {loadDemoContext,OWNER_STORAGE_STATE} from './helpers';
import {chooseOption,selectFieldValue} from './select-field';
import {DEMO_PASSWORD} from '../scripts/demo/businesses';
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
  for(const viewport of [{width:1440,height:900},{width:768,height:1024},{width:390,height:844}]){
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
  await page.goto(`${base}/field/calendar?view=day&on=${date}`);await expect(page).toHaveURL(/\/calendar\?.*workspace=field/);
  await page.getByRole('button',{name:`${title} edited`,exact:true}).click();drawer=page.getByRole('dialog',{name:'Edit event',exact:true});await drawer.getByRole('button',{name:'Cancel event',exact:true}).click();await expect(drawer).toBeHidden();
  await expect(page.getByRole('button',{name:`${title} edited`,exact:true})).toHaveCount(0);
  expect((await db.from('calendar_events').select('workspace,created_by,status').eq('id',record.data.id).single()).data).toMatchObject({workspace:'field',created_by:login.data.user.id,status:'cancelled'});
 });
});
