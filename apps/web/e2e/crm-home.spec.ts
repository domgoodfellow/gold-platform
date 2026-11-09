import { expect,test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import path from 'node:path';
import { addContactManually,loadDemoContext,OWNER_STORAGE_STATE,COLLEAGUE_STORAGE_STATE } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { createOpportunityStage } from '../lib/domain/opportunities/opportunities';
import { todayInZone } from '../lib/domain/scheduling/window';
import { chooseOption, optionTexts, selectFieldValue } from './select-field';

/**
 * The operating CRM journey from the Dashboard, against the isolated run's disposable business
 * (`playwright.isolated.config.ts`): add a contact, open an opportunity and a follow-up, work it
 * through the calendar, pipeline, contact Tasks and task collection, complete it from Needs
 * attention, and close the opportunity, at desktop and phone widths. The empty-business Dashboard
 * is covered by `crm-dashboard.spec.ts`. Records carry a run-unique suffix.
 */
const run=Date.now().toString(36);
test.describe('Operating CRM journey',()=>{
  test.use({storageState:OWNER_STORAGE_STATE});
  // Deleting the business clears task and opportunity links, which fire the event triggers with no
  // signed-in actor; removing this run's tasks and opportunities first lets the run teardown succeed.
  test.afterAll(async()=>{const pg=new Client(process.env.SUPABASE_DB_URL);await pg.connect();try{const id=loadDemoContext().organizationId;await pg.query('delete from public.crm_tasks where organization_id=$1',[id]);await pg.query('delete from public.opportunities where organization_id=$1',[id]);}finally{await pg.end();}});
  test('creates contact, opportunity and follow-up, works calendar and next action, completes and closes at desktop and phone',async({page},testInfo)=>{
    test.setTimeout(240000);page.setDefaultTimeout(15000);loadEnv({path:path.join(__dirname,'..','..','..','.env.test'),quiet:true});
    const url=process.env.SUPABASE_URL??'';if(!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('Local CRM fixtures only.');
    const ctx=loadDemoContext();const organizationId=ctx.organizationId;
    const owner=createClient(url,process.env.SUPABASE_ANON_KEY??'',{auth:{persistSession:false,autoRefreshToken:false}});const login=await owner.auth.signInWithPassword({email:ctx.ownerEmail,password:DEMO_PASSWORD});if(login.error)throw login.error;
    const zone=(await owner.from('organizations').select('timezone').eq('id',organizationId).single()).data?.timezone??'UTC';
    const base=`/organizations/${organizationId}`;const customerName=`CRM acceptance contact ${run}`;
    const open=await createOpportunityStage(owner,{organizationId,name:`Discuss ${run}`,kind:'open',position:20});// One Won and one Lost stage per business: reuse them when another spec in this run already made them.
    const terminal=async(kind:'won'|'lost',name:string,position:number)=>{const found=(await owner.from('opportunity_stages').select('id,name').eq('organization_id',organizationId).eq('kind',kind).maybeSingle()).data;return found??{id:await createOpportunityStage(owner,{organizationId,name,kind,position}),name};};
    const wonStage=await terminal('won',`Booked ${run}`,21);const won=wonStage.id;await terminal('lost',`Declined ${run}`,22);

    await page.setViewportSize({width:1600,height:1000});await page.goto(`${base}/crm`);await expect(page.getByRole('heading',{level:1})).toBeVisible();await expect(page.getByRole('region',{name:'Relationship overview'})).toBeVisible();
    await addContactManually(page,{type:'person',name:customerName,email:`crm-acceptance-${run}@example.test`});let drawer=page.getByRole('dialog');
    const customer=(await owner.from('contacts').select('id').eq('organization_id',organizationId).eq('name',customerName).single()).data!;
    await page.goto(`${base}/crm`);await page.getByRole('button',{name:'New opportunity',exact:true}).click();drawer=page.getByRole('dialog',{name:'New opportunity',exact:true});await drawer.getByLabel('Find contact').fill(`CRM acceptance contact ${run}`);await expect.poll(() => optionTexts(drawer.getByLabel('Contact',{exact:true}))).toContain(customerName);await chooseOption(drawer.getByLabel('Contact',{exact:true}), customer.id);await drawer.getByLabel('Title',{exact:true}).fill(`Workshop expansion ${run}`);await chooseOption(drawer.getByLabel('Opportunity stage'), open);await drawer.getByLabel('Value').fill('1250.50');await drawer.getByLabel('Currency').fill('CAD');await chooseOption(drawer.getByLabel('Owner'), {index:1});
    const today=todayInZone(zone);await drawer.getByLabel('Expected close').fill(today);await drawer.getByRole('button',{name:'Save opportunity',exact:true}).click();await expect(page).toHaveURL(new RegExp(`${base}/crm/opportunities/[a-f0-9-]+$`));const opportunityUrl=page.url();
    await page.getByRole('button',{name:'New task',exact:true}).click();drawer=page.getByRole('dialog',{name:'New task',exact:true});await expect(drawer.getByText(customerName,{exact:true})).toBeVisible();await expect(selectFieldValue(drawer.getByLabel('Opportunity'))).not.toHaveValue('');await chooseOption(drawer.getByLabel('Type',{exact:true}), 'meeting');await drawer.getByLabel('Title',{exact:true}).fill(`Proposal review ${run}`);await drawer.getByLabel('Due',{exact:true}).fill(`${today}T23:59`);await chooseOption(drawer.getByLabel('Owner'), {index:1});await drawer.getByRole('button',{name:'Save follow-up',exact:true}).click();await expect(drawer).toBeHidden();await expect(page.getByText('Next action',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:`Proposal review ${run}`,exact:true}).first()).toBeVisible();

    // Dashboard: the task is due later today (never also overdue) and the forecast counts the opportunity.
    await page.goto(`${base}/crm`);const attention=page.getByRole('region',{name:'Needs attention'});await expect(attention.getByText(/Due today/)).toBeVisible();const dueTab=attention.getByRole('button',{name:/Due today/});if(await dueTab.count())await dueTab.click();await expect(attention.getByRole('button',{name:`Proposal review ${run}`,exact:true})).toBeVisible();
    await expect(page.getByRole('region',{name:'Opportunities & Pipeline'}).getByText('CA$1,250.50').first()).toBeVisible();await page.screenshot({path:testInfo.outputPath('crm-operating-desktop.png'),fullPage:true});

    await page.goto(`${base}/crm/calendar`);await expect(page.getByRole('button',{name:`Proposal review ${run}`,exact:true})).toBeVisible();await page.getByRole('button',{name:`Proposal review ${run}`,exact:true}).click();drawer=page.getByRole('dialog',{name:'Edit follow-up',exact:true});await drawer.getByLabel('Notes').fill('Review the revised proposal');await drawer.getByRole('button',{name:'Save follow-up',exact:true}).click();await expect(drawer).toBeHidden();await expect(page).toHaveURL(/calendar/);
    // The owner filter was replaced by the shared calendar's scope; the filter still survives view changes.
    await chooseOption(page.getByRole('combobox',{name:'Calendar scope',exact:true}), 'workspace');await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page).toHaveURL(/scope=workspace/);const calendarScope='workspace';
    await page.getByRole('link',{name:'Month',exact:true}).click();await expect.poll(()=>new URL(page.url()).searchParams.get('scope')).toBe(calendarScope);await page.getByRole('button',{name:`Proposal review ${run}`,exact:true}).click();drawer=page.getByRole('dialog',{name:'Edit follow-up',exact:true});await expect(drawer.getByLabel('Notes')).toHaveValue('Review the revised proposal');await drawer.getByRole('button',{name:'Close',exact:true}).click();await expect(page.getByLabel('month calendar',{exact:true})).toBeVisible();await page.screenshot({path:testInfo.outputPath('crm-calendar-month-desktop.png'),fullPage:true});await page.getByRole('link',{name:'Week',exact:true}).click();await page.screenshot({path:testInfo.outputPath('crm-calendar-week-desktop.png'),fullPage:true});
    await page.goto(`${base}/crm/pipeline`);await expect(page.getByRole('region',{name:`Discuss ${run}`,exact:true}).getByText(`Proposal review ${run}`,{exact:true})).toBeVisible();await page.screenshot({path:testInfo.outputPath('crm-pipeline-desktop.png'),fullPage:true});await page.getByRole('button',{name:`Proposal review ${run}`,exact:true}).click();drawer=page.getByRole('dialog',{name:'Edit follow-up',exact:true});await expect(drawer.getByLabel('Notes')).toHaveValue('Review the revised proposal');await drawer.getByRole('button',{name:'Close',exact:true}).click();await expect(page).toHaveURL(/\/crm\/pipeline/);
    await page.goto(`${base}/crm/contacts/${customer.id}`);await page.getByRole('link',{name:'Tasks',exact:true}).click();await expect(page.getByRole('button',{name:`Proposal review ${run}`,exact:true}).first()).toBeVisible();
    await page.goto(`${base}/crm`);await expect(page.getByRole('searchbox',{name:'Search CRM',exact:true})).toHaveCount(0);await expect(page.getByLabel('Month for expected closes and win rate')).toHaveCount(1);
    await page.goto(`${base}/crm/tasks`);await chooseOption(page.getByLabel('Due state'), 'today');await page.getByRole('button',{name:'Filter',exact:true}).click();await expect(page).toHaveURL(/due=today/);await page.reload();await expect(selectFieldValue(page.getByLabel('Due state'))).toHaveValue('today');await page.screenshot({path:testInfo.outputPath('crm-follow-ups-desktop.png'),fullPage:true});

    await page.setViewportSize({width:390,height:844});for(const [route,name] of [['crm','crm-home-mobile'],['crm/tasks','crm-follow-ups-mobile'],['crm/calendar?view=month','crm-calendar-mobile'],['crm/pipeline','crm-pipeline-mobile']]){await page.goto(`${base}/${route}`);await expect(page.getByRole('heading',{level:1})).toBeAttached();const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);expect(fits).toBe(true);await page.screenshot({path:testInfo.outputPath(`${name}.png`),fullPage:true});}

    // Completing from Needs attention removes it there and records it as relationship activity.
    await page.goto(`${base}/crm`);const dueAgain=page.getByRole('region',{name:'Needs attention'}).getByRole('button',{name:/Due today/});if(await dueAgain.count())await dueAgain.click();await page.getByRole('region',{name:'Needs attention'}).getByRole('button',{name:`Complete Proposal review ${run}`,exact:true}).click();await expect(page.getByRole('button',{name:`Proposal review ${run}`,exact:true})).toHaveCount(0);
    await page.reload();await expect(page.getByRole('region',{name:'Recently active relationships'}).getByText(`Meeting task completed: Proposal review ${run}`)).toBeVisible();
    await page.goto(opportunityUrl);await expect(page.getByRole('region',{name:'Tasks',exact:true}).getByText('No next action scheduled.')).toBeVisible();await chooseOption(page.getByRole('combobox',{name:`Stage for Workshop expansion ${run}`}), won);await page.getByRole('button',{name:'Move',exact:true}).click();await expect(page.getByText(`${wonStage.name} · won`,{exact:true}).filter({visible:true})).toBeVisible();
    await page.goto(`${base}/crm`);const sales=page.getByRole('region',{name:'Opportunities & Pipeline'});await expect(sales.getByText('100%',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Recently active relationships'}).getByText(`Opportunity Workshop expansion ${run} moved to ${wonStage.name}`)).toBeVisible();await page.screenshot({path:testInfo.outputPath('crm-completed-mobile.png'),fullPage:true});
  });
});
test.describe('CRM reduced role',()=>{test.use({storageState:COLLEAGUE_STORAGE_STATE});test('reads the dashboard without unauthorized mutation',async({page})=>{await page.goto(`/organizations/${loadDemoContext().organizationId}/crm`);await expect(page.getByRole('region',{name:'Relationship overview'})).toBeVisible();for(const name of ['Add contacts','New opportunity','New follow-up','Configure'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);});});


test.describe('Shared Work calendar foundation',()=>{
  test.use({storageState:OWNER_STORAGE_STATE});
  test('retains resource filters and navigates every view at desktop and phone widths',async({page},testInfo)=>{
    test.setTimeout(90000);
    const base=`/organizations/${loadDemoContext().organizationId}/schedule`;
    await page.setViewportSize({width:1600,height:1000});
    await page.goto(`${base}?view=day`);
    await expect(page.getByRole('navigation',{name:'Calendar views'})).toBeVisible();
    await expect(page.getByLabel('day calendar',{exact:true})).toBeVisible();
    await page.screenshot({path:testInfo.outputPath('work-calendar-day-desktop.png'),fullPage:true});
    await page.getByRole('button',{name:'All resources',exact:true}).click();
    await expect(page.getByRole('checkbox').first()).toBeVisible();
    await page.getByRole('checkbox').first().click();
    await expect(page).toHaveURL(/resource=/);
    await page.keyboard.press('Escape');
    const resources=new URL(page.url()).searchParams.getAll('resource');
    for(const view of ['Week','Month']){
      await page.getByRole('link',{name:view,exact:true}).click();
      await expect(page.getByLabel(`${view.toLowerCase()} calendar`,{exact:true})).toBeVisible();
      expect(new URL(page.url()).searchParams.getAll('resource')).toEqual(resources);
      await page.screenshot({path:testInfo.outputPath(`work-calendar-${view.toLowerCase()}-desktop.png`),fullPage:true});
    }
    await page.getByRole('link',{name:'Next →',exact:true}).click();
    await expect(page).toHaveURL(/view=month/);
    expect(new URL(page.url()).searchParams.getAll('resource')).toEqual(resources);
    await page.getByRole('link',{name:/^View [0-9]{4}-/}).first().click();
    await expect(page).toHaveURL(/view=day/);
    expect(new URL(page.url()).searchParams.getAll('resource')).toEqual(resources);
    await page.getByRole('button',{name:'Show this day',exact:true}).click();
    await expect(page.getByRole('grid')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:390,height:844});
    for(const view of ['Day','Week','Month']){
      await page.getByRole('link',{name:view,exact:true}).click();
      await expect(page.getByLabel(`${view.toLowerCase()} calendar`,{exact:true})).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
      await page.screenshot({path:testInfo.outputPath(`work-calendar-${view.toLowerCase()}-mobile.png`),fullPage:true});
    }
  });
});
