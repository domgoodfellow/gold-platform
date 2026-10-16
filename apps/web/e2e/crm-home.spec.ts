import { expect,test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { loadDemoContext,OWNER_STORAGE_STATE,COLLEAGUE_STORAGE_STATE } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { recordCommercialTerm } from '../lib/domain/commercial/terms';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { createOpportunityStage } from '../lib/domain/opportunities/opportunities';
import { todayInZone } from '../lib/domain/scheduling/window';
test.describe('Operating CRM journey',()=>{
  test.use({storageState:OWNER_STORAGE_STATE});
  test('creates customer, opportunity and follow-up, works calendar and next action, completes and closes at desktop and phone',async({page},testInfo)=>{
    test.setTimeout(180000);page.setDefaultTimeout(15000);loadEnv({path:path.join(__dirname,'..','..','..','.env.test')});
    const url=process.env.SUPABASE_URL??'';if(!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('Local CRM fixtures only.');
    const options={auth:{persistSession:false,autoRefreshToken:false}};const staff=createClient(url,process.env.SUPABASE_ANON_KEY??'',options);const owner=createClient(url,process.env.SUPABASE_ANON_KEY??'',options);const ctx=loadDemoContext();
    for(const [client,email] of [[staff,'staff@gold.test'],[owner,ctx.ownerEmail]] as const){const login=await client.auth.signInWithPassword({email,password:DEMO_PASSWORD});if(login.error)throw login.error;}
    const organizationId=await provisionOrganization(staff,{ownerEmail:ctx.ownerEmail,name:`Operating CRM acceptance ${Date.now()}`,displayName:'CRM owner',currency:'CAD',timezone:'America/Toronto'});
    const base=`/organizations/${organizationId}`;
    await page.setViewportSize({width:1600,height:1000});await page.goto(`${base}/sales`);await expect(page.getByRole('heading',{name:'CRM',exact:true})).toBeVisible();await expect(page.getByText('No customers yet. Add your first customer to start working.')).toBeVisible();await page.screenshot({path:testInfo.outputPath('crm-empty-desktop.png'),fullPage:true});
    await setModuleEnabled(owner,{organizationId,key:'reception',enabled:true});await recordCommercialTerm(staff,{organizationId,productKey:'module:reception',periodStart:new Date().toISOString().slice(0,10),periodEnd:'9999-12-31',priceMinor:0,note:'Local operating CRM fixture'});
    const open=await createOpportunityStage(owner,{organizationId,name:'Discuss',kind:'open',position:0});const won=await createOpportunityStage(owner,{organizationId,name:'Booked',kind:'won',position:1});await createOpportunityStage(owner,{organizationId,name:'Declined',kind:'lost',position:2});
    await page.reload();await page.getByRole('button',{name:'New customer',exact:true}).click();let drawer=page.getByRole('dialog',{name:'New customer',exact:true});await drawer.getByLabel('Name',{exact:true}).fill('CRM acceptance customer');await drawer.getByLabel('Email').fill('crm-acceptance@example.test');await drawer.getByRole('button',{name:'Add customer',exact:true}).click();await expect(drawer).toBeHidden();
    const customer=(await owner.from('customers').select('id').eq('organization_id',organizationId).eq('name','CRM acceptance customer').single()).data!;
    await page.getByRole('button',{name:'New opportunity',exact:true}).click();drawer=page.getByRole('dialog',{name:'New opportunity',exact:true});await drawer.getByLabel('Find customer').fill('CRM acceptance');await expect(drawer.getByRole('option',{name:'CRM acceptance customer'})).toHaveCount(1);await drawer.getByLabel('Customer',{exact:true}).selectOption(customer.id);await drawer.getByLabel('Title',{exact:true}).fill('Workshop expansion');await drawer.getByLabel('Opportunity stage').selectOption(open);await drawer.getByLabel('Value').fill('1250.50');await drawer.getByLabel('Currency').fill('CAD');await drawer.getByLabel('Owner').selectOption({label:'CRM owner'});
    const today=todayInZone('America/Toronto');await drawer.getByLabel('Expected close').fill(today);await drawer.getByRole('button',{name:'Save opportunity',exact:true}).click();await expect(page).toHaveURL(new RegExp(`${base}/opportunities/[a-f0-9-]+$`));const opportunityUrl=page.url();
    await page.getByRole('button',{name:'New follow-up',exact:true}).click();drawer=page.getByRole('dialog',{name:'New follow-up',exact:true});await expect(drawer.getByText('CRM acceptance customer',{exact:true})).toBeVisible();await expect(drawer.getByLabel('Opportunity')).not.toHaveValue('');await drawer.getByLabel('Type',{exact:true}).selectOption('meeting');await drawer.getByLabel('Title',{exact:true}).fill('Proposal review');await drawer.getByLabel('Due',{exact:true}).fill(`${today}T23:30`);await drawer.getByLabel('Owner').selectOption({label:'CRM owner'});await drawer.getByRole('button',{name:'Save follow-up',exact:true}).click();await expect(drawer).toBeHidden();await expect(page.getByText('Next action',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Proposal review',exact:true}).first()).toBeVisible();
    await page.goto(`${base}/sales`);await expect(page.getByRole('link',{name:/Follow-ups due today 1/})).toBeVisible();await expect(page.getByRole('link',{name:/Forecast this month/})).toContainText('CA$1,250.50');await expect(page.getByRole('region',{name:/Today/}).getByRole('button',{name:'Proposal review',exact:true})).toBeVisible();await page.screenshot({path:testInfo.outputPath('crm-operating-desktop.png'),fullPage:true});
    await page.getByRole('link',{name:'View calendar',exact:true}).click();await expect(page).toHaveURL(/calendar/);await expect(page.getByRole('button',{name:'Proposal review',exact:true})).toBeVisible();await page.getByRole('button',{name:'Proposal review',exact:true}).click();drawer=page.getByRole('dialog',{name:'Edit follow-up',exact:true});await drawer.getByLabel('Notes').fill('Review the revised proposal');await drawer.getByRole('button',{name:'Save follow-up',exact:true}).click();await expect(drawer).toBeHidden();await expect(page).toHaveURL(/calendar/);
    await page.getByRole('combobox',{name:'Follow-up owner',exact:true}).selectOption({label:'CRM owner'});await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page).toHaveURL(/owner=[a-f0-9-]+/);const calendarOwner=new URL(page.url()).searchParams.get('owner');
    await page.getByRole('link',{name:'Month',exact:true}).click();await expect.poll(()=>new URL(page.url()).searchParams.get('owner')).toBe(calendarOwner);await page.getByRole('button',{name:'Proposal review',exact:true}).click();drawer=page.getByRole('dialog',{name:'Edit follow-up',exact:true});await expect(drawer.getByLabel('Notes')).toHaveValue('Review the revised proposal');await drawer.getByRole('button',{name:'Close',exact:true}).click();await expect(page.getByLabel('month calendar',{exact:true})).toBeVisible();await page.screenshot({path:testInfo.outputPath('crm-calendar-month-desktop.png'),fullPage:true});await page.getByRole('link',{name:'Week',exact:true}).click();await page.screenshot({path:testInfo.outputPath('crm-calendar-week-desktop.png'),fullPage:true});
    await page.goto(`${base}/opportunities/pipeline`);await expect(page.getByRole('region',{name:'Discuss',exact:true}).getByText('Proposal review',{exact:true})).toBeVisible();await page.screenshot({path:testInfo.outputPath('crm-pipeline-desktop.png'),fullPage:true});await page.getByRole('button',{name:'Proposal review',exact:true}).click();drawer=page.getByRole('dialog',{name:'Edit follow-up',exact:true});await expect(drawer.getByLabel('Notes')).toHaveValue('Review the revised proposal');await drawer.getByRole('button',{name:'Close',exact:true}).click();await expect(page).toHaveURL(/opportunities\/pipeline/);
    await page.goto(`${base}/customers/${customer.id}`);await page.getByRole('tab',{name:'Follow-ups',exact:true}).click();await expect(page.getByRole('button',{name:'Proposal review',exact:true}).first()).toBeVisible();
    await page.goto(`${base}/sales`);await expect(page.getByRole('searchbox',{name:'Search CRM',exact:true})).toHaveCount(0);await expect(page.getByLabel('Reporting month')).toBeVisible();
    await page.goto(`${base}/follow-ups`);await page.getByLabel('Due state').selectOption('today');await page.getByRole('button',{name:'Filter',exact:true}).click();await expect(page).toHaveURL(/due=today/);await page.reload();await expect(page.getByLabel('Due state')).toHaveValue('today');await page.screenshot({path:testInfo.outputPath('crm-follow-ups-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});for(const [route,name] of [['sales','crm-home-mobile'],['follow-ups','crm-follow-ups-mobile'],['sales/calendar?view=month','crm-calendar-mobile'],['opportunities/pipeline','crm-pipeline-mobile']]){await page.goto(`${base}/${route}`);await expect(page.getByRole('heading',{level:1})).toBeVisible();const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);expect(fits).toBe(true);await page.screenshot({path:testInfo.outputPath(`${name}.png`),fullPage:true});}
    await page.goto(`${base}/sales`);const todayPanel=page.getByRole('region',{name:/Today/});await todayPanel.getByRole('button',{name:'Complete Proposal review',exact:true}).click();await expect(todayPanel.getByRole('button',{name:'Proposal review',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:/Follow-ups due today 0/})).toBeVisible();
    await page.goto(opportunityUrl);await expect(page.getByRole('region',{name:'Follow-ups',exact:true}).getByText('No next follow-up scheduled.')).toBeVisible();await page.getByRole('combobox',{name:'Stage for Workshop expansion'}).selectOption(won);await page.getByRole('button',{name:'Move',exact:true}).click();await expect(page.getByText('Booked · won',{exact:true}).filter({visible:true})).toBeVisible();await page.goto(`${base}/sales`);await expect(page.getByRole('link',{name:/Open opportunities 0/})).toBeVisible();await expect(page.getByRole('region',{name:'CRM Insights',exact:true}).getByText('100%',{exact:true})).toBeVisible();await page.screenshot({path:testInfo.outputPath('crm-completed-mobile.png'),fullPage:true});
  });
});
test.describe('CRM reduced role',()=>{test.use({storageState:COLLEAGUE_STORAGE_STATE});test('reads the cockpit without unauthorized mutation',async({page})=>{await page.goto(`/organizations/${loadDemoContext().organizationId}/sales`);await expect(page.getByRole('heading',{name:'CRM',exact:true})).toBeVisible();for(const name of ['New customer','New opportunity','New follow-up','Configure'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);});});


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
