import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { expect, test } from '@playwright/test';
import type { Database } from '../lib/db/types';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { createCustomer } from '../lib/domain/customers/customers';
import { createFollowUp, changeFollowUpStatus } from '../lib/domain/follow-ups/follow-ups';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';

test.use({ storageState: { cookies: [], origins: [] }, hasTouch: true });

test('Dialer lists the tenant’s open Call tasks and the global pop-out survives navigation', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  config({ path: path.join(__dirname, '../../..', '.env.test'), quiet: true });
  const url = process.env.SUPABASE_URL!;
  const connection = process.env.SUPABASE_DB_URL!;
  if (![url, connection].every(value => ['localhost', '127.0.0.1'].includes(new URL(value).hostname))) throw new Error('Disposable loopback fixtures only');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
  const db = createClient<Database>(url, process.env.SUPABASE_ANON_KEY!, options);
  const email = `dialer-${randomUUID()}@example.test`, password = randomUUID();
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error) throw made.error;
  const pg = new Client(connection); await pg.connect();
  const organizations: string[] = [];
  try {
    await pg.query('insert into platform_staff(user_id,name) values($1,$2)', [made.data.user.id, 'Local Dialer fixture']);
    const login = await db.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
    for (const name of ['Dialer verification business', 'Separate dialer business']) organizations.push(await provisionOrganization(db, { ownerEmail: email, name, currency: 'CAD' }));
    const [organizationId, otherOrg] = organizations;
    await setModuleEnabled(db, { organizationId, key: 'reception', enabled: true });
    await pg.query("insert into organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note) values($1,'module:reception','2020-01-01','9999-12-31',1,0,'CAD',$2,'Local Dialer acceptance fixture')", [organizationId, made.data.user.id]);
    const alice = await createCustomer(db, { organizationId, name: 'Alice Plumbing', phone: '+14165550101' });
    const bob = await createCustomer(db, { organizationId, name: 'Bob Clinic' });
    const hidden = await createCustomer(db, { organizationId: otherOrg, name: 'Other business private customer' });
    await createCustomer(db, { organizationId, name: 'Carl Roofing', phone: '+14165550103' });
    await createCustomer(db, { organizationId, name: 'Dana Bakery' });
    await createCustomer(db, { organizationId, name: 'Erin Florist', phone: '+14165550104' });
    const finn = await createCustomer(db, { organizationId, name: 'Finn Garage', phone: '+14165550105' });
    const add = (customerId: string, title: string, kind: 'call' | 'email' = 'call', org = organizationId) => createFollowUp(db, { organizationId: org, customerId, title, kind, notes: 'Recorded customer follow-up context', dueAt: '2026-10-17T12:00:00Z' });
    // One open Call task per contact: the completed call came first.
    const completed = await add(alice, 'Excluded completed call'); await changeFollowUpStatus(db, { organizationId, id: completed, status: 'completed' });
    await add(alice, 'Discuss the recorded quote'); await add(bob, 'Confirm appointment'); await add(alice, 'Excluded email follow-up', 'email');
    await add(hidden, 'Excluded other business call', 'call', otherOrg);
    await pg.query('delete from platform_staff where user_id=$1', [made.data.user.id]);
    await page.goto('/login'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click(); await page.waitForURL(value => value.pathname !== '/login');
    const base = `/organizations/${organizationId}`;
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base}/calls`);
      await expect(page.getByRole('heading', { name: 'Dialer', exact: true })).toHaveCount(1);
      // Below desktop width one region is shown at a time; choosing a row returns to Calling.
      const region = async (name: 'Call list' | 'Contact') => { const switcher = page.getByRole('group', { name: 'Dialer region' }); if (await switcher.isVisible()) await switcher.getByRole('button', { name, exact: true }).click(); };
      await region('Call list');
      await expect(page.getByRole('button', { name: /Alice Plumbing.*Discuss/ })).toBeVisible();
      await expect(page.getByText('Excluded email follow-up')).toHaveCount(0);
      await expect(page.getByText('Excluded completed call')).toHaveCount(0);
      await expect(page.getByText('Excluded other business call')).toHaveCount(0);
      await page.getByRole('button', { name: /Bob Clinic.*Confirm/ }).click();
      await expect(page.getByText(/No customer phone number is recorded/).filter({ visible: true })).toHaveCount(1);
      await expect(page.getByText(/No customer phone number is recorded/).filter({ visible: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Call', exact: true })).toBeDisabled();
      await region('Call list');
      await page.getByRole('button', { name: /Alice Plumbing.*Discuss/ }).click();
      await expect(page.getByRole('textbox', { name: 'Number to call', exact: true })).toHaveValue('(416)555-0101');
      await region('Contact');
      await expect(page.getByRole('link', { name: 'Alice Plumbing', exact: true })).toHaveAttribute('href', `${base}/crm/contacts/${alice}`);
      await page.getByRole('link', { name: 'Call history', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Call history', exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`dialer-${width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // The Dialer toolbar action opens the shared pop-out; the global telephone utility remains independent.
      const phone = page.getByRole('group', { name: 'Dialer toolbar' }).getByRole('button', { name: 'Pop out dialer' });
      await expect(phone).toBeVisible(); const box = await phone.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      if (width >= 768) { const agent = await page.getByRole('button', { name: 'Agent', exact: true }).boundingBox(); expect(agent!.x + agent!.width).toBeLessThanOrEqual(width); }
      const popupEvent = page.waitForEvent('popup');
      if (width === 390) await phone.tap(); else await phone.press('Enter');
      const popup = await popupEvent;
      await expect(popup.getByLabel('Number to call')).toBeVisible();
      await expect(popup.getByRole('button', { name: 'Call', exact: true })).toBeDisabled();
      await popup.getByLabel('Number to call').fill('+14165550199');
      await page.getByRole('link', { name: 'Alice Plumbing', exact: true }).click();
      await expect(page).toHaveURL(`${testInfo.project.use.baseURL ?? 'http://localhost:3000'}${base}/crm/contacts/${alice}`);
      await expect(popup.getByLabel('Number to call')).toHaveValue('+14165550199');
      await popup.getByRole('button', { name: 'Return to GildOps', exact: true }).click();
      await expect.poll(() => popup.isClosed()).toBe(true);
    }
    // Add to list, in three steps: choose contacts, say why to call them, then review and add.
    const openAddToList = async () => {
      const switcher = page.getByRole('group', { name: 'Dialer region' });
      const addToList = page.getByRole('region', { name: 'Call list' }).getByRole('button', { name: 'Add to list', exact: true });
      // Until the page is interactive a tap on the region switch can be lost, so it is repeated until the list shows.
      await expect(async () => {
        if (await switcher.isVisible()) await switcher.getByRole('button', { name: 'Call list', exact: true }).click();
        await expect(addToList).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await addToList.click();
      const picker = page.getByRole('dialog', { name: 'Add to call list' });
      await expect(picker.getByRole('list', { name: 'Contacts' })).toBeVisible();
      return picker;
    };
    const fitsWidth = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${base}/calls`);
      const picker = await openAddToList();
      await expect(picker.getByRole('checkbox', { name: /Alice Plumbing/ })).toBeDisabled();
      await expect(picker.getByRole('checkbox', { name: /Dana Bakery/ })).toBeDisabled();
      await expect(picker.getByText('Other business private customer')).toHaveCount(0);
      // The dialog keeps its size while a search runs and when it narrows the results.
      const before = await picker.boundingBox();
      await picker.getByRole('searchbox', { name: 'Find contacts' }).fill(width === 1440 ? 'Carl' : 'Erin');
      await expect(picker.getByRole('checkbox', { name: /Alice Plumbing/ })).toHaveCount(0);
      const after = await picker.boundingBox();
      expect(Math.abs(after!.height - before!.height)).toBeLessThan(1);
      expect(Math.abs(after!.width - before!.width)).toBeLessThan(1);
      await picker.getByRole('checkbox', { name: width === 1440 ? /Carl Roofing/ : /Erin Florist/ }).click();
      await expect(picker.getByRole('status').filter({ hasText: '1 contact chosen' })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`add-to-list-contacts-${width}.png`) });
      await picker.getByRole('button', { name: 'Next', exact: true }).click();
      const reason = picker.getByRole('textbox', { name: 'Reason for calling', exact: true });
      await expect(picker.getByRole('button', { name: 'Review', exact: true })).toBeDisabled();
      await reason.fill(width === 1440 ? 'Roof quote' : 'Flower order');
      await picker.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(picker.getByRole('checkbox', { name: width === 1440 ? /Carl Roofing/ : /Erin Florist/ })).toBeChecked();
      await picker.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(reason).toHaveValue(width === 1440 ? 'Roof quote' : 'Flower order');
      await page.screenshot({ path: testInfo.outputPath(`add-to-list-details-${width}.png`) });
      await picker.getByRole('button', { name: 'Review', exact: true }).click();
      await expect(picker.getByRole('heading', { name: 'Will be added (1)' })).toBeVisible();
      await expect(picker.getByRole('button', { name: 'Add 1 to list', exact: true })).toBeInViewport();
      expect(await fitsWidth()).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`add-to-list-review-${width}.png`) });
      await picker.getByRole('button', { name: 'Add 1 to list', exact: true }).click();
      await expect(page.getByText('Added 1 contact to the call list.')).toBeVisible();
      await expect(picker).toBeHidden();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}/calls`);
    await expect(page.getByRole('button', { name: /Carl Roofing.*Roof quote/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Erin Florist.*Flower order/ })).toBeVisible();
    // A contact created inside Add to list, through the ordinary contact form, is chosen and added.
    const picker = await openAddToList();
    await picker.getByRole('button', { name: 'Create contact', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Add a contact' });
    await form.getByRole('radio', { name: /Person/ }).check({ force: true });
    await form.getByLabel('Name', { exact: true }).fill('Gina Gallery');
    await form.getByLabel(/^Phone/).fill('+14165550107');
    await form.getByRole('button', { name: 'Save contact', exact: true }).click();
    await expect(picker.getByRole('checkbox', { name: /Gina Gallery/ })).toBeChecked();
    await picker.getByRole('button', { name: 'Next', exact: true }).click();
    await picker.getByRole('textbox', { name: 'Reason for calling', exact: true }).fill('Welcome call');
    await picker.getByRole('button', { name: 'Review', exact: true }).click();
    await picker.getByRole('button', { name: 'Add 1 to list', exact: true }).click();
    await expect(picker).toBeHidden();
    await expect(page.getByRole('button', { name: /Gina Gallery.*Welcome call/ })).toBeVisible();

    // Remove from list: asks first, cancels the Call task only, and the contact stays.
    for (const [width, name] of [[1440, 'Carl Roofing'], [390, 'Gina Gallery']] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${base}/calls`);
      const switcher = page.getByRole('group', { name: 'Dialer region' });
      const actions = page.getByRole('button', { name: `Actions for ${name}`, exact: true });
      await expect(async () => {
        if (await switcher.isVisible()) await switcher.getByRole('button', { name: 'Call list', exact: true }).click();
        await expect(actions).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await actions.click();
      await page.getByRole('menuitem', { name: 'Remove from list', exact: true }).click();
      const confirm = page.getByRole('alertdialog', { name: `Remove ${name} from the call list?` });
      await expect(confirm).toContainText('a call in progress is not ended');
      await page.screenshot({ path: testInfo.outputPath(`remove-from-list-${width}.png`) });
      expect(await fitsWidth()).toBe(true);
      await confirm.getByRole('button', { name: 'Remove from list', exact: true }).click();
      await expect(page.getByText(`Removed ${name} from the call list.`)).toBeVisible();
      await expect(page.getByRole('button', { name: new RegExp(name) })).toHaveCount(0);
      const rows = await pg.query("select t.status, c.name from crm_tasks t join contacts c on c.organization_id=t.organization_id and c.id=t.customer_id where t.organization_id=$1 and c.name=$2 and t.kind='call'", [organizationId, name]);
      expect(rows.rows).toEqual([{ status: 'cancelled', name }]);
    }
    // Add to from Contacts: tick rows, or everyone matching the search; and from a contact's own page.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}/crm/contacts?q=Gina`);
    await page.getByRole('checkbox', { name: 'Select Gina Gallery' }).click();
    const bar = page.getByRole('region', { name: 'Selected contacts' });
    await expect(bar).toContainText('1 selected');
    await bar.getByRole('button', { name: 'Add to…' }).click();
    await page.getByRole('menuitem', { name: /Call list/ }).click();
    const confirm = page.getByRole('dialog', { name: 'Add to call list' });
    await expect(confirm.getByText('1 contact will be added.')).toBeVisible();
    await confirm.getByRole('textbox', { name: 'Reason for calling', exact: true }).fill('Seasonal order');
    await confirm.getByRole('button', { name: 'Add 1', exact: true }).click();
    await expect(page.getByText('Added 1 contact to the call list.')).toBeVisible();
    await expect(bar).toBeHidden();
    await page.goto(`${base}/crm/contacts?q=Bakery`);
    await page.getByRole('button', { name: 'Add to…' }).click();
    await page.getByRole('menuitem', { name: /Call list/ }).click();
    await expect(confirm.getByText('1 contact in the current search and filters.')).toBeVisible();
    await expect(confirm.getByText('No one here can be added.')).toBeVisible();
    await expect(confirm.getByText('Skipped: 1 contact with no phone number.')).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.goto(`${base}/crm/contacts/${finn}`);
    await page.getByRole('button', { name: 'Add to…' }).click();
    await page.getByRole('menuitem', { name: /Call list/ }).click();
    await confirm.getByRole('textbox', { name: 'Reason for calling', exact: true }).fill('Service reminder');
    await confirm.getByRole('button', { name: 'Add 1', exact: true }).click();
    await expect(page.getByText('Added 1 contact to the call list.')).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Add to…' }).click();
    await expect(page.getByRole('menuitem', { name: /Call list/ })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('menuitem', { name: /Call list/ })).toContainText('On the list');
    await page.keyboard.press('Escape');
    await page.goto(`${base}/calls`);
    await expect(page.getByRole('button', { name: /Gina Gallery.*Seasonal order/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Finn Garage.*Service reminder/ })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto(`${base}/crm/contacts`);
    await expect(async () => {
      await page.getByRole('checkbox', { name: 'Select Dana Bakery' }).click();
      await expect(page.getByRole('region', { name: 'Selected contacts' })).toContainText('1 selected', { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath('contacts-selected-390.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await pg.query('delete from organizations where id=any($1::uuid[])', [organizations]);
    await admin.auth.admin.deleteUser(made.data.user.id);
    await pg.end();
  }
});
