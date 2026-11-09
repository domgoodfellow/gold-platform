import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { Client } from 'pg';
import type { Database } from '../lib/db/types';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { createCustomer } from '../lib/domain/customers/customers';
import { createFollowUp, listFollowUps } from '../lib/domain/follow-ups/follow-ups';
import { createWorkItemType } from '../lib/domain/work-items/types';
import { createWorkItemStatus } from '../lib/domain/work-items/statuses';
import { createWorkItem, listWorkItems } from '../lib/domain/work-items/work-items';
import { scheduleWorkItem } from '../lib/domain/scheduling/schedule';
import { listCalendarEvents } from '../lib/domain/calendar/events';
import { todayInZone, zonedDayRange } from '../lib/domain/scheduling/window';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { recordCommercialTerm } from '../lib/domain/commercial/terms';
import { chooseOption } from './select-field';

test.use({ storageState: { cookies: [], origins: [] }, hasTouch: true, trace: 'off' });
test('calendar has time blocks, slot creation, event editing and workspace context without a standalone sidebar entry', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15000);
  config({ path: path.join(__dirname, '../../..', '.env.test'), quiet: true });
  const url = process.env.SUPABASE_URL!;
  const connection = process.env.SUPABASE_DB_URL!;
  if (![url, connection].every(value => ['localhost', '127.0.0.1'].includes(new URL(value).hostname))) throw new Error('Local fixtures only.');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
  const staffEmail = `calendar-staff-${randomUUID()}@example.test`;
  const ownerEmail = `calendar-owner-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const staffAccount = await admin.auth.admin.createUser({ email: staffEmail, password, email_confirm: true });
  if (staffAccount.error) throw staffAccount.error;
  const ownerAccount = await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true });
  if (ownerAccount.error) throw ownerAccount.error;
  const authority = new Client(connection);
  await authority.connect();
  try { await authority.query('insert into platform_staff(user_id,name) values($1,$2)', [staffAccount.data.user.id, 'Calendar test operator']); }
  finally { await authority.end(); }
  const staff = createClient<Database>(url, process.env.SUPABASE_ANON_KEY!, options);
  const owner = createClient<Database>(url, process.env.SUPABASE_ANON_KEY!, options);
  for (const [client, email] of [[staff, staffEmail], [owner, ownerEmail]] as const) {
    const login = await client.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
  }
  const organizationId = await provisionOrganization(staff, { ownerEmail, name: `Calendar ${Date.now()}`, currency: 'CAD', timezone: 'America/Toronto', displayName: 'Calendar owner' });
  const foreign = await provisionOrganization(staff, { ownerEmail: staffEmail, name: `Other calendar ${Date.now()}`, currency: 'CAD' });
  const base = `/organizations/${organizationId}`;
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL(location => location.pathname !== '/login');
  await page.goto(`${base}/crm`);
  await page.getByRole('link', { name: 'View calendar', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/crm/calendar$`));
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New task', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New event', exact: true })).toBeVisible();
  const today = todayInZone('America/Toronto');
  const slot = page.getByRole('button', { name: new RegExp(`Add event ${today} 9:00 a`) });
  expect((await slot.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await slot.click();
  let drawer = page.getByRole('dialog', { name: 'New event', exact: true });
  await expect(drawer.getByLabel('Starts', { exact: true })).toHaveValue(`${today}T09:00`);
  await drawer.getByLabel('Title', { exact: true }).fill('Team planning');
  await drawer.getByLabel('Ends', { exact: true }).fill(`${today}T10:30`);
  await drawer.getByRole('button', { name: 'Save event', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('button', { name: 'Team planning', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Team planning', exact: true }).click();
  drawer = page.getByRole('dialog', { name: 'Edit event', exact: true });
  await drawer.getByLabel('Starts', { exact: true }).fill(`${today}T11:00`);
  await drawer.getByLabel('Ends', { exact: true }).fill(`${today}T12:00`);
  await drawer.getByLabel('Notes').fill('Saved independently of CRM records');
  await drawer.getByRole('button', { name: 'Save event', exact: true }).click();
  await expect(drawer).toBeHidden();
  const within = zonedDayRange(today, 'America/Toronto');
  expect((await listCalendarEvents(owner, { organizationId, within }))[0].notes).toBe('Saved independently of CRM records');
  expect(await listCalendarEvents(owner, { organizationId: foreign, within })).toEqual([]);

  await setModuleEnabled(owner, { organizationId, key: 'reception', enabled: true });
  await recordCommercialTerm(staff, { organizationId, productKey: 'module:reception', periodStart: new Date().toISOString().slice(0, 10), periodEnd: '9999-12-31', priceMinor: 0, note: 'Local calendar fixture' });
  const customerId = await createCustomer(owner, { organizationId, name: 'Calendar customer' });
  const start = Date.parse(within.startsAt) + 11 * 60 * 60 * 1000;
  await createFollowUp(owner, { organizationId, customerId, title: 'Proposal meeting', kind: 'meeting', dueAt: new Date(start).toISOString() });
  const typeId = await createWorkItemType(owner, { organizationId, name: 'Installation', schedulable: true });
  const statusId = await createWorkItemStatus(owner, { organizationId, typeId, name: 'Booked' });
  const workId = await createWorkItem(owner, { organizationId, statusId, customerId, title: 'Calendar installation' });
  await scheduleWorkItem(owner, { workItemId: workId, startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3600000).toISOString() });
  expect(await listWorkItems(owner, { organizationId: foreign })).toEqual([]);
  expect(await listFollowUps(owner, { organizationId: foreign })).toEqual([]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Proposal meeting', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Calendar installation', exact: true })).toHaveCount(0);
  await chooseOption(page.getByRole('combobox', { name: 'Calendar scope', exact: true }), 'organization');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Calendar installation', exact: true })).toBeVisible();
  await page.goto(`${base}/field/calendar`);
  await expect(page.getByRole('link', { name: 'Calendar installation', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Team planning', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Proposal meeting', exact: true })).toHaveCount(0);
  await page.goto(`${base}/crm/calendar?view=day&on=${today}`);
  await expect(page).toHaveURL(new RegExp(`${base}/crm/calendar`));
  await chooseOption(page.getByRole('combobox', { name: 'Calendar scope', exact: true }), 'organization');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  for (const [width, height] of [[1600, 1000], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const view of ['Day', 'Week', 'Month']) {
      await page.getByRole('link', { name: view, exact: true }).click();
      await expect(page.getByLabel(`${view.toLowerCase()} calendar`, { exact: true })).toBeVisible();
      if (view === 'Month' && width < 1000) {
        await expect(page.getByRole('link', { name: `View 3 items on ${today}`, exact: true })).toBeVisible();
      } else {
        await expect(page.getByRole('button', { name: 'Team planning', exact: true })).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`calendar-${width}-${view}.png`), fullPage: true });
    }
  }
  await page.getByRole('link', { name: `View 3 items on ${today}`, exact: true }).click();
  await page.getByRole('button', { name: 'Team planning', exact: true }).click();
  drawer = page.getByRole('dialog', { name: 'Edit event', exact: true });
  await expect(drawer.getByLabel('Notes')).toHaveValue('Saved independently of CRM records');
  await drawer.getByRole('button', { name: 'Cancel event', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('button', { name: 'Team planning', exact: true })).toHaveCount(0);
  await page.goto(`${base}/support`);
  await page.getByRole('link', { name: 'Support calendar', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/support/calendar`));
  await expect(page.getByRole('button', { name: 'Proposal meeting', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'New event', exact: true }).click();
  drawer = page.getByRole('dialog', { name: 'New event', exact: true });
  await drawer.getByLabel('Title', { exact: true }).fill('Support planning');
  await drawer.getByRole('button', { name: 'Save event', exact: true }).click();
  await expect(drawer).toBeHidden();
  expect((await listCalendarEvents(owner, { organizationId, within, workspace: 'support' }))[0].title).toBe('Support planning');
});
