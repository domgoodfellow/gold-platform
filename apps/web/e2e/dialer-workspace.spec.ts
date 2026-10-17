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

test('Dialer uses tenant call follow-ups and the global pop-out survives navigation', async ({ page }, testInfo) => {
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
    const add = (customerId: string, title: string, kind: 'call' | 'email' = 'call', org = organizationId) => createFollowUp(db, { organizationId: org, customerId, title, kind, notes: 'Recorded customer follow-up context', dueAt: '2026-10-17T12:00:00Z' });
    await add(alice, 'Discuss the recorded quote'); await add(bob, 'Confirm appointment'); await add(alice, 'Excluded email follow-up', 'email');
    const completed = await add(alice, 'Excluded completed call'); await changeFollowUpStatus(db, { organizationId, id: completed, status: 'completed' });
    await add(hidden, 'Excluded other business call', 'call', otherOrg);
    await pg.query('delete from platform_staff where user_id=$1', [made.data.user.id]);
    await page.goto('/login'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click(); await page.waitForURL(value => value.pathname !== '/login');
    const base = `/organizations/${organizationId}`;
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base}/calls`);
      await expect(page.getByRole('heading', { name: 'Dialer', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /Alice Plumbing.*Discuss/ })).toBeVisible();
      await expect(page.getByText('Excluded email follow-up')).toHaveCount(0);
      await expect(page.getByText('Excluded completed call')).toHaveCount(0);
      await expect(page.getByText('Excluded other business call')).toHaveCount(0);
      await page.getByRole('button', { name: /Bob Clinic.*Confirm/ }).click();
      await expect(page.getByText(/No customer phone number is recorded/).filter({ visible: true })).toHaveCount(1);
      await expect(page.getByText(/No customer phone number is recorded/).filter({ visible: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Call', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: /Alice Plumbing.*Discuss/ }).click();
      await expect(page.getByRole('textbox', { name: 'Number to call', exact: true })).toHaveValue('+14165550101');
      await expect(page.getByRole('link', { name: 'Alice Plumbing', exact: true })).toHaveAttribute('href', `${base}/customers/${alice}`);
      await page.getByRole('link', { name: 'Call history', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Call history', exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`dialer-${width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const phone = page.getByRole('button', { name: 'Open dialer', exact: true });
      await expect(phone).toBeVisible(); const box = await phone.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      if (width >= 768) { const agent = await page.getByRole('button', { name: 'Agent', exact: true }).boundingBox(); expect(agent!.x + agent!.width).toBeLessThanOrEqual(width); }
      const popupEvent = page.waitForEvent('popup');
      if (width === 390) await phone.tap(); else await phone.press('Enter');
      const popup = await popupEvent;
      await expect(popup.getByLabel('Number to call')).toBeVisible();
      await expect(popup.getByRole('button', { name: 'Call', exact: true })).toBeDisabled();
      await popup.getByLabel('Number to call').fill('+14165550199');
      await page.getByRole('link', { name: 'Alice Plumbing', exact: true }).click();
      await expect(page).toHaveURL(`${testInfo.project.use.baseURL ?? 'http://localhost:3000'}${base}/customers/${alice}`);
      await expect(popup.getByLabel('Number to call')).toHaveValue('+14165550199');
      await expect(page.getByRole('button', { name: 'Open dialer', exact: true })).toBeVisible();
      await popup.getByRole('button', { name: 'Return to GildOps', exact: true }).click();
      await expect.poll(() => popup.isClosed()).toBe(true);
    }
  } finally {
    await pg.query('delete from organizations where id=any($1::uuid[])', [organizations]);
    await admin.auth.admin.deleteUser(made.data.user.id);
    await pg.end();
  }
});
