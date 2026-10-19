import './appearance-env';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { foundBusiness } from '../tests/support/founding';
import { grantHomeVerificationPlan, seedHomeFixture } from '../tests/support/home-fixture';
import { createRole } from '../lib/domain/tenancy/roles';
import { addMember } from '../lib/domain/tenancy/members';
import type { Db } from '../lib/db/types';
import { createCustomer } from '../lib/domain/customers/customers';
import { createFollowUp } from '../lib/domain/follow-ups/follow-ups';
import { createWorkItemType } from '../lib/domain/work-items/types';
import { createWorkItemStatus } from '../lib/domain/work-items/statuses';
import { createWorkItem } from '../lib/domain/work-items/work-items';
import { createResource } from '../lib/domain/resources/resources';
import { scheduleWorkItem } from '../lib/domain/scheduling/schedule';
import { todayInZone, zonedTimeToInstant } from '../lib/domain/scheduling/window';

const shots = path.resolve(__dirname, '../test-results/home');
async function capture(page: Page, name: string, section?: string) {
  mkdirSync(shots, { recursive: true });
  if (section) await page.getByRole('region', { name: section, exact: true }).scrollIntoViewIfNeeded();
  else {
    const inset = page.locator('[data-slot="sidebar-inset"]');
    if (await inset.count()) await inset.evaluate(el => { el.scrollTop = 0; });
  }
  await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true, animations: 'disabled' });
  if (!section) {
    const inset = page.locator('[data-slot="sidebar-inset"]');
    if (await inset.count()) {
      await inset.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.screenshot({ path: path.join(shots, `${name}-lower.png`), fullPage: true, animations: 'disabled' });
      await inset.evaluate(el => { el.scrollTop = 0; });
    }
  }
}
test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15000 });
test('Global Home operational queues, owning actions, Agent and responsive surfaces', async ({ page, browser, baseURL }) => {
  test.setTimeout(300000);
  config({ path: path.resolve(__dirname, '../../../.env.test') });
  const url = process.env.SUPABASE_URL!;
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Local Home fixtures only');
  const ownerEmail = `home-browser-owner-${randomUUID()}@example.test`;
  const fixtureAdmin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const fixtureOwner = await fixtureAdmin.auth.admin.createUser({ email: ownerEmail, password: DEMO_PASSWORD, email_confirm: true });
  if (fixtureOwner.error) throw fixtureOwner.error;
  const db = createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } }) as Db;
  const signed = await db.auth.signInWithPassword({ email: ownerEmail, password: DEMO_PASSWORD });
  if (signed.error) throw signed.error;
  const pg = new Client(process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
  await pg.connect();
  const organizationId = await foundBusiness({ ownerEmail: ownerEmail, name: `Home browser ${randomUUID().slice(0, 6)}`, currency: 'CAD', timezone: 'America/Toronto' });
  const org = `/organizations/${organizationId}`, home = `${org}/home`;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const visit = async (query = '') => { await page.goto(`${home}${query}`); await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Needs attention', exact: true })).toBeVisible(); };
  try {
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto('/login');
    if (new URL(page.url()).pathname === '/login') {
      await page.getByLabel('Email', { exact: true }).fill(ownerEmail);
      await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
      await page.getByRole('button', { name: 'Log in', exact: true }).click();
      await page.waitForURL(url => !url.pathname.endsWith('/login'));
    }
    await visit(); await capture(page, '01-empty-desktop');
    const crmOrg = await foundBusiness({ ownerEmail: ownerEmail, name: 'Home CRM-oriented verification', currency: 'CAD', timezone: 'America/Toronto' });
    await grantHomeVerificationPlan(crmOrg);
    const customer = await createCustomer(db, { organizationId: crmOrg, name: 'CRM relationship requiring contact' });
    const date = todayInZone('America/Toronto');
    await createFollowUp(db, { organizationId: crmOrg, customerId: customer, kind: 'task', title: 'Contact the Customer today', dueAt: zonedTimeToInstant(date, '09:00', 'America/Toronto') });
    await page.goto(`/organizations/${crmOrg}/home`);
    await expect(page.getByRole('link', { name: 'Open Contact the Customer today', exact: true })).toBeVisible();
    await capture(page, '03-crm-oriented');
    const workOrg = await foundBusiness({ ownerEmail: ownerEmail, name: 'Home Work-oriented verification', currency: 'CAD', timezone: 'America/Toronto' });
    const type = await createWorkItemType(db, { organizationId: workOrg, name: 'Field service', schedulable: true });
    const status = await createWorkItemStatus(db, { organizationId: workOrg, typeId: type, name: 'Open' });
    const resource = await createResource(db, { organizationId: workOrg, name: 'Service operator', resourceClass: 'person' });
    await createWorkItem(db, { organizationId: workOrg, statusId: status, title: 'Service awaiting scheduling' });
    const service = await createWorkItem(db, { organizationId: workOrg, statusId: status, title: 'Scheduled field service' });
    await scheduleWorkItem(db, { workItemId: service, resourceIds: [resource], startsAt: zonedTimeToInstant(date, '10:00', 'America/Toronto'), endsAt: zonedTimeToInstant(date, '11:00', 'America/Toronto') });
    await page.goto(`/organizations/${workOrg}/home`);
    await expect(page.getByText('1 Unscheduled Work', { exact: true }).filter({ visible: true })).toBeVisible();
    await capture(page, '04-work-oriented');
    const fixture = await seedHomeFixture(db, organizationId, pg);
    await visit();
    await expect(page.getByText('Some sources are temporarily unavailable')).toHaveCount(0);
    await expect(page.getByText('12 Urgent Cases', { exact: true }).filter({ visible: true })).toBeVisible();
    await capture(page, '02-populated-desktop'); await capture(page, '05-full-feature');
    const businessNav = () => page.getByRole('navigation', { name: 'This business', exact: true }).filter({ visible: true });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1050 });
      await visit();
      if (width < 768) await page.getByRole('button', { name: /^(Toggle Sidebar|Menu)$/ }).click();
      for (const name of ['CRM', 'Communications', 'Marketing', 'Support', 'Work', 'Finance', 'Automations', 'AI', 'Studio']) await expect(businessNav().getByRole('link', { name, exact: true })).toBeVisible();
      for (const name of ['Customers', 'Invoices', 'Payments', 'Dialer']) await expect(businessNav().getByRole('link', { name, exact: true })).toHaveCount(0);
      await page.screenshot({ path: path.join(shots, `restored-workspaces-${width}.png`), animations: 'disabled' });
      await businessNav().getByRole('link', { name: 'CRM', exact: true }).click();
      await expect(page).toHaveURL(`${org}/sales`);
      if (width < 768) await page.getByRole('button', { name: /^(Toggle Sidebar|Menu)$/ }).click();
      await expect(businessNav().getByRole('link', { name: 'Customers', exact: true })).toBeVisible();
      await expect(businessNav().getByRole('link', { name: 'Invoices', exact: true })).toHaveCount(0);
      await expect(businessNav().getByRole('link', { name: 'Back to Workspaces', exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(shots, `restored-crm-${width}.png`), animations: 'disabled' });
      await businessNav().getByRole('link', { name: 'Back to Workspaces', exact: true }).click();
    }
    await page.setViewportSize({ width: 1440, height: 1050 });
    await visit();

    const attentionLink = page.getByRole('region', { name: 'Needs attention', exact: true }).getByRole('link', { name: /^Open Home overdue follow-up/ }).first();
    const rowBounds = await attentionLink.boundingBox();
    expect(rowBounds!.width).toBeGreaterThan(500);
    await attentionLink.click({ position: { x: rowBounds!.width - 5, y: 10 } });
    await expect(page).toHaveURL(/\/follow-ups\?selected=/);
    await visit();
    await page.getByRole('button', { name: 'Expand previews' }).click();
    await capture(page, '06-attention-expanded', 'Needs attention');
    await page.getByRole('link', { name: 'Mine', exact: true }).click();
    await expect(page).toHaveURL(/scope=mine/);
    await expect(page.getByText('3 Urgent Cases', { exact: true })).toBeVisible();
    await capture(page, '07-mine');
    await page.getByRole('link', { name: 'All', exact: true }).click();
    await expect(page).toHaveURL(/scope=organization/); await capture(page, '08-organization');
    await capture(page, '09-today', 'Schedule');
    await page.getByRole('tab', { name: 'Next 7 days', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Next 7 days', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Today', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workspace health', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Notifications', exact: true })).toBeVisible();
    await page.getByRole('dialog', { name: 'Notifications', exact: true }).getByRole('link', { name: 'Review setup', exact: true }).click();
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole('dialog', { name: 'Notifications', exact: true })).toHaveCount(0);
    await visit();
    await page.getByRole('link', { name: 'This month', exact: true }).click();
    await expect(page).toHaveURL(/when=month/);
    await expect(page.getByRole('region', { name: 'Business performance', exact: true }).getByText('This month', { exact: true })).toBeVisible();
    await expect(page.getByText('Invoiced · CAD', { exact: true })).toBeVisible();
    await capture(page, '10-performance', 'Business performance');
    await capture(page, '11-activity', 'Recent activity');
    await page.getByRole('button', { name: 'Quick actions', exact: true }).click();
    await expect(page.getByRole('menu')).toBeVisible(); await capture(page, '12-quick-actions');
    const createHrefs = await page.getByRole('menuitem').evaluateAll(items => items.map(item => item.getAttribute('href')).sort());
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Search and commands' });
    await expect(palette).toBeVisible();
    const paletteHrefs = await palette.getByRole('link', { name: /^Create |^Compose / }).evaluateAll(items => items.map(item => item.getAttribute('href')).sort());
    expect(paletteHrefs).toEqual(createHrefs);
    await page.getByRole('textbox', { name: 'Search commands' }).press('ArrowDown');
    await expect(palette.getByRole('link', { name: /^Create / }).first()).toBeFocused();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Quick actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New customer' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'New customer' })).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill('Home browser-created Customer');
    await page.getByRole('button', { name: 'Add customer', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await visit();
    // Each launcher opens the owning workspace's existing form, never a Home mutation path.
    for (const [label, heading] of [['New case', 'New Case'], ['New campaign', 'New campaign'], ['New automation', 'New automation'], ['New form', 'New blank form']] as const) {
      await page.getByRole('button', { name: 'Quick actions', exact: true }).click();
      await page.getByRole('menuitem', { name: label, exact: false }).click();
      await expect(page.getByRole('dialog').getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await visit();
    }
    await page.getByRole('button', { name: 'Quick actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New invoice', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'New invoice', exact: true })).toBeVisible();
    await visit();
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Search and commands' })).toBeVisible();
    await page.getByRole('button', { name: 'Which Work is at risk?', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Agent', exact: true })).toBeVisible();
    await expect(page.getByLabel('Message to the Agent', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByLabel('Message to the Agent', { exact: true })).toHaveValue(/Which Work is at risk\?/);
    await capture(page, '13-agent-rail'); await page.getByRole('button', { name: 'Close Agent', exact: true }).click();
    // Exact category destinations and selected identities remain on canonical routes.
    await page.getByRole('link', { name: '12 Urgent Cases', exact: true }).click();
    await expect(page).toHaveURL(/support\/cases\?status=active&attention=urgent/);
    await expect(page.getByText('Home urgent Case 0', { exact: true }).first()).toBeVisible();
    await visit('?attention=overdue');
    await expect(page.getByRole('link', { name: /Open Invoice #/ }).first()).toBeVisible();
    await visit();
    await page.getByRole('button', { name: 'Customize', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Recent activity', exact: true }).uncheck();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Recent activity', exact: true })).toHaveCount(0);
    await page.reload(); await expect(page.getByRole('heading', { name: 'Recent activity', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Customize', exact: true }).click(); await page.getByRole('checkbox', { name: 'Recent activity', exact: true }).check(); await page.keyboard.press('Escape');
    for (const [width, name] of [[1440, '14-desktop'], [768, '14-tablet'], [390, '15-mobile']] as const) {
      await page.setViewportSize({ width, height: 1050 }); await visit(); await capture(page, name);
      await page.keyboard.press('Control+k');
      await expect(page.getByRole('dialog', { name: 'Search and commands' })).toBeVisible();
      await page.getByRole('textbox', { name: 'Search commands' }).fill('invoice');
      await expect(page.getByRole('dialog').getByRole('link', { name: /Create invoice/ })).toBeVisible();
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.emulateMedia({ colorScheme: 'dark' });
      await capture(page, `${name}-dark`);
      await page.emulateMedia({ colorScheme: 'light' });
    }
    const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const email = `home-browser-reader-${randomUUID()}@example.test`;
    const created = await admin.auth.admin.createUser({ email, password: DEMO_PASSWORD, email_confirm: true }); if (created.error) throw created.error;
    const role = await createRole(db, { organizationId, name: 'Home browser reader', capabilities: [] });
    await addMember(db, { organizationId, email, roleId: role });
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 1050 } }), restricted = await context.newPage();
    await restricted.goto(new URL('/login', baseURL).href); await restricted.getByLabel('Email', { exact: true }).fill(email); await restricted.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD); await restricted.getByRole('button', { name: 'Log in', exact: true }).click();
    await restricted.waitForURL(url => !url.pathname.endsWith('/login'));
    await restricted.goto(new URL(home, baseURL).href); await expect(restricted.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
    await expect(restricted.getByText('Home urgent Case', { exact: false })).toHaveCount(0);
    await capture(restricted, '16-restricted-role');
    await context.close();
    expect(errors).toEqual([]);
    expect(fixture.organizationId).toBe(organizationId);
  } finally { await pg.end(); await db.auth.signOut({ scope: 'local' }); }
});
