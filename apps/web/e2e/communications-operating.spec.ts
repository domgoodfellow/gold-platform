import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import path from 'node:path';
import { loadDemoContext, OWNER_STORAGE_STATE, COLLEAGUE_STORAGE_STATE } from './helpers';
import { BUSINESSES, DEMO_PASSWORD } from '../scripts/demo/businesses';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { recordCommercialTerm } from '../lib/domain/commercial/terms';
import { createCustomer } from '../lib/domain/customers/customers';
import { createRoute, setRouteTargets, listRouteTargets } from '../lib/domain/reception/routing';
import { createCallOutcome } from '../lib/domain/reception/outcomes';
import { currentMembershipId, getInboxCounts, listInbox } from '../lib/domain/reception/inbox';
import { createRole } from '../lib/domain/tenancy/roles';
import { addMember } from '../lib/domain/tenancy/members';
import { assignPhoneNumber } from '../lib/domain/reception/numbers';
import { listCallPage, getCallCounts } from '../lib/domain/reception/calls';
import { todayInZone, zonedDayRange } from '../lib/domain/scheduling/window';

async function capture(page: Page, file: string) {
  await page.addStyleTag({ content: '[data-slot="sidebar-wrapper"] { height: auto !important; min-height: 100svh; overflow: visible !important; } [data-slot="sidebar-inset"] { overflow: visible !important; }' });
  await page.screenshot({ path: file, fullPage: true });
  await page.evaluate(() => { const styles = [...document.querySelectorAll('style')]; styles.find(style => style.textContent?.includes('[data-slot="sidebar-wrapper"] { height: auto'))?.remove(); });
}

test.describe('Communications operating hub', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });
  test('renders real records, preserves routing targets, and connects operating destinations', async ({ page, browser }, testInfo) => {
    test.setTimeout(240000);
    page.setDefaultTimeout(15000);
    loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env.test') });
    const url = process.env.SUPABASE_URL!;
    const databaseUrl = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    for (const address of [url, databaseUrl]) if (!['127.0.0.1','localhost'].includes(new URL(address).hostname)) throw new Error('Communications fixtures must remain local.');
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const owner = createClient(url, process.env.SUPABASE_ANON_KEY!, options);
    const staff = createClient(url, process.env.SUPABASE_ANON_KEY!, options);
    const ctx = loadDemoContext();
    for (const [db,email] of [[owner,ctx.ownerEmail],[staff,'staff@gold.test']] as const) {
      const { error } = await db.auth.signInWithPassword({ email, password: DEMO_PASSWORD }); if (error) throw error;
    }
    const organizationId = await provisionOrganization(staff, { ownerEmail: ctx.ownerEmail, name: `Communications acceptance ${Date.now()}`, displayName: 'Communications operator', currency: 'CAD', timezone: 'America/Toronto' });
    await setModuleEnabled(owner, { organizationId, key: 'reception', enabled: true });
    await recordCommercialTerm(staff, { organizationId, productKey: 'module:reception', periodStart: todayInZone('America/Toronto'), periodEnd: '9999-12-31', priceMinor: 0, note: 'Local Communications acceptance fixture' });
    const base = `/organizations/${organizationId}`, home = `${base}/comms`;
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(home);
    for (const name of ['Needs attention','Inbox queue','Recent call activity','Today','Communications status','Recent activity','Insights']) await expect(page.getByRole('region',{ name, exact: true })).toBeVisible();
    await capture(page, testInfo.outputPath('communications-empty-desktop.png'));
    const pg = new Client({ connectionString: databaseUrl }); await pg.connect();
    try {
      const membershipId = (await currentMembershipId(owner,{ organizationId }))!;
      const e164 = `+1416${Math.floor(1000000 + Math.random()*8999999)}`;
      const number = (await pg.query(`insert into public.phone_numbers (organization_id,e164,label,origin,lifecycle,purpose,voice_outbound_enabled,sms_outbound_enabled,voice_inbound_enabled,sms_inbound_enabled) values ($1,$2,'Main line','external','active','main',true,true,false,false) returning id`, [organizationId,e164])).rows[0].id;
      await assignPhoneNumber(owner,{ organizationId,phoneNumberId:number,memberId:membershipId,isDefault:true });
      const identity = (await pg.query(`insert into public.email_identities (organization_id,address,ownership,can_receive) values ($1,'support@communications.example.test','gildops_managed',true) returning id`,[organizationId])).rows[0].id;
      const customerNames = ['North Shore Plumbing','Vertex HVAC','Maple Dental','Lumiere Studio','Aster Electric','Riverside Property Management'];
      const customers = await Promise.all(customerNames.map(name => createCustomer(owner,{ organizationId,name })));
      const outcome = await createCallOutcome(owner,{ organizationId,name:'Discussed request',reached:true });
      const routeId = await createRoute(owner,{ organizationId,name:'Main reception',numberId:null,whenMode:'always',ringStrategy:'sequential',ringTimeoutSeconds:20,destinationType:'members',fallbackType:'members' });
      for (const slot of ['primary','fallback'] as const) await setRouteTargets(owner,{ organizationId,routeId,slot,memberIds:[membershipId] });
      const conversationIds: string[] = [];
      for (let i=0;i<6;i++) {
        const email = i === 3;
        const row = await pg.query(`insert into public.conversations (organization_id,channel,phone_number_id,external_number,email_identity_id,external_email,customer_id,last_message_at,last_message_preview,unread,status,assignee_membership_id) values ($1,$2,$3,$4,$5,$6,$7,now()-($8::int*interval '8 minutes'),$9,$10,$11,$12) returning id`,[organizationId,email?'email':'sms',email?null:number,email?null:`+143855501${20+i}`,email?identity:null,email?'customer@example.test':null,customers[i],i,`Service request ${i+1}: please confirm availability`,i<2,i===2?'waiting':'open',i%2===0?null:membershipId]);
        conversationIds.push(row.rows[0].id);
        if (!email) await pg.query(`insert into public.messages (organization_id,conversation_id,direction,status,body,created_at) values ($1,$2,'inbound','delivered',$3,now()-($4::int*interval '8 minutes'))`,[organizationId,row.rows[0].id,`Service request ${i+1}: please confirm availability`,i]);
      }
      await pg.query("update public.conversations set status='waiting' where id=$1",[conversationIds[2]]);
      for (let i=0;i<5;i++) await pg.query(`insert into public.calls (organization_id,customer_id,direction,status,from_number,to_number,phone_number_id,note,started_at,answered_at,ended_at,duration_seconds,outcome_id,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,now()-($9::int*interval '15 minutes'),case when $4='completed' then now()-($9::int*interval '15 minutes')+interval '10 seconds' else null end,now()-($9::int*interval '15 minutes')+interval '3 minutes',case when $4='completed' then 170 else 0 end,$10,$11)`,[organizationId,customers[i],i===0?'inbound':'outbound',i===0?'no_answer':'completed',i===0?'+14385550123':e164,i===0?e164:`+143855501${30+i}`,number,i===0?'New customer inquiry':'Discussed service request',i+1,i===2?outcome:null,(await owner.auth.getUser()).data.user!.id]);
      const day = zonedDayRange(todayInZone('America/Toronto'),'America/Toronto');
      expect((await getCallCounts(owner,{organizationId,dayStart:day.startsAt,dayEnd:day.endsAt})).today).toBe(5);
      expect((await listCallPage(owner,{organizationId,limit:1})).total).toBe(5);
      expect((await listInbox(owner,{organizationId,limit:1})).total).toBe(6);
      expect((await getInboxCounts(owner,{organizationId,membershipId})).unread).toBe(2);
      await page.reload();
      await expect(page.getByRole('region',{name:'Inbox queue',exact:true}).getByText('North Shore Plumbing', {exact:true})).toBeVisible();
      await capture(page, testInfo.outputPath('communications-populated-desktop.png'));
      await page.locator('[data-slot=sidebar-trigger]').click();
      await capture(page, testInfo.outputPath('communications-populated-wide.png'));
      await page.locator('[data-slot=sidebar-trigger]').click();
      for (const width of [768,390]) { await page.setViewportSize({width,height:1000}); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await capture(page, testInfo.outputPath(`communications-populated-${width}.png`)); }
      await page.setViewportSize({width:1440,height:1000});
      await page.getByRole('navigation',{name:'Attention categories'}).getByRole('link',{name:'Unread (2)',exact:true}).click();
      let attention = page.getByRole('region',{name:'Needs attention',exact:true});
      await attention.getByRole('button',{name:'Actions for North Shore Plumbing'}).click(); await page.getByRole('menuitem',{name:'Mark read',exact:true}).click();
      await expect.poll(async () => (await getInboxCounts(owner,{organizationId,membershipId})).unread).toBe(1);
      await page.getByRole('navigation',{name:'Attention categories'}).getByRole('link',{name:/Unassigned/}).click();
      attention = page.getByRole('region',{name:'Needs attention',exact:true});
      await attention.getByRole('button',{name:'Actions for North Shore Plumbing'}).click(); await page.getByRole('menuitem',{name:'Assign to me',exact:true}).click();
      await expect.poll(async () => (await listInbox(owner,{organizationId})).items.find(item=>item.id===conversationIds[0])?.assignee?.membershipId).toBe(membershipId);
      // Hubs carry no search; the period control is in the header.
      await expect(page.getByLabel('Search Communications')).toHaveCount(0);
      await page.getByLabel('Communication date range').filter({visible:true}).selectOption('week'); await page.getByRole('button',{name:'Apply',exact:true}).filter({visible:true}).click(); await expect(page).toHaveURL(/when=week/);
      await page.getByRole('button',{name:'New call',exact:true}).click(); await expect(page.getByRole('dialog',{name:'New call',exact:true})).toBeVisible(); await page.getByRole('dialog',{name:'New call',exact:true}).getByRole('button',{name:'Close',exact:true}).click();
      await page.getByRole('region',{name:'Inbox queue',exact:true}).getByRole('link',{name:/North Shore Plumbing/}).click();
      await expect(page).toHaveURL(new RegExp(conversationIds[0]));
      await page.getByRole('group',{name:'Conversation status',exact:true}).getByRole('button',{name:'Waiting',exact:true}).click();
      await expect.poll(async () => (await listInbox(owner,{organizationId})).items.find(item => item.id===conversationIds[0])?.status).toBe('waiting');
      await expect(page.getByRole('group',{name:'Conversation status',exact:true}).getByRole('button',{name:'Waiting',exact:true})).toHaveAttribute('aria-pressed','true');
      await capture(page, testInfo.outputPath('communications-inbox-split.png'));
      await page.setViewportSize({width:390,height:844}); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await capture(page, testInfo.outputPath('communications-inbox-mobile.png'));
      await page.setViewportSize({width:1440,height:1000}); await page.goto(`${base}/calls`); await expect(page.getByRole('heading',{name:'Calls',exact:true})).toBeVisible(); await capture(page, testInfo.outputPath('communications-calls.png'));
      await page.getByRole('button',{name:'Wrap up',exact:true}).first().click();
      const wrapDrawer = page.getByRole('dialog',{name:'Wrap up call',exact:true});
      await wrapDrawer.getByLabel('How it went').selectOption(outcome); await wrapDrawer.getByLabel('What was said').fill('Acceptance wrap-up persisted');
      await wrapDrawer.getByRole('button',{name:'Save',exact:true}).click();
      await expect.poll(async () => Number((await pg.query('select count(*) from public.calls where organization_id=$1 and note=$2 and outcome_id=$3',[organizationId,'Acceptance wrap-up persisted',outcome])).rows[0].count)).toBe(1);
      await wrapDrawer.getByRole('button',{name:'Close',exact:true}).click();
      await page.getByRole('link',{name:/North Shore Plumbing/}).first().click();
      await expect(page).toHaveURL(/\/calls\/[0-9a-f-]+$/);
      await page.goto(home);
      await page.getByRole('link',{name:/Outbound number/}).click(); await expect(page.getByRole('heading',{name:'Numbers',exact:true})).toBeVisible(); await capture(page, testInfo.outputPath('communications-numbers.png'));
      await page.goto(`${home}/numbers/${number}`); await expect(page.getByRole('heading',{name:/Main line/})).toBeVisible();
      await page.goto(`${base}/settings/calls#routing`); await expect(page.getByRole('heading',{name:'Communications configuration',exact:true})).toBeVisible();
      await page.locator('#routing').getByRole('button',{name:'Edit',exact:true}).click();
      await expect(page.locator('#routing').getByRole('button',{name:'Save',exact:true})).toBeEnabled();
      await page.getByRole('button',{name:'Test route',exact:true}).click();
      await expect(page.locator('#routing').getByText('Active',{exact:true}).first()).toBeVisible();
      await expect(page.locator('#routing ol').getByText('Communications operator',{exact:true})).toHaveCount(2);
      await page.getByLabel('Route',{exact:true}).fill('Main reception updated');
      await capture(page, testInfo.outputPath('communications-configuration.png'));
      await page.locator('#routing').getByRole('button',{name:'Save',exact:true}).click();
      await expect.poll(async () => (await listRouteTargets(owner,{organizationId,routeId})).map(target=>`${target.slot}:${target.memberId}`).sort()).toEqual([`fallback:${membershipId}`,`primary:${membershipId}`]);
      await expect.poll(async () => (await pg.query('select name from public.communication_routes where id=$1',[routeId])).rows[0]?.name).toBe('Main reception updated');
      const roleId = await createRole(owner,{organizationId,name:'Communications viewer',capabilities:['customer.create']});
      await addMember(owner,{organizationId,email:BUSINESSES[0].member.email,roleId,displayName:'Viewer'});
      const restrictedContext = await browser.newContext({storageState:COLLEAGUE_STORAGE_STATE});
      try {
        const restricted = await restrictedContext.newPage(); await restricted.goto(`${testInfo.project.use.baseURL ?? process.env.E2E_BASE_URL ?? 'http://localhost:3000'}${home}`);
        await expect(restricted.getByRole('heading',{name:'Communications',exact:true})).toBeVisible();
        await expect(restricted.getByRole('button',{name:'New call',exact:true})).toHaveCount(0);
        await expect(restricted.getByRole('link',{name:'Compose message',exact:true})).toHaveCount(0);
        await expect(restricted.getByRole('button',{name:/Actions for/})).toHaveCount(0);
        await restricted.goto(`${process.env.E2E_BASE_URL ?? 'http://localhost:3000'}${base}/settings/calls`);
        await expect(restricted.locator('#routing')).toContainText('cannot change routing');
        await expect(restricted.locator('#routing').getByRole('button',{name:'Edit',exact:true})).toHaveCount(0);
      } finally { await restrictedContext.close(); }
      expect(errors).toEqual([]);
    } finally { await pg.end(); }
  });
});
