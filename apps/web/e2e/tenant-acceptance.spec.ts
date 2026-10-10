import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { foundBusiness } from '../tests/support/founding';

/**
 * Two separately provisioned businesses with two separate owners, through the real sign-in screen
 * and the real Settings UI. Owners exist (service-role creates the account only; the business is
 * founded through the supported provisioning path), each signs in independently, each configures
 * their own branding, and neither can reach or alter the other. No session is shared with the demo
 * owner, and nothing is signed in as an administrator.
 */
loadEnv({ path: path.resolve(__dirname, '../../../.env.test') });
test.use({ storageState: { cookies: [], origins: [] } });

async function owner(label: string) {
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `Pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 4)}`, currency: 'CAD', timezone: label.startsWith('cs') ? 'America/Toronto' : 'America/Edmonton' });
  return { email, password, organizationId };
}

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/organizations\//, { timeout: 30_000 });
}

test('each owner signs in on their own, configures their own business, and cannot reach the other', async ({ browser }) => {
  test.setTimeout(240_000);
  const [csOwner, fsOwner] = await Promise.all([owner('cs-owner'), owner('fs-owner')]);
  const csContext = await browser.newContext();
  const fsContext = await browser.newContext();
  const cs = await csContext.newPage();
  const fs = await fsContext.newPage();

  await signIn(cs, csOwner);
  await signIn(fs, fsOwner);
  expect(cs.url()).toContain(csOwner.organizationId);
  expect(fs.url()).toContain(fsOwner.organizationId);

  // Settings are reachable and editable by the owner of that business.
  await cs.goto(`/organizations/${csOwner.organizationId}/settings/branding`);
  await cs.getByRole('button', { name: 'Teal', exact: true }).click();
  await cs.getByRole('button', { name: 'Save appearance' }).click();
  await expect(cs.getByText('Saved.')).toBeVisible();
  await cs.reload();
  await expect(cs.getByLabel('Hex value')).toHaveValue('#0f766e');

  await fs.goto(`/organizations/${fsOwner.organizationId}/settings/branding`);
  await fs.getByRole('button', { name: 'Orange', exact: true }).click();
  await fs.getByRole('button', { name: 'Save appearance' }).click();
  await expect(fs.getByText('Saved.')).toBeVisible();

  // Each business renders its own colour, and not the other's.
  const accent = (page: Page) => page.evaluate(() => getComputedStyle(document.querySelector('[data-brand]')!).getPropertyValue('--accent').trim());
  await cs.goto(`/organizations/${csOwner.organizationId}/home`);
  await fs.goto(`/organizations/${fsOwner.organizationId}/home`);
  expect(await accent(cs)).toBe('#0f766e');
  expect(await accent(fs)).toBe('#c2410c');

  // Naming the other business's address gives an owner nothing: no data, no settings.
  const response = await cs.goto(`/organizations/${fsOwner.organizationId}/settings/branding`);
  expect(response?.status() === 404 || /not found|not available|choose|don.t have access/i.test(await cs.locator('body').innerText()) || !cs.url().includes(fsOwner.organizationId)).toBe(true);
  await expect(cs.getByRole('button', { name: 'Save appearance' })).toHaveCount(0);
  await expect(cs.getByLabel('Hex value')).toHaveCount(0);

  // The other business's branding was never changed by the first owner's session.
  await fs.goto(`/organizations/${fsOwner.organizationId}/settings/branding`);
  await expect(fs.getByLabel('Hex value')).toHaveValue('#c2410c');

  await csContext.close();
  await fsContext.close();
});

test('a signed-out visitor is sent to sign in rather than shown any business', async ({ page }) => {
  const { organizationId } = await owner('anon-check');
  await page.goto(`/organizations/${organizationId}/home`);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(/Customers|Needs attention/)).toHaveCount(0);
});
