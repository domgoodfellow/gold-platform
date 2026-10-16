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
import { todayInZone, zonedDayRange } from '../lib/domain/scheduling/window';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { recordCommercialTerm } from '../lib/domain/commercial/terms';

test.use({ storageState: { cookies: [], origins: [] }, hasTouch: true, trace: 'off' });
test('organization calendar combines CRM and Work, preserves editing and filters, and keeps tenant boundaries', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
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
  await page.goto(`${base}/sales`);
  await page.getByRole('link', { name: 'View calendar', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/calendar$`));
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
  await expect(page.getByText('No scheduled items.').first()).toBeVisible();

  await setModuleEnabled(owner, { organizationId, key: 'reception', enabled: true });
  await recordCommercialTerm(staff, { organizationId, productKey: 'module:reception', periodStart: new Date().toISOString().slice(0, 10), periodEnd: '9999-12-31', priceMinor: 0, note: 'Local calendar fixture' });
  const customerId = await createCustomer(owner, { organizationId, name: 'Calendar customer' });
  const today = todayInZone('America/Toronto');
  const start = Date.parse(zonedDayRange(today, 'America/Toronto').startsAt) + 10 * 60 * 60 * 1000;
  await createFollowUp(owner, { organizationId, customerId, title: 'Proposal meeting', kind: 'meeting', dueAt: new Date(start).toISOString() });
  const typeId = await createWorkItemType(owner, { organizationId, name: 'Installation', schedulable: true });
  const statusId = await createWorkItemStatus(owner, { organizationId, typeId, name: 'Booked' });
  const workId = await createWorkItem(owner, { organizationId, statusId, customerId, title: 'Calendar installation' });
  await scheduleWorkItem(owner, { workItemId: workId, startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3600000).toISOString() });
  expect(await listWorkItems(owner, { organizationId: foreign })).toEqual([]);
  expect(await listFollowUps(owner, { organizationId: foreign })).toEqual([]);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Proposal meeting', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Calendar installation', exact: true })).toHaveAttribute('href', `${base}/work/${workId}`);
  await page.getByRole('button', { name: 'Proposal meeting', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Edit follow-up', exact: true });
  await drawer.getByLabel('Notes').fill('Shared calendar edit');
  await drawer.getByRole('button', { name: 'Save follow-up', exact: true }).click();
  await expect(drawer).toBeHidden();
  expect((await listFollowUps(owner, { organizationId }))[0].notes).toBe('Shared calendar edit');
  await page.getByRole('combobox', { name: 'Calendar source', exact: true }).selectOption('work');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Proposal meeting', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Calendar installation', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Month', exact: true }).click();
  await expect(page).toHaveURL(/source=work/);
  await expect(page.getByRole('combobox', { name: 'Calendar source', exact: true })).toHaveValue('work');
  await page.goto(`${base}/follow-ups/calendar?view=day&on=${today}`);
  await expect(page).toHaveURL(new RegExp(`${base}/calendar\\?view=day&on=${today}`));
  for (const [width, height] of [[1600, 1000], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const view of ['Day', 'Week', 'Month']) {
      await page.getByRole('link', { name: view, exact: true }).click();
      await expect(page.getByLabel(`${view.toLowerCase()} calendar`, { exact: true })).toBeVisible();
      if (view === 'Month' && width < 1000) {
        await expect(page.getByRole('link', { name: `View 2 items on ${today}`, exact: true })).toBeVisible();
      } else {
        await expect(page.getByRole('button', { name: 'Proposal meeting', exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Calendar installation', exact: true })).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`calendar-${width}-${view}.png`), fullPage: true });
    }
  }
  await page.getByRole('button', { name: 'Show the month containing this day', exact: true }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: `View 2 items on ${today}`, exact: true }).click();
  await expect(page.getByLabel('day calendar', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Proposal meeting', exact: true })).toBeVisible();
});
