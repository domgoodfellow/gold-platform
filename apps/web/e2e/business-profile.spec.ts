import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { loadDemoContext, OWNER_STORAGE_STATE, COLLEAGUE_STORAGE_STATE } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

test('Settings is one contextual sidebar, and Back to app returns to where the person was', async ({ page }) => {
  const { organizationId } = loadDemoContext();
  await page.goto(`/organizations/${organizationId}/finance`);
  await page.getByRole('button').filter({ hasText: /@/ }).last().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page).toHaveURL(`/organizations/${organizationId}/settings/general`);

  const nav = page.getByRole('navigation', { name: 'Settings' });
  for (const name of ['Profile', 'Security & sign-in', 'General', 'Branding', 'Domains', 'Features', 'Team & access', 'Connections', 'Plan & usage']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  // Workspaces are not drawn beside it, and the global bar says Settings once.
  await expect(nav.getByRole('link', { name: 'CRM', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'General' })).toBeVisible();

  await nav.getByRole('link', { name: 'Team & access' }).click();
  await expect(page).toHaveURL(/\/settings\/access/);
  await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Team & access' })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('link', { name: 'Back to app' }).click();
  await expect(page).toHaveURL(`/organizations/${organizationId}/finance`);
});

test('a deep Settings link carries the Settings navigation, and the old Organization page lands on General', async ({ page }) => {
  const { organizationId } = loadDemoContext();
  await page.goto(`/organizations/${organizationId}/settings/plan`);
  await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Plan & usage' })).toHaveAttribute('aria-current', 'page');
  await page.goto(`/organizations/${organizationId}/settings/organization`);
  await expect(page).toHaveURL(`/organizations/${organizationId}/settings/general`);
});

test('searching Settings finds configuration a workspace owns and opens it there', async ({ page }) => {
  const { organizationId } = loadDemoContext();
  await page.goto(`/organizations/${organizationId}/settings/general`);
  await page.getByRole('searchbox', { name: 'Search settings' }).fill('working hours');
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: /Working hours/ }).click();
  await expect(page).toHaveURL(`/organizations/${organizationId}/schedule/configuration`);
  // It is a Work page, so the workspaces are back.
  await expect(page.getByRole('navigation', { name: 'This business' }).first()).toBeVisible();
});

test('the business profile persists, proposes a clock without applying it, and keeps the address private', async ({ page }) => {
  const { organizationId } = loadDemoContext();
  await page.goto(`/organizations/${organizationId}/settings/general`);

  await page.getByLabel('Legal name').fill('Grachtwerk Verhuur B.V.');
  await page.getByLabel('Industry').fill('Equipment rental');
  await page.getByLabel('Country').selectOption('CA');
  await page.getByLabel('Province or territory').selectOption('QC');
  await page.getByLabel('City').fill('Montreal');
  await page.getByLabel('Postal code').fill('H2X 1Y4');
  await page.getByLabel('Street address').fill('123 Rue Example');
  await page.getByLabel('Unit or suite').fill('Suite 4');
  await page.getByLabel('Email').fill('info@grachtwerk.test');
  await page.getByLabel('Phone').fill('+1 514 555 0100');
  await page.getByLabel('Website').fill('grachtwerk.test');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Business profile saved' })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Legal name')).toHaveValue('Grachtwerk Verhuur B.V.');
  await expect(page.getByLabel('City')).toHaveValue('Montreal');
  await expect(page.getByLabel('Website')).toHaveValue('https://grachtwerk.test');
  await expect(page.getByText('This business profile is not complete yet')).toHaveCount(0);

  // Moving the location proposes the new clock; it is not applied until accepted.
  await page.getByLabel('Province or territory').selectOption('BC');
  await expect(page.getByText(/usually runs on Pacific/)).toBeVisible();
  await page.getByRole('button', { name: 'Use it' }).first().click();
  await expect(page.getByText(/Pacific/).first()).toBeVisible();
  await page.getByLabel('Province or territory').selectOption('QC');

  // The address is private: the public profile does not carry it.
  await page.goto(`/organizations/${organizationId}/settings/public-profile`);
  await expect(page.getByLabel('Address')).not.toHaveValue(/123 Rue Example/);

  // Leave the shared demo business as it was found.
  await page.goto(`/organizations/${organizationId}/settings/general`);
  for (const label of ['Legal name', 'Industry', 'City', 'Postal code', 'Street address', 'Unit or suite', 'Email', 'Phone', 'Website']) await page.getByLabel(label).fill('');
  await page.getByLabel('Country').selectOption('');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Business profile saved' })).toBeVisible();
});

test('the account menu separates Settings, Help, Contact support and Sign out', async ({ page }) => {
  const { organizationId } = loadDemoContext();
  await page.goto(`/organizations/${organizationId}/home`);
  await page.getByRole('button').filter({ hasText: /@/ }).last().click();
  for (const name of ['Settings', 'Help & documentation', 'Contact GildOps Support', 'Sign out']) {
    await expect(page.getByRole('menuitem', { name })).toBeVisible();
  }
  await expect(page.getByRole('menu').getByRole('separator')).toHaveCount(4);
  await page.getByRole('menuitem', { name: 'Help & documentation' }).click();
  await expect(page).toHaveURL(`/organizations/${organizationId}/help`);

  await page.getByRole('searchbox', { name: 'Search help' }).fill('invitations');
  await page.getByRole('link', { name: /Team and permissions/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Team and permissions' })).toBeVisible();
});

test('contacting GildOps Support records a request for the business', async ({ page }) => {
  const { organizationId } = loadDemoContext();
  await page.goto(`/organizations/${organizationId}/finance`);
  await page.getByRole('button').filter({ hasText: /@/ }).last().click();
  await page.getByRole('menuitem', { name: 'Contact GildOps Support' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Contact GildOps Support' })).toBeVisible();
  await page.getByLabel('Subject').fill('Question about invoices');
  await page.getByLabel('What do you need help with?').fill('How do I change the wording on an invoice?');
  await page.getByRole('button', { name: 'Send to GildOps' }).click();
  await expect(page.getByText('Your request has been sent to GildOps.')).toBeVisible();
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 800 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  test(`General fits at ${viewport.width}px and its last control scrolls clear of the edge`, async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.setViewportSize(viewport);
    await page.goto(`/organizations/${organizationId}/settings/general`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const save = page.getByRole('button', { name: 'Save changes' });
    await save.scrollIntoViewIfNeeded();
    await page.evaluate(() => { const scroller = document.querySelector('[data-slot="sidebar-inset"]'); if (scroller) scroller.scrollTop = scroller.scrollHeight; });
    const box = await save.boundingBox();
    const view = page.viewportSize()!;
    // On a phone the persistent bar covers the bottom 56px; the save control must sit above it with room to spare.
    const covered = viewport.width < 768 ? 56 : 0;
    expect(box!.y + box!.height).toBeLessThanOrEqual(view.height - covered - 16);
  });
}

test.describe('a member who may not configure the business', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });

  test('sees their own settings only, and General says why it is read-only', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/settings/general`);
    await expect(page.getByText(/cannot change the business profile/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Profile' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Plan & usage' })).toHaveCount(0);
  });
});

test.describe('founding a business', () => {
  // A person with no business yet: founding is only offered to them.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('suggests the clock and currency from where the business is, lets the founder override them, and records the location', async ({ page }) => {
    const admin = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `founder-${Date.now()}@example.test`;
    const created = await admin.auth.admin.createUser({ email, password: DEMO_PASSWORD, email_confirm: true });
    if (created.error) throw created.error;

    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page).toHaveURL(/\/organizations$/);

    await page.getByLabel('What is the business called?').fill(`Montreal Test ${Date.now()}`);
    await page.getByLabel('Country').selectOption('CA');
    await page.getByLabel('Province or territory').selectOption('QC');
    await page.getByLabel('City').fill('Montreal');
    await expect(page.getByText(/Based in Montreal, Quebec, Canada/)).toBeVisible();
    await expect(page.getByText(/Eastern Time/)).toBeVisible();
    await expect(page.getByText('CAD', { exact: true }).first()).toBeVisible();

    // Overriding the suggestion is deliberate and survives a later change of region.
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Currency').selectOption('USD');
    await page.getByLabel('Province or territory').selectOption('BC');
    await expect(page.getByLabel('Currency')).toHaveValue('USD');
    await page.getByLabel('Province or territory').selectOption('QC');
    await page.getByLabel('What kind of business').fill('Equipment rental');
    await page.getByRole('button', { name: 'Create business' }).click();

    await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]+\//);
    const orgId = page.url().match(/organizations\/([0-9a-f-]+)/)![1];
    const founder = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_ANON_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });
    await founder.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
    const { data, error } = await founder.from('organization_identity').select('country_code, region, city, industry').eq('organization_id', orgId).single();
    expect(error, orgId).toBeNull();
    expect(data).toEqual({ country_code: 'CA', region: 'QC', city: 'Montreal', industry: 'Equipment rental' });
    const { data: org } = await founder.from('organizations').select('timezone, currency').eq('id', orgId).single();
    expect(org).toEqual({ timezone: 'America/Toronto', currency: 'USD' });
  });
});
