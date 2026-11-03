import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';
import { BUSINESSES, DEMO_PASSWORD } from '../scripts/demo/businesses';
import { createForm, saveFormDraft, publishFormRevision } from '../lib/domain/forms/forms';
import { commandMarketing } from '../lib/domain/marketing/marketing';
import type { Db } from '../lib/db/types';
import { foundBusiness } from '../tests/support/founding';
import { chooseOption } from './select-field';

test.use({ storageState: OWNER_STORAGE_STATE, actionTimeout: 15000 });
test('Marketing acquisition, review, audiences and reporting journey',async({page,browser})=>{
  test.setTimeout(180000);
  config({path:path.resolve(__dirname,'../../../.env.test')});
  const {organizationId}=loadDemoContext(), base=`/organizations/${organizationId}/marketing`;
  const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_ANON_KEY!,{auth:{persistSession:false}}) as Db;
  if(!['localhost','127.0.0.1'].includes(new URL(process.env.SUPABASE_URL!).hostname)) throw new Error('Local test database required');
  const signed=await db.auth.signInWithPassword({email:BUSINESSES[0].owner.email,password:DEMO_PASSWORD});if(signed.error)throw signed.error;
  const shots=path.resolve(__dirname,'../test-results/marketing');mkdirSync(shots,{recursive:true});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1440,height:1050});await page.goto(base);await expect(page.getByRole('heading',{name:'Dashboard',level:1,exact:true})).toBeVisible();
  await page.screenshot({path:path.join(shots,'home-before.png'),fullPage:true});
  const name=`Winter campaign ${randomUUID().slice(0,6)}`;
  await page.getByRole('button',{name:'+ New campaign',exact:true}).click();await page.getByLabel('Campaign name', {exact:true}).fill(name);
  await page.getByLabel('Description',{exact:true}).fill('Seasonal acquisition planning with a published Studio Form.');
  await page.getByRole('checkbox',{name:'form',exact:true}).check();
  await page.screenshot({path:path.join(shots,'new-campaign.png'),fullPage:true});
  await page.getByRole('button',{name:'Create draft',exact:true}).click();await expect(page).toHaveURL(/marketing\/campaigns\/[\w-]+/);
  const campaignId=page.url().split('/').pop()!;
  const formName=`Winter inquiry ${randomUUID().slice(0,6)}`;const form=await createForm(db,{organizationId,name:formName});
  await saveFormDraft(db,{organizationId,revisionId:form.revisionId,definition:{title:'Request winter service',submitLabel:'Submit inquiry',confirmation:{title:'Inquiry received',message:'Your inquiry will be reviewed.'},fields:[{id:'name',type:'short_text',label:'Your name',required:true},{id:'email',type:'email',label:'Email',required:true}]}});
  await publishFormRevision(db,{organizationId,revisionId:form.revisionId});
  await page.reload();await chooseOption(page.getByLabel('Select form',{exact:true}), form.formId);await page.getByRole('button',{name:'Associate',exact:true}).last().click();await expect(page.getByRole('link',{name:formName,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Activate',exact:true}).click();await page.getByRole('dialog',{name:'Activate campaign?'}).getByRole('button',{name:'Activate',exact:true}).click();await expect(page.getByRole('link',{name:'Open form',exact:true})).toBeVisible();
  await page.getByLabel('UTM Source',{exact:true}).fill('newsletter');await page.getByLabel('UTM Medium',{exact:true}).fill('email');
  const acquisition=await page.getByRole('link',{name:'Open form',exact:true}).getAttribute('href');
  await page.screenshot({path:path.join(shots,'campaign-link.png'),fullPage:true});
  const visitor=await browser.newContext();const publicPage=await visitor.newPage();await publicPage.goto(new URL(acquisition!, page.url()).href);await publicPage.getByLabel('Your name',{exact:true}).fill('Browser prospect');await publicPage.getByLabel('Email',{exact:true}).fill(`prospect-${randomUUID()}@example.test`);await publicPage.getByRole('button',{name:'Submit inquiry',exact:true}).click();await expect(publicPage.getByRole('heading',{name:'Inquiry received',exact:true})).toBeVisible();await visitor.close();
  await page.goto(`${base}/leads?campaign=${campaignId}`);await expect(page.getByRole('cell',{name:'newsletter email',exact:true})).toBeVisible();await page.screenshot({path:path.join(shots,'leads.png'),fullPage:true});
  await page.getByRole('button',{name:'Review',exact:true}).first().click();await expect(page.getByText('Browser prospect',{exact:true})).toBeVisible();await page.screenshot({path:path.join(shots,'lead-inspector.png'),fullPage:true});
  await page.getByRole('button',{name:'Start review',exact:true}).click();await page.getByLabel('Explicitly create a new CRM Customer').check();await page.getByLabel('Customer name',{exact:true}).fill(`Browser prospect ${randomUUID().slice(0,5)}`);await page.getByLabel('Email',{exact:true}).fill(`crm-${randomUUID()}@example.test`);await page.getByRole('button',{name:'Create Customer and hand off',exact:true}).click();await expect(page.getByRole('link',{name:/Open CRM Customer:/})).toBeVisible();await page.screenshot({path:path.join(shots,'crm-handoff.png'),fullPage:true});await page.getByRole('link',{name:/Open CRM Customer:/}).click();await expect(page).toHaveURL(/\/crm\/contacts\/[\w-]+/);await expect(page.getByRole('heading',{name:/Browser prospect/})).toBeVisible();
  await page.goto(`${base}/audiences`);await page.getByRole('button',{name:'+ New audience',exact:true}).click();const audience=`Recent relationships ${randomUUID().slice(0,5)}`;await page.getByLabel('Audience name',{exact:true}).fill(audience);await page.screenshot({path:path.join(shots,'audience-editor.png'),fullPage:true});await page.getByRole('button',{name:'Save audience',exact:true}).click();await expect(page.getByText(audience,{exact:true})).toBeVisible();await page.screenshot({path:path.join(shots,'audiences.png'),fullPage:true});
  await page.getByRole('row').filter({hasText:audience}).getByRole('button',{name:'Inspect segment',exact:true}).click();await page.getByRole('button',{name:'Refresh saved audience preview',exact:true}).click();await expect(page.getByText(/matching Customers · showing up to 25/)).toBeVisible();await page.screenshot({path:path.join(shots,'audience-preview.png'),fullPage:true});await page.getByRole('button',{name:'Close',exact:true}).first().click();
  await page.goto(`${base}/campaigns/${campaignId}`);await chooseOption(page.getByLabel('Select audience',{exact:true}), {label:audience});await page.getByRole('button',{name:'Associate',exact:true}).first().click();await expect(page.getByRole('link',{name:audience,exact:true})).toBeVisible();await page.screenshot({path:path.join(shots,'campaign-detail.png'),fullPage:true});
  for(const [status,label] of [['draft','Referral planning'],['paused','Customer re-engagement'],['completed','Autumn campaign']] as const){const id=await commandMarketing(db,organizationId,'campaign.create',{name:`${label} ${randomUUID().slice(0,4)}`,objective:'awareness',channels:['manual']});if(status!=='draft'){await commandMarketing(db,organizationId,'campaign.status',{id,status:'active'});await commandMarketing(db,organizationId,'campaign.status',{id,status});}}
  await page.goto(`${base}/campaigns`);await page.screenshot({path:path.join(shots,'campaigns.png'),fullPage:true});
  await page.goto(`${base}/performance`);await expect(page.getByRole('heading',{name:'Acquisition cohort',exact:true})).toBeVisible();await page.screenshot({path:path.join(shots,'performance.png'),fullPage:true});
  for(const width of [1440,768,390]){await page.setViewportSize({width,height:1050});await page.goto(base);await expect(page.getByRole('heading',{name:'Dashboard',level:1,exact:true})).toBeVisible();await page.screenshot({path:path.join(shots,`home-${width}.png`),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}
  await page.getByRole('heading',{name:'Acquisition in this period',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(shots,'home-sources-mobile.png'),fullPage:true});
  await page.goto(`${base}/leads?campaign=${campaignId}`);await page.getByRole('button',{name:'Review',exact:true}).first().click();await expect(page.getByRole('link',{name:/Open CRM Customer:/})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:path.join(shots,'lead-inspector-mobile.png'),fullPage:true});
  expect(errors).toEqual([]);
});

test('Empty Marketing says once what is missing, without empty panels',async({page})=>{
  test.setTimeout(60000);
  const organizationId=await foundBusiness({ownerEmail:BUSINESSES[0].owner.email,name:`Empty Marketing ${randomUUID().slice(0,5)}`,currency:'CAD',timezone:'America/Toronto'});
  await page.setViewportSize({width:1440,height:1050});await page.goto(`/organizations/${organizationId}/marketing`);
  await expect(page.getByRole('heading',{name:'Dashboard',level:1,exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Needs attention',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Status',exact:true})).toBeVisible();
  // Batch C: one statement per absence; no empty activity feed, no navigation cards.
  await expect(page.getByText('Nothing needs attention.')).toBeVisible();
  await expect(page.getByRole('heading',{name:'Recent activity',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Quick actions',exact:true})).toHaveCount(0);
  await expect(page.getByRole('link',{name:/Active campaigns\s*0/})).toBeVisible();
  await page.screenshot({path:path.resolve(__dirname,'../test-results/marketing/home-empty.png'),fullPage:true});
});


test('public marketing menu groups authentication and demo in its footer', async ({ browser }, testInfo) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    for (const width of [320, 375, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/pricing');
      if (width < 640) {
        await page.getByRole('button', { name: 'Open menu' }).click();
        const sheet = page.getByRole('dialog');
        const footer = sheet.locator('[data-slot="sheet-footer"]');
        await expect(footer.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
        await expect(footer.getByRole('link', { name: 'Request a demo' })).toHaveAttribute('href', '/demo');
        await expect(sheet.getByRole('navigation').getByRole('link', { name: 'Log in' })).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath(`marketing-menu-${width}.png`) });
        await page.keyboard.press('Escape');
      } else {
        await expect(page.locator('header').getByRole('link', { name: 'Log in' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`marketing-${width}.png`) });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  } finally { await context.close(); }
});
