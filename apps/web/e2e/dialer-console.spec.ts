import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';
import type { Database } from '../lib/db/types';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { createCustomer } from '../lib/domain/customers/customers';
import { createContact } from '../lib/domain/contacts/contacts';
import { createFollowUp } from '../lib/domain/follow-ups/follow-ups';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { grantPlanProduct } from '../lib/domain/catalogue/plans';
import { assignPhoneNumber } from '../lib/domain/reception/numbers';
import { currentMembershipId } from '../lib/domain/reception/inbox';
import { assignFixturePlan, createFixturePlan } from '../tests/support/plans';

/**
 * Rendered evidence for the Dialer console: a business with no calling account and nothing
 * recorded, and a business with a queue, a locally recorded calling account, an assigned outbound
 * number and a shared one. **Call is never pressed**: the local environment may hold real carrier
 * credentials, and the account and numbers here are database rows, not carrier acceptance. Each state of a call (ringing, connected, incoming, ended) is
 * captured from the development fixture route, which stands a test telephone where the real one
 * would be.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const WIDTHS = [{ name: 'wide', width: 1800, height: 1000 }, { name: 'desktop', width: 1440, height: 900 }, { name: 'small-desktop', width: 1024, height: 900 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'phone', width: 390, height: 844 }];

/**
 * Screenshot options for this spec. The text cursor is left as it is: hiding it (the default)
 * rewrites every input's style for the moment of capture, and a region of the page that is still
 * being made interactive reports that as a mismatch with what the server sent.
 */
const shot = (path: string) => ({ path, caret: 'initial' as const });

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('Dialer console keeps its operating composition empty, populated, focused and popped out', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  config({ path: path.join(__dirname, '../../..', '.env.test'), quiet: true });
  const url = process.env.SUPABASE_URL!;
  const connection = process.env.SUPABASE_DB_URL!;
  if (![url, connection].every(value => ['localhost', '127.0.0.1'].includes(new URL(value).hostname))) throw new Error('Disposable loopback fixtures only');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
  const db = createClient<Database>(url, process.env.SUPABASE_ANON_KEY!, options);
  const email = `dialer-console-${randomUUID()}@example.test`, password = randomUUID();
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error) throw made.error;
  const pg = new Client(connection); await pg.connect();
  const organizations: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await pg.query('insert into platform_staff(user_id,name) values($1,$2)', [made.data.user.id, 'Local Dialer console fixture']);
    const login = await db.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
    for (const name of ['Dialer empty business', 'Dialer queue business']) organizations.push(await provisionOrganization(db, { ownerEmail: email, name, currency: 'CAD', timezone: 'America/Toronto', displayName: 'Jane Doe' }));
    const [empty, populated] = organizations;
    const planId = await createFixturePlan({ key: `dialer_console_${Date.now()}`, kind: 'plan', label: 'Local Dialer console', description: 'Local browser fixture only', billable: false });
    for (const productKey of ['comms', 'sales']) await grantPlanProduct(db, { planId, productKey });
    for (const organizationId of organizations) {
      await setModuleEnabled(db, { organizationId, key: 'reception', enabled: true });
      await pg.query("insert into organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note) values($1,'module:reception','2020-01-01','9999-12-31',1,0,'CAD',$2,'Local Dialer console fixture')", [organizationId, made.data.user.id]);
      await assignFixturePlan({ organizationId, planId, periodStart: '2020-01-01', periodEnd: '9999-12-31' });
    }
    // The populated business: a locally assigned outbound number and a real call list.
    const number = (await pg.query("insert into public.phone_numbers (organization_id,e164,label,origin,lifecycle,purpose,voice_outbound_enabled,sms_outbound_enabled,voice_inbound_enabled,sms_inbound_enabled) values ($1,'+14385550100','Main line','external','active','main',true,false,false,false) returning id", [populated])).rows[0].id;
    await assignPhoneNumber(db, { organizationId: populated, phoneNumberId: number, memberId: (await currentMembershipId(db, { organizationId: populated }))!, isDefault: true });
    // A second number the business shares, and a calling account recorded as active, so the line a
    // call would use is resolved and shown. The account id is made up; nothing can be rung through it.
    await pg.query("insert into public.phone_numbers (organization_id,e164,label,origin,lifecycle,purpose,voice_outbound_enabled,sms_outbound_enabled,voice_inbound_enabled,sms_inbound_enabled,outbound_shared) values ($1,'+14385550111','Sales line','external','active','sales',true,false,false,false,true)", [populated]);
    await pg.query("insert into public.organization_provider_bindings (organization_id,provider_key,external_account_id,status) values ($1,'twilio',$2,'active')", [populated, `AC${randomUUID().replace(/-/g, '')}`]);
    // Someone the business has called who is on no call list: a person at a company.
    const offListCompany = await createContact(db, { organizationId: populated, name: 'Harbour Mechanical', phone: '+14385550170', contactType: 'company' });
    const offList = await createContact(db, { organizationId: populated, name: 'Priya Nair', phone: '+14385550171', email: 'priya@harbour.example.test', contactType: 'person', companyId: offListCompany, affiliationTitle: 'Facilities manager' });
    const people: [string, string | null, string | null, string][] = [
      ['Sarah Mitchell', '+14385550194', 'sarah@northshore.example.test', 'Quote follow-up for the boiler service'],
      ['Mike Chen', '+14385550123', null, 'Confirm the maintenance visit'],
      ['Emily Carter', '+14385550188', 'emily@maple.example.test', 'Discuss the renewal'],
      ['Tom Rivera', null, null, 'Call about the open service request'],
      ['Jessica Park', '+14385550160', null, 'Introduce the spring offer'],
    ];
    const customers: string[] = [];
    for (const [index, [name, phone, mail, title]] of people.entries()) {
      const customerId = await createCustomer(db, { organizationId: populated, name, phone: phone ?? undefined, email: mail ?? undefined });
      customers.push(customerId);
      await createFollowUp(db, { organizationId: populated, customerId, title, kind: 'call', notes: index === 0 ? 'Asked for a call before Friday about the quote.' : undefined, dueAt: new Date(Date.now() + (index - 1) * 3_600_000).toISOString() });
    }
    // Recorded history only — rows written locally, never a carrier call: one finished call with
    // Sarah Mitchell that still needs an outcome, and one in progress for the live-call fixture.
    const membershipId = (await currentMembershipId(db, { organizationId: populated }))!;
    await pg.query("insert into public.calls (organization_id,customer_id,direction,status,from_number,to_number,phone_number_id,started_at,answered_at,ended_at,duration_seconds,created_by) values ($1,$2,'outbound','completed','+14385550100','+14385550194',$3,now()-interval '2 days',now()-interval '2 days'+interval '8 seconds',now()-interval '2 days'+interval '4 minutes',232,$4)", [populated, customers[0], number, made.data.user.id]);
    const liveCall = (await pg.query("insert into public.calls (organization_id,customer_id,direction,status,from_number,to_number,phone_number_id,conference_name,started_at,answered_at,created_by) values ($1,$2,'outbound','in_progress','+14385550100','+14385550194',$3,'local-dialer-console-fixture',now()-interval '2 minutes',now()-interval '2 minutes',$4) returning id", [populated, customers[0], number, made.data.user.id])).rows[0].id;
    const offListCall = (await pg.query("insert into public.calls (organization_id,customer_id,direction,status,from_number,to_number,phone_number_id,conference_name,started_at,answered_at,created_by) values ($1,$2,'outbound','in_progress','+14385550100','+14385550171',$3,'local-dialer-console-off-list',now()-interval '2 minutes',now()-interval '2 minutes',$4) returning id", [populated, offList, number, made.data.user.id])).rows[0].id;
    await pg.query("update public.call_participants set status='in_progress', joined_at=now()-interval '2 minutes', membership_id=case when party='agent' then $3::uuid else membership_id end where organization_id=$1 and call_id=$2", [populated, offListCall, membershipId]);
    const legs = await pg.query("update public.call_participants set status='in_progress', joined_at=now()-interval '2 minutes', membership_id=case when party='agent' then $3::uuid else membership_id end where organization_id=$1 and call_id=$2 returning party", [populated, liveCall, membershipId]);
    expect(legs.rows.map(row => row.party).sort()).toEqual(['agent', 'customer']);
    await pg.query('delete from platform_staff where user_id=$1', [made.data.user.id]);

    await page.goto('/login'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click(); await page.waitForURL(value => value.pathname !== '/login');

    for (const { name, width, height } of WIDTHS) {
      await page.setViewportSize({ width, height });
      let desktop = false;
      await page.goto(`/organizations/${empty}/calls`);
      // One page title for assistive technology; the workspace bar already shows it, so it is not printed again.
      await expect(page.getByRole('heading', { name: 'Dialer', exact: true })).toHaveCount(1);
      await expect(page.getByRole('heading', { name: 'Dialer', exact: true })).not.toBeInViewport();
      await expect(page.getByRole('group', { name: 'Presentation' })).toBeVisible();
      // No calling account: said as that, with nothing for the business to configure.
      await expect(page.getByRole('region', { name: 'Calling readiness' })).toHaveText('Calling is not set up for this business yet.');
      await expect(page.getByRole('region', { name: 'Calling readiness' }).getByRole('link')).toHaveCount(0);
      // Manual dialing: the number field, with the keypad on request rather than always there.
      const workspace = page.getByRole('region', { name: 'Calling console' });
      await expect(workspace).toHaveAttribute('data-state', 'manual');
      await expect(page.getByRole('textbox', { name: 'Number to call' })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Dial pad' })).toHaveCount(0);
      await expect(async () => {
        if (!await page.getByRole('group', { name: 'Dial pad' }).count()) await workspace.getByRole('button', { name: 'Keypad', exact: true }).click();
        await expect(page.getByRole('group', { name: 'Dial pad' })).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await noHorizontalScroll(page);
      await page.screenshot(shot(testInfo.outputPath(`empty-keypad-${name}.png`)));
      await workspace.getByRole('button', { name: 'Keypad', exact: true }).click();
      await expect(page.getByRole('group', { name: 'Dial pad' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Call', exact: true })).toBeDisabled();
      desktop = await page.locator('[data-presentation]:not([data-slot])').filter({ visible: true }).evaluate(element => element.clientWidth >= 1024);
      if (desktop) {
        await expect(page.getByRole('region', { name: 'Call list' })).toContainText('No contacts on the call list');
        // With nobody chosen there is no contact context, so no third column is held open for it.
        await expect(page.getByRole('region', { name: 'Contact' })).toBeHidden();
        const queueBox = (await page.getByRole('region', { name: 'Call list' }).boundingBox())!;
        const consoleBox = (await page.getByRole('region', { name: 'Calling console' }).boundingBox())!;
        expect(consoleBox.width).toBeGreaterThan(queueBox.width * 1.6);
        expect(Math.abs(queueBox.y - (consoleBox.y - (await page.getByRole('region', { name: 'Calling readiness' }).boundingBox())!.height))).toBeLessThanOrEqual(2);
        expect(queueBox.y + queueBox.height).toBeLessThanOrEqual(height + 1);
      }
      await page.screenshot(shot(testInfo.outputPath(`empty-${name}.png`)));
      await noHorizontalScroll(page);

      await page.goto(`/organizations/${populated}/calls`);
      await expect(page.getByRole('group', { name: 'Presentation' })).toBeVisible();
      // Someone chosen from the call list: who, why, their number, the line and one Call. No number field, no keypad.
      const calling = page.getByRole('region', { name: 'Calling console' });
      await expect(calling).toHaveAttribute('data-state', 'contact');
      await expect(page.getByRole('heading', { name: 'Sarah Mitchell', level: 2 })).toBeVisible();
      await expect(calling).toContainText('(438)555-0194');
      await expect(calling).toContainText('Quote follow-up for the boiler service');
      await expect(page.getByRole('textbox', { name: 'Number to call' })).toHaveCount(0);
      await expect(page.getByRole('group', { name: 'Dial pad' })).toHaveCount(0);
      // Automatic names the number it resolved to and says why, once; the readiness line does not repeat it.
      await expect(page.getByLabel('Call from')).toContainText('Automatic · Main line · (438)555-0100');
      await expect(calling.locator('[data-slot="line-note"]')).toHaveText('Your default number');
      await expect(page.getByRole('region', { name: 'Calling readiness' })).toContainText('Browser phone');
      await expect(page.getByRole('region', { name: 'Calling readiness' })).not.toContainText('Main line');
      await expect(page.getByRole('button', { name: 'Call', exact: true })).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Call', exact: true })).toBeEnabled();
      // The alternatives, grouped as the caller's own and the business's shared numbers.
      await page.getByLabel('Call from').click();
      const lines = page.getByRole('listbox');
      await expect(lines.getByRole('group', { name: 'Your numbers' }).getByRole('option')).toHaveText(['Main line · (438)555-0100']);
      await expect(lines.getByRole('group', { name: 'Shared numbers' }).getByRole('option')).toHaveText(['Sales line · (438)555-0111']);
      await page.screenshot(shot(testInfo.outputPath(`call-from-${name}.png`)));
      await lines.getByRole('option', { name: 'Sales line · (438)555-0111' }).click();
      await expect(page.getByLabel('Call from')).toContainText('Sales line · (438)555-0111');
      await expect(calling.locator('[data-slot="line-note"]')).toHaveCount(0);
      await page.getByLabel('Call from').click();
      await page.getByRole('listbox').getByRole('option', { name: /^Automatic/ }).click();
      await expect(calling.locator('[data-slot="line-note"]')).toHaveText('Your default number');
      await expect(page.getByRole('button', { name: 'Start calling' })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Call task' })).toContainText('Asked for a call before Friday about the quote.');
      if (desktop) await expect(page.getByRole('region', { name: 'Contact' })).toContainText('sarah@northshore.example.test');
      desktop = await page.locator('[data-presentation]:not([data-slot])').filter({ visible: true }).evaluate(element => element.clientWidth >= 1024);
      const toolbar = page.getByRole('group', { name: 'Dialer toolbar', exact: true });
      await expect(toolbar.getByRole('button', { name: 'Standard', exact: true })).toBeVisible();
      await expect(toolbar.getByRole('button', { name: 'Pop out dialer', exact: true })).toBeVisible();
      await expect(toolbar.getByRole('link', { name: 'Call history', exact: true })).toBeVisible();
      await expect(toolbar.getByRole('button', { name: 'More Dialer actions', exact: true })).toBeVisible();
      if (desktop) await expect(page.getByRole('group', { name: 'Dialer region', exact: true })).toBeHidden();
      else await expect(page.getByRole('group', { name: 'Dialer region', exact: true })).toBeVisible();
      if (!desktop) {
        await page.getByRole('group', { name: 'Dialer region', exact: true }).getByRole('button', { name: 'Call list', exact: true }).click();
        await expect(page.getByRole('region', { name: 'Call list', exact: true })).toBeVisible();
        await page.getByRole('button', { name: /Mike Chen.*Confirm/ }).click();
        await expect(calling).toContainText('(438)555-0123');
      }
      // The one Call control is within reach at every width.
      const call = (await page.getByRole('button', { name: 'Call', exact: true }).boundingBox())!;
      expect(call.x).toBeGreaterThanOrEqual(0);
      expect(call.x + call.width).toBeLessThanOrEqual(width);
      await page.screenshot(shot(testInfo.outputPath(`populated-${name}.png`)));
      await noHorizontalScroll(page);
    }

    await page.setViewportSize({ width: 1680, height: 1000 });
    await page.goto(`/organizations/${populated}/calls`);
    await expect(page.getByRole('region', { name: 'Contact' })).toContainText('Recent calls');
    // The regions end inside the visible canvas, whatever sits above the console.
    for (const region of ['Call list', 'Contact']) {
      const box = (await page.getByRole('region', { name: region, exact: true }).boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(1000 + 1);
    }
    // The settings are one press further away than calling, in a named menu.
    await page.getByRole('button', { name: 'More Dialer actions', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Calling & routing', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Numbers & assignments', exact: true })).toBeVisible();
    await page.screenshot(shot(testInfo.outputPath('toolbar-menu-wide.png')));
    await page.keyboard.press('Escape');
    // Manual entry stays one press away from a chosen contact, and clears who the call is for.
    await page.getByRole('button', { name: 'Dial another number', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Calling console' })).toHaveAttribute('data-state', 'manual');
    await expect(page.getByRole('textbox', { name: 'Number to call' })).toHaveValue('');
    await expect(page.getByRole('region', { name: 'Contact' })).toBeHidden();
    await page.screenshot(shot(testInfo.outputPath('manual-after-contact-wide.png')));
    await page.getByRole('button', { name: /Sarah Mitchell.*Quote/ }).click();
    await expect(page.getByRole('region', { name: 'Contact' })).toBeVisible();
    await page.getByRole('link', { name: 'Call history', exact: true }).click();
    await expect(page.locator('#call-history:visible')).toHaveAttribute('open', '');
    const history = page.locator('#call-history:visible');
    const hierarchy = await history.evaluate(element => {
      const heading = element.querySelector('h2')!;
      const metrics = element.querySelector('[aria-label="Today"]')!;
      const filters = element.querySelector('[role="group"][aria-label="Direction"]')!;
      return !!(heading.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(metrics.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(hierarchy).toBe(true);
    await page.screenshot({ ...shot(testInfo.outputPath('history-wide.png')), fullPage: true });
    await page.goto(`/organizations/${populated}/calls`);
    // Calls waiting for an outcome are a plain section of the workspace, not a tab.
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Needs wrap-up', exact: true })).toBeVisible();
    await expect(page.locator('section[aria-labelledby="dialer-wrap-up"]').getByRole('button', { name: 'Wrap up' })).toBeVisible();
    await page.getByRole('button', { name: 'Focus', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Focus', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('region', { name: 'Call list' })).toBeHidden();
    await expect(page.getByRole('region', { name: 'Contact' })).toBeHidden();
    await expect(page.locator('#call-history:visible')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Calling console' })).toContainText('(438)555-0194');
    await page.screenshot(shot(testInfo.outputPath('focus-wide.png')));
    await page.getByRole('button', { name: 'Standard', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Call list' })).toBeVisible();

    const line = (await page.getByLabel('Call from').textContent())!.trim();
    const popupEvent = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Pop out dialer' }).click();
    const popup = await popupEvent;
    await expect(popup.getByLabel('Number to call')).toBeVisible();
    await popup.waitForTimeout(500);
    await popup.screenshot(shot(testInfo.outputPath('popout-window.png')));
    await page.screenshot(shot(testInfo.outputPath('popout-host.png')));
    await expect(popup.getByLabel('Number to call')).toHaveValue('+14385550194');
    await expect(page.getByText('The dialer is open in a separate window.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show dialer window' })).not.toHaveAttribute('aria-pressed');
    // One wording for this browser's telephone in both windows, and the same line stated in each.
    const phoneStatus = (await page.getByRole('region', { name: 'Calling readiness' }).locator('[data-state]').first().textContent())!;
    await expect(popup.getByText(phoneStatus, { exact: true })).toBeVisible();
    await expect(popup.getByLabel('Call from')).toContainText(line);
    await expect(popup.getByRole('group', { name: 'Dial pad' })).toBeVisible();
    await popup.getByRole('button', { name: 'Return to GildOps', exact: true }).click();
    await expect.poll(() => popup.isClosed()).toBe(true);
    await expect(page.getByRole('button', { name: 'Standard', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/organizations/${populated}/calls`);
    await page.locator('header').getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Call list' })).toBeVisible();
    await page.screenshot(shot(testInfo.outputPath('sidebar-collapsed.png')));
    await page.locator('header').getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'Agent', exact: true }).filter({ visible: true }).click();
    await expect(page.getByRole('button', { name: 'Close Agent', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Dialer region', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Call list', exact: true })).toBeHidden();
    await expect(page.getByRole('complementary', { name: 'Agent', exact: true }).getByText(/^Loading/)).toHaveCount(0);
    await page.screenshot(shot(testInfo.outputPath('agent-open.png')));
    await noHorizontalScroll(page);
    await page.getByRole('button', { name: 'Close Agent', exact: true }).click();
    await page.getByRole('button', { name: 'Call list panel', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Call list', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Call list panel', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Call list', exact: true })).toBeVisible();
    // A Configure rail applies the same available-canvas constraint as Agent.
    await page.locator('[data-presentation]:not([data-slot])').filter({ visible: true }).evaluate(element => { element.style.width = '640px'; element.style.maxWidth = '100%'; });
    await expect(page.getByRole('group', { name: 'Dialer region', exact: true })).toBeVisible();
    await noHorizontalScroll(page);
    await page.screenshot(shot(testInfo.outputPath('constrained-canvas.png')));

    // Live call: the development fixture's test telephone, the real shell and page, and the real
    // roster read for the locally recorded call. No control here is pressed: each would reach the carrier.
    const fixture = `/dev/dialer?organizationId=${populated}&callId=${liveCall}&contact=Sarah%20Mitchell&customer=${customers[0]}`;
    for (const { name, width, height } of [WIDTHS[1], WIDTHS[3], WIDTHS[WIDTHS.length - 1]]) {
      await page.setViewportSize({ width, height });
      const wide = width >= 1280;
      const calling = page.getByRole('region', { name: 'Calling console' });
      const controls = page.getByRole('group', { name: 'Call controls' });

      // Ringing: the telephone has not connected, so hold and transfer are held back.
      await page.goto(`${fixture}&state=ringing`);
      await expect(calling).toHaveAttribute('data-state', 'live');
      await expect(calling.locator('[data-slot="live-call"]')).toHaveAttribute('data-phase', 'ringing');
      await expect(calling.getByText('Ringing', { exact: true }).first()).toBeVisible();
      // Ringing has its own clock; talk time has not started.
      await expect(page.getByLabel('Ringing time')).toBeVisible();
      await expect(page.getByLabel('Talk time')).toHaveCount(0);
      await expect(controls.getByRole('button', { name: 'End call', exact: true })).toBeEnabled();
      await expect(controls.getByRole('button', { name: 'Transfer', exact: true })).toBeDisabled();
      await expect(controls.getByRole('button', { name: 'Hold caller', exact: true })).toBeDisabled();
      await noHorizontalScroll(page);
      await page.screenshot(shot(testInfo.outputPath(`ringing-${name}.png`)));

      // Incoming: answer or decline, in place of whatever was being prepared.
      await page.goto(`${fixture}&state=incoming`);
      await expect(calling).toHaveAttribute('data-state', 'incoming');
      await expect(calling.getByRole('button', { name: 'Answer', exact: true })).toBeVisible();
      await expect(calling.getByRole('button', { name: 'Decline', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Call', exact: true })).toHaveCount(0);
      await noHorizontalScroll(page);
      await page.screenshot(shot(testInfo.outputPath(`incoming-${name}.png`)));

      // Ended: what follows a call, then back to the chosen contact. The fixture's call is still
      // recorded as in progress, so wrap-up is not offered on a guess.
      await page.goto(`${fixture}&state=ended`);
      await expect(calling).toHaveAttribute('data-state', 'ended');
      await expect(calling.getByText('Call ended', { exact: true })).toBeVisible();
      await expect(calling.getByRole('link', { name: 'Open call record', exact: true })).toHaveAttribute('href', `/organizations/${populated}/calls/${liveCall}`);
      await expect(calling.getByRole('button', { name: 'Wrap up' })).toHaveCount(0);
      // Ringing and talking are two figures. The carrier has not confirmed the end, and the
      // operator is told so, can ask again, and can still move on.
      await expect(calling.locator('[data-slot="call-timing"]')).toHaveText('Outgoing · Talk time 2:05 · Rang 0:12');
      await expect(calling.getByRole('status')).toContainText('Waiting for the carrier to confirm this call has ended.');
      await expect(calling.getByRole('status').getByRole('button', { name: 'Check again', exact: true })).toBeEnabled();
      await noHorizontalScroll(page);
      await page.screenshot(shot(testInfo.outputPath(`ended-${name}.png`)));
      await calling.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(calling).toHaveAttribute('data-state', 'contact');
      await expect(page.getByRole('button', { name: 'Call', exact: true })).toHaveCount(1);

      // Connected.
      await page.goto(fixture);
      await expect(controls).toBeVisible();
      await expect(calling.locator('[data-slot="live-call"]')).toHaveAttribute('data-phase', 'connected');
      for (const control of ['Mute', 'Hold caller', 'Keypad', 'Add', 'Transfer', 'End call']) await expect(controls.getByRole('button', { name: control, exact: true })).toBeVisible();
      await expect(controls.getByRole('button', { name: 'Transfer', exact: true })).toBeEnabled();
      await expect(page.getByLabel('Talk time')).toBeVisible();
      await expect(page.getByLabel('Ringing time')).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: 'Number to call' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Call', exact: true })).toHaveCount(0);
      // The call's own contact and task, with the list open to prepare the next call.
      if (wide) {
        await expect(page.getByRole('region', { name: 'Contact' })).toContainText('sarah@northshore.example.test');
        await expect(page.getByRole('region', { name: 'Call task' })).toContainText('Quote follow-up for the boiler service');
        await page.getByRole('button', { name: /Mike Chen.*Confirm/ }).click();
        await expect(controls).toBeVisible();
        await expect(page.getByRole('region', { name: 'Contact' })).toContainText('sarah@northshore.example.test');
        await expect(page.getByRole('region', { name: 'Contact' })).not.toContainText('Mike Chen');
        await expect(page.getByRole('region', { name: 'Call task' })).toHaveCount(0);
      }
      // The live controls survive a change of presentation.
      await page.getByRole('button', { name: 'Focus', exact: true }).click();
      await expect(controls).toBeVisible();
      await page.getByRole('button', { name: 'Standard', exact: true }).click();
      await expect(controls).toBeVisible();
      if (width < 1024) {
        await page.getByRole('group', { name: 'Dialer region', exact: true }).getByRole('button', { name: 'Call list', exact: true }).click();
        await expect(controls).toBeHidden();
        await page.getByRole('button', { name: 'Show call controls', exact: true }).click();
        await expect(controls).toBeVisible();
      }
      await page.screenshot(shot(testInfo.outputPath(`active-${name}.png`)));
      await noHorizontalScroll(page);

      // A call with someone on no call list: the call's own record still names them and their business.
      await page.goto(`/dev/dialer?organizationId=${populated}&callId=${offListCall}&contact=%2B14385550171`);
      await expect(controls).toBeVisible();
      if (width < 1024) await page.getByRole('group', { name: 'Dialer region', exact: true }).getByRole('button', { name: 'Contact', exact: true }).click();
      const context = page.getByRole('region', { name: 'Contact' });
      // The first read of a call's contact compiles its server action on a development server.
      await expect(context.getByRole('link', { name: 'Priya Nair', exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(context).toContainText('Facilities manager');
      // The call itself is named by them too, not left as the number that was dialed.
      if (width < 1024) await page.getByRole('group', { name: 'Dialer region', exact: true }).getByRole('button', { name: 'Calling', exact: true }).click();
      await expect(calling.locator('[data-slot="live-call"]')).toContainText('Priya Nair');
      if (width < 1024) await page.getByRole('group', { name: 'Dialer region', exact: true }).getByRole('button', { name: 'Contact', exact: true }).click();
      await expect(context.getByRole('link', { name: 'Harbour Mechanical', exact: true })).toHaveAttribute('href', `/organizations/${populated}/crm/contacts/${offListCompany}`);
      await expect(context).toContainText('priya@harbour.example.test');
      await expect(page.getByRole('region', { name: 'Call list' }).getByText('Priya Nair')).toHaveCount(0);
      await noHorizontalScroll(page);
      await page.screenshot(shot(testInfo.outputPath(`off-list-contact-${name}.png`)));
    }
    expect(errors).toEqual([]);
  } finally {
    await pg.query('delete from platform_staff where user_id=$1', [made.data.user.id]);
    // An affiliation holds its company in place, so it goes before the businesses do.
    await pg.query('delete from contact_affiliations where organization_id=any($1::uuid[])', [organizations]);
    await pg.query('delete from organizations where id=any($1::uuid[])', [organizations]);
    await admin.auth.admin.deleteUser(made.data.user.id);
    await pg.end();
  }
});
