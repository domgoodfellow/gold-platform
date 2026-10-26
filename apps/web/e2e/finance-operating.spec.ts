import { expect, test, type Locator } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { loadDemoContext, OWNER_STORAGE_STATE, COLLEAGUE_STORAGE_STATE } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { createCustomer } from '../lib/domain/customers/customers';
import { createWorkItemType } from '../lib/domain/work-items/types';
import { createWorkItemStatus } from '../lib/domain/work-items/statuses';
import { createWorkItem } from '../lib/domain/work-items/work-items';
import { addPricedLine, listPricedLines } from '../lib/domain/pricing/prices';
import { getInvoiceForWorkItem, issueInvoice, recordPayment } from '../lib/domain/billing/invoices';
import { getOrganization, updateOrganization } from '../lib/domain/tenancy/organizations';
import { todayInZone, shiftDate, zonedTimeToInstant } from '../lib/domain/scheduling/window';

/** A record choice in a Finance dialog is a whole row; a person clicks the row. */
const choose = (dialog: Locator, name: RegExp) => dialog.locator('label').filter({ has: dialog.page().getByRole('radio', { name }) }).click();

test.describe('Finance operating journey', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });
  test('manages pricing, quotes, issuance, partial and final payments with responsive dashboard', async ({ page }, testInfo) => {
    test.setTimeout(240000); page.setDefaultTimeout(15000);
    const browserErrors: string[] = [];
    page.on('pageerror', error => browserErrors.push(error.message));
    loadEnv({ path: path.join(__dirname,'..','..','..','.env.test') });
    const url = process.env.SUPABASE_URL!;
    if (!['localhost','127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local Finance fixtures only.');
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const staff = createClient(url,process.env.SUPABASE_ANON_KEY!,options), owner = createClient(url,process.env.SUPABASE_ANON_KEY!,options);
    const ctx = loadDemoContext();
    for (const [db,email] of [[staff,'staff@gold.test'],[owner,ctx.ownerEmail]] as const) { const {error}=await db.auth.signInWithPassword({email,password:DEMO_PASSWORD}); if(error)throw error; }
    const organizationId = await provisionOrganization(staff,{ownerEmail:ctx.ownerEmail,name:`Finance acceptance ${Date.now()}`,displayName:'Finance owner',currency:'CAD',timezone:'America/Toronto'});
    const base = `/organizations/${organizationId}`, finance = `${base}/finance`;
    await setModuleEnabled(owner,{organizationId,key:'billing',enabled:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(finance);
    // A new business starts at its catalog (Finance V2.0), not at zero-valued figures.
    await expect(page.getByRole('region',{name:'Get started with Finance',exact:true})).toBeVisible();
    await page.screenshot({path:testInfo.outputPath('finance-empty-desktop.png'),fullPage:true,caret:'initial'});
    await page.locator('main').getByRole('link',{name:'Add services',exact:true}).first().click();
    await expect(page).toHaveURL(`${finance}/catalog`);
    // Price items are added and edited in their row of the price book, not in a drawer.
    await page.getByRole('button',{name:'Add price item',exact:true}).click();
    let row = page.getByRole('form',{name:'Add price item',exact:true});
    await row.getByLabel('Name of new price item',{exact:true}).fill('Service visit');
    await row.getByLabel('Unit of new price item',{exact:true}).fill('visit');
    await row.getByLabel('Amount in CAD for new price item',{exact:true}).fill('2400');
    await row.getByRole('button',{name:'Add',exact:true}).click();
    await expect(row).toHaveCount(0);
    await expect(page.getByRole('region',{name:'Price book'}).getByText('Service visit',{exact:true})).toBeVisible();
    const price = (await owner.from('price_book_items').select('id').eq('organization_id',organizationId).single()).data!;
    const typeId = await createWorkItemType(owner,{organizationId,name:'Service',schedulable:false});
    const statusId = await createWorkItemStatus(owner,{organizationId,typeId,name:'Open',position:0});
    const customerId = await createCustomer(owner,{organizationId,name:'North Shore Plumbing'});
    const workId = await createWorkItem(owner,{organizationId,statusId,title:'Service quote acceptance',customerId});
    await page.getByRole('button',{name:'Edit Service visit',exact:true}).click();
    row = page.getByRole('form',{name:'Edit Service visit',exact:true});
    await row.getByLabel('Name of Service visit').fill('Service inspection');
    await row.getByLabel('Amount in CAD for Service visit').fill('2500');
    await row.getByRole('button',{name:'Save',exact:true}).click();
    await expect(row).toHaveCount(0);
    await page.screenshot({path:testInfo.outputPath('finance-pricing-desktop.png'),fullPage:true,caret:'initial'});
    await page.goto(`${finance}/configuration/pricing`);
    await page.getByRole('link',{name:'Manage payment features',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Features',exact:true})).toBeVisible();
    await page.goto(finance);
    await page.getByRole('button',{name:'New quote',exact:true}).click();
    let dialog = page.getByRole('dialog',{name:'New quote',exact:true});
    await dialog.getByLabel('Search Work items').fill('Service quote acceptance');
    await choose(dialog,/Service quote acceptance/);
    await dialog.getByLabel('Service').selectOption(price.id);
    await dialog.getByRole('button',{name:'Add to quote',exact:true}).click();
    await expect(dialog.getByRole('status')).toContainText('Priced line added');
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await page.goto(`${finance}/quotes`);
    await expect(page.getByRole('link',{name:'Service quote acceptance',exact:true}).filter({visible:true})).toBeVisible();
    await page.screenshot({path:testInfo.outputPath('finance-quotes-desktop.png'),fullPage:true,caret:'initial'});
    await page.goto(finance);
    await page.getByRole('button',{name:'New invoice',exact:true}).click();
    dialog = page.getByRole('dialog',{name:'New invoice',exact:true});
    await dialog.getByLabel('Search priced Work').fill('North Shore');
    await choose(dialog,/Service quote acceptance/);
    const today = todayInZone('America/Toronto');
    await dialog.getByLabel('Invoice date').fill(today);
    await dialog.getByLabel(/Due date/).fill(shiftDate(today,7));
    await dialog.getByRole('button',{name:'Continue',exact:true}).click();
    await page.screenshot({path:testInfo.outputPath('finance-new-invoice-desktop.png'),fullPage:true,caret:'initial'});
    await dialog.getByRole('button',{name:'Issue invoice',exact:true}).click();
    await expect(dialog.getByRole('status')).toContainText('issued');
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    for (const amount of ['1000','1500']) {
      await page.getByRole('button',{name:'Record payment',exact:true}).first().click();
      dialog = page.getByRole('dialog',{name:'Record payment',exact:true});
      await dialog.getByLabel('Search invoices').fill('North Shore');
      await choose(dialog,/Invoice #1/);
      if (amount === '1000') {
        // Zero is refused before anything is sent, and what was typed stays.
        await dialog.getByLabel('Amount (CAD)',{exact:true}).fill('0');
        await expect(dialog.getByText(/Enter a positive amount/)).toBeVisible();
        await expect(dialog.getByRole('button',{name:'Record payment',exact:true})).toBeDisabled();
        await expect(dialog.getByLabel('Amount (CAD)',{exact:true})).toHaveValue('0');
      }
      await dialog.getByLabel('Amount (CAD)',{exact:true}).fill(amount);
      await page.screenshot({path:testInfo.outputPath(`finance-record-payment-${amount}.png`),fullPage:true,caret:'initial'});
      await dialog.getByRole('button',{name:'Record payment',exact:true}).click();
      await expect(dialog.getByRole('status')).toContainText('Payment recorded.');
      await dialog.getByRole('button',{name:'Done',exact:true}).click();
      const invoice = await getInvoiceForWorkItem(owner,{organizationId,workItemId:workId});
      expect(invoice!.payments.length).toBe(amount==='1000'?1:2);
    }
    // Invoices due today are due at the end of the local day, so they are not overdue whatever time the suite runs; the past-due ones are a day or more back.
    const names=['Vertex HVAC','Maple Dental','Aster Electric','Lumière Studio','Riverside Property','Cedar Tree Properties'];
    for (let i=0;i<names.length;i++) {
      const customerId = await createCustomer(owner,{organizationId,name:names[i]});
      const id = await createWorkItem(owner,{organizationId,statusId,title:`Inspection · ${names[i]}`,customerId});
      await addPricedLine(owner,{workItemId:id,priceBookItemId:price.id,quantity:i+1});
      if(i===5)continue;
      const invoiceId=await issueInvoice(owner,{workItemId:id,issuedAt:zonedTimeToInstant(shiftDate(today,-10),'00:00','America/Toronto'),dueAt:zonedTimeToInstant(shiftDate(today,i<3?-i-1:0),i<3?'12:00':'23:59','America/Toronto')});
      if(i<3)await recordPayment(owner,{invoiceId,amountMinor:50000+i*10000});
    }
    await page.goto(finance);
    const attention = page.getByRole('region',{name:'Needs attention',exact:true});
    await expect(attention.getByRole('button',{name:'Overdue 3'})).toBeVisible();
    await page.screenshot({path:testInfo.outputPath('finance-populated-desktop.png'),fullPage:true,caret:'initial'});
    await page.getByRole('heading',{name:'Receivables aging',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath('finance-populated-desktop-lower.png'),fullPage:true,caret:'initial'});
    // Due soon includes the two invoices due today and opens the same window in Invoices.
    await attention.getByRole('button',{name:/^Due soon/}).click();
    await attention.getByRole('link',{name:/View all/}).click();
    await expect(page).toHaveURL(/status=due-soon/);
    await expect(page.getByRole('status').filter({hasText:'match this view'})).toContainText('2 invoices');
    await page.goto(finance);
    await attention.getByRole('button',{name:/^Ready to invoice/}).click();
    await expect(attention.getByRole('link',{name:/Cedar Tree Properties/})).toBeVisible();
    for(const kind of ['invoices','payments']) { await page.goto(`${finance}/${kind}`); await page.screenshot({path:testInfo.outputPath(`finance-${kind}-desktop.png`),fullPage:true,caret:'initial'}); }
    await page.goto(`${finance}/reports`);await expect(page.getByRole('heading',{name:'Financial performance',exact:true})).toBeVisible();await expect(page.getByRole('columnheader',{name:'Margin on recorded costs',exact:true})).toBeVisible();
    await page.goto(`${finance}/invoices?status=overdue`);await expect(page.getByRole('status').filter({hasText:'match this view'})).toContainText('3 invoices');await page.reload();await expect(page).toHaveURL(/status=overdue/);await expect(page.getByRole('status').filter({hasText:'match this view'})).toContainText('3 invoices');
    await page.getByRole('link',{name:'#2',exact:true}).filter({visible:true}).click();await expect(page.getByRole('tab',{name:'Financials',exact:true})).toHaveAttribute('data-state','active');
    await page.goto(finance);await page.getByLabel('Reporting month',{exact:true}).fill('2025-12');await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page).toHaveURL(/month=2025-12/);await expect(page.getByLabel('Reporting month',{exact:true})).toHaveValue('2025-12');await expect(page.getByRole('link',{name:/Payments received None this month/})).toBeVisible();
    await expect(page.getByRole('searchbox',{name:'Search Finance',exact:true})).toHaveCount(0);await page.goto(`${finance}/search?q=Vertex`);await expect(page.getByRole('link',{name:'Vertex HVAC',exact:true}).filter({visible:true}).first()).toBeVisible();
    for(const width of [768,390]) { await page.setViewportSize({width,height:1000});await page.goto(finance);await expect(page.getByRole('heading',{name:'Dashboard',level:1,exact:true})).toBeAttached();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:testInfo.outputPath(`finance-populated-${width}.png`),fullPage:true,caret:'initial'});await page.getByRole('region',{name:'Financial activity',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`finance-populated-${width}-lower.png`),fullPage:true,caret:'initial'}); }
    // Finance V2.1: on a phone, Record payment is in the More menu.
    await page.getByRole('button',{name:'More finance actions'}).click();
    await page.getByRole('menuitem',{name:'Record payment'}).click();
    dialog = page.getByRole('dialog',{name:'Record payment',exact:true});
    await dialog.getByLabel('Search invoices').fill('Vertex');
    await choose(dialog,/Vertex HVAC/);
    await expect(dialog.getByLabel('Amount (CAD)',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:testInfo.outputPath('finance-payment-mobile.png'),fullPage:true,caret:'initial'});
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:1440,height:1000});
    // The business changes what it trades in (General Settings owns that), then re-prices: quoted and invoiced lines keep their snapshot.
    const organization = (await getOrganization(owner,organizationId))!;
    await updateOrganization(owner,{id:organizationId,name:organization.name,timezone:organization.timezone,bufferMinutes:organization.bufferMinutes,slug:organization.slug,currency:'USD'});
    await page.goto(`${finance}/catalog`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Priced in CAD')).toBeVisible();
    await page.getByRole('button',{name:'Edit Service inspection',exact:true}).click();
    row = page.getByRole('form',{name:'Edit Service inspection',exact:true});
    await row.getByLabel('Amount in CAD for Service inspection').fill('3000');
    await row.getByRole('button',{name:'Save',exact:true}).click();
    await expect(row).toHaveCount(0);
    const lines = await listPricedLines(owner,{organizationId,workItemId:workId});expect(lines[0].unitAmountMinor).toBe(250000);expect(lines[0].currency).toBe('CAD');
    const originalInvoice = await getInvoiceForWorkItem(owner,{organizationId,workItemId:workId});expect(originalInvoice!.lines[0].unitAmountMinor).toBe(250000);expect(originalInvoice!.currency).toBe('CAD');
    for(let i=0;i<21;i++) { const id=await createWorkItem(owner,{organizationId,statusId,title:`Pagination ${i}`,customerId});await addPricedLine(owner,{workItemId:id,priceBookItemId:price.id,quantity:1});await issueInvoice(owner,{workItemId:id}); }
    await page.goto(`${finance}/invoices`);
    await expect(page.getByRole('navigation',{name:'Pagination'})).toContainText('Page 1 of 2 · 27 records');
    await page.getByRole('link',{name:'Next',exact:true}).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByRole('navigation',{name:'Pagination'})).toContainText('Page 2 of 2 · 27 records');
    await page.getByRole('link',{name:'Previous',exact:true}).click();
    await expect(page).not.toHaveURL(/page=2/);
    expect(browserErrors).toEqual([]);
  });
});
test.describe('Finance reduced role',()=>{test.use({storageState:COLLEAGUE_STORAGE_STATE});test('does not offer unauthorized writes or aggregate reports',async({page})=>{await page.goto(`/organizations/${loadDemoContext().organizationId}/finance`);await expect(page.getByRole('heading',{name:'Dashboard',level:1,exact:true})).toBeAttached();for(const name of ['New invoice','New quote','Record payment'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Receivables aging'})).toHaveCount(0);});});
