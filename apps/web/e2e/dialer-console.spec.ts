import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';
import type { Database } from '../lib/db/types';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { createCustomer } from '../lib/domain/customers/customers';
import { createFollowUp } from '../lib/domain/follow-ups/follow-ups';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { createPlan, grantPlanProduct } from '../lib/domain/catalogue/plans';
import { recordPlanAssignment } from '../lib/domain/catalogue/organization-plans';
import { assignPhoneNumber } from '../lib/domain/reception/numbers';
import { currentMembershipId } from '../lib/domain/reception/inbox';

/**
 * Rendered evidence for the Dialer console: an unconfigured business with nothing recorded, and a
 * business with a queue and a locally assigned outbound number. **Call is never pressed**: the
 * local environment may hold real carrier credentials, and an assigned number here is a database
 * fact, not carrier acceptance. Live-call presentation is captured from the development fixture
 * route, which stands a test telephone where the real one would be.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const WIDTHS = [{ name: 'wide', width: 1800, height: 1000 }, { name: 'desktop', width: 1440, height: 900 }, { name: 'small-desktop', width: 1024, height: 900 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'phone', width: 390, height: 844 }];

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
    const planId = await createPlan(db, { key: `dialer_console_${Date.now()}`, kind: 'plan', label: 'Local Dialer console', description: 'Local browser fixture only', billable: false });
    for (const productKey of ['comms', 'sales']) await grantPlanProduct(db, { planId, productKey });
    for (const organizationId of organizations) {
      await setModuleEnabled(db, { organizationId, key: 'reception', enabled: true });
      await pg.query("insert into organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note) values($1,'module:reception','2020-01-01','9999-12-31',1,0,'CAD',$2,'Local Dialer console fixture')", [organizationId, made.data.user.id]);
      await recordPlanAssignment(db, { organizationId, planId, periodStart: '2020-01-01', periodEnd: '9999-12-31' });
    }
    // The populated business: a locally assigned outbound number and a real queue of call follow-ups.
    const number = (await pg.query("insert into public.phone_numbers (organization_id,e164,label,origin,lifecycle,purpose,voice_outbound_enabled,sms_outbound_enabled,voice_inbound_enabled,sms_inbound_enabled) values ($1,'+14385550100','Main line','external','active','main',true,false,false,false) returning id", [populated])).rows[0].id;
    await assignPhoneNumber(db, { organizationId: populated, phoneNumberId: number, memberId: (await currentMembershipId(db, { organizationId: populated }))!, isDefault: true });
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
      await expect(page.getByRole('region', { name: 'Calling readiness' })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Dial pad' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Call', exact: true })).toBeDisabled();
      desktop = await page.locator('[data-presentation]').filter({ visible: true }).evaluate(element => element.clientWidth >= 1024);
      if (desktop) {
        await expect(page.getByRole('region', { name: 'Call queue' })).toContainText('No open call follow-ups');
        await expect(page.getByRole('region', { name: 'Customer' })).toBeVisible();
        const queueBox = (await page.getByRole('region', { name: 'Call queue' }).boundingBox())!;
        const consoleBox = (await page.getByRole('region', { name: 'Calling console' }).boundingBox())!;
        expect(consoleBox.width).toBeGreaterThan(queueBox.width * 1.6);
        expect(Math.abs(queueBox.y - (consoleBox.y - (await page.getByRole('region', { name: 'Calling readiness' }).boundingBox())!.height))).toBeLessThanOrEqual(2);
        expect(queueBox.y + queueBox.height).toBeLessThanOrEqual(height + 1);
      }
      await page.screenshot({ path: testInfo.outputPath(`empty-${name}.png`) });
      await noHorizontalScroll(page);

      await page.goto(`/organizations/${populated}/calls`);
      await expect(page.getByRole('group', { name: 'Presentation' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Sarah Mitchell', level: 2 })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Number to call' })).toHaveValue('(438)555-0194');
      if (desktop) await expect(page.getByRole('region', { name: 'Customer' })).toContainText('sarah@northshore.example.test');
      desktop = await page.locator('[data-presentation]').filter({ visible: true }).evaluate(element => element.clientWidth >= 1024);
      const toolbar = page.getByRole('group', { name: 'Dialer toolbar', exact: true });
      await expect(toolbar.getByRole('button', { name: 'Standard', exact: true })).toBeVisible();
      await expect(toolbar.getByRole('button', { name: 'Pop out dialer', exact: true })).toBeVisible();
      await expect(toolbar.getByRole('link', { name: 'Call history', exact: true })).toBeVisible();
      await expect(toolbar.getByRole('link', { name: 'Configuration', exact: true })).toBeVisible();
      if (desktop) await expect(page.getByRole('group', { name: 'Dialer region', exact: true })).toBeHidden();
      else await expect(page.getByRole('group', { name: 'Dialer region', exact: true })).toBeVisible();
      if (!desktop) {
        await page.getByRole('group', { name: 'Dialer region', exact: true }).getByRole('button', { name: 'Queue', exact: true }).click();
        await expect(page.getByRole('region', { name: 'Call queue', exact: true })).toBeVisible();
        await page.getByRole('button', { name: /Mike Chen/ }).click();
        await expect(page.getByRole('textbox', { name: 'Number to call' })).toHaveValue('(438)555-0123');
      }
      expect(await page.getByRole('textbox', { name: 'Number to call' }).evaluate(element => element.getBoundingClientRect().width <= 576)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`populated-${name}.png`) });
      await noHorizontalScroll(page);
    }

    await page.setViewportSize({ width: 1680, height: 1000 });
    await page.goto(`/organizations/${populated}/calls`);
    await expect(page.getByRole('region', { name: 'Customer' })).toContainText('Recent calls');
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
    await page.screenshot({ path: testInfo.outputPath('history-wide.png'), fullPage: true });
    await page.goto(`/organizations/${populated}/calls`);
    await page.getByRole('tab', { name: 'Wrap-up' }).click();
    await expect(page.getByRole('button', { name: 'Wrap up' })).toBeVisible();
    await page.getByRole('tab', { name: 'Follow-up' }).click();
    await page.getByRole('button', { name: 'Focus', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Focus', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('region', { name: 'Call queue' })).toBeHidden();
    await expect(page.getByRole('region', { name: 'Customer' })).toBeHidden();
    await expect(page.locator('#call-history:visible')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Number to call' })).toHaveValue('(438)555-0194');
    await page.screenshot({ path: testInfo.outputPath('focus-wide.png') });
    await page.getByRole('button', { name: 'Standard', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Call queue' })).toBeVisible();

    const popupEvent = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Pop out dialer' }).click();
    const popup = await popupEvent;
    await expect(popup.getByLabel('Number to call')).toBeVisible();
    await popup.waitForTimeout(500);
    await popup.screenshot({ path: testInfo.outputPath('popout-window.png') });
    await page.screenshot({ path: testInfo.outputPath('popout-host.png') });
    await expect(popup.getByLabel('Number to call')).toHaveValue('+14385550194');
    await expect(page.getByText('The dialer is open in a separate window.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show dialer window' })).not.toHaveAttribute('aria-pressed');
    await popup.getByRole('button', { name: 'Return to GildOps', exact: true }).click();
    await expect.poll(() => popup.isClosed()).toBe(true);
    await expect(page.getByRole('button', { name: 'Standard', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/organizations/${populated}/calls`);
    await page.locator('header').getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Call queue' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('sidebar-collapsed.png') });
    await page.locator('header').getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'Agent', exact: true }).filter({ visible: true }).click();
    await expect(page.getByRole('button', { name: 'Close Agent', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Dialer region', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Call queue', exact: true })).toBeHidden();
    await expect(page.getByRole('complementary', { name: 'Agent', exact: true }).getByText(/^Loading/)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('agent-open.png') });
    await noHorizontalScroll(page);
    await page.getByRole('button', { name: 'Close Agent', exact: true }).click();
    await page.getByRole('button', { name: 'Queue panel', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Call queue', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Queue panel', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Call queue', exact: true })).toBeVisible();
    // A Configure rail applies the same available-canvas constraint as Agent.
    await page.locator('[data-presentation]').filter({ visible: true }).evaluate(element => { element.style.width = '640px'; element.style.maxWidth = '100%'; });
    await expect(page.getByRole('group', { name: 'Dialer region', exact: true })).toBeVisible();
    await noHorizontalScroll(page);
    await page.screenshot({ path: testInfo.outputPath('constrained-canvas.png') });

    // Live call: the development fixture's test telephone, the real shell and page, and the real
    // roster read for the locally recorded call. No control here is pressed: each would reach the carrier.
    for (const { name, width, height } of [WIDTHS[1], WIDTHS[WIDTHS.length - 1]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`/dev/dialer?organizationId=${populated}&callId=${liveCall}&contact=Sarah%20Mitchell`);
      const controls = page.getByRole('group', { name: 'Call controls' });
      await expect(controls).toBeVisible();
      for (const control of ['Mute', 'Hold caller', 'Keypad', 'Add', 'Transfer', 'End call']) await expect(controls.getByRole('button', { name: control, exact: true })).toBeVisible();
      await expect(page.getByLabel('Call duration')).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Number to call' })).toHaveCount(0);
      if (width < 1024) {
        await page.getByRole('group', { name: 'Dialer region', exact: true }).getByRole('button', { name: 'Queue', exact: true }).click();
        await expect(controls).toBeHidden();
        await page.getByRole('button', { name: 'Show call controls', exact: true }).click();
        await expect(controls).toBeVisible();
      }
      await page.screenshot({ path: testInfo.outputPath(`active-${name}.png`) });
      await noHorizontalScroll(page);
    }
    expect(errors).toEqual([]);
  } finally {
    await pg.query('delete from platform_staff where user_id=$1', [made.data.user.id]);
    await pg.query('delete from organizations where id=any($1::uuid[])', [organizations]);
    await admin.auth.admin.deleteUser(made.data.user.id);
    await pg.end();
  }
});
