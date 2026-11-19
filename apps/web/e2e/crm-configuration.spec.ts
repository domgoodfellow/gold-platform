import './appearance-env';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { test, expect, type Page } from '@playwright/test';
import { createRole } from '../lib/domain/tenancy/roles';
import { addMember } from '../lib/domain/tenancy/members';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { COLLEAGUE_STORAGE_STATE, loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

/** CRM configuration follows its operating owner. Existing URLs and legacy redirects remain
 * usable with independent entitlement/capability checks at desktop, tablet and phone widths. */

const DOORS = [['Relationship stages', 'relationship-stages'], ['Opportunity stages', 'opportunity-stages'], ['Contact fields', 'fields']] as const;
const sidebarNav = (page: Page) => page.locator('[data-slot="sidebar-container"]').getByRole('navigation', { name: 'This business' });
const breadcrumb = (page: Page) => page.getByRole('navigation', { name: 'breadcrumb' });

test.describe('an owner', () => {
  test.use({ storageState: OWNER_STORAGE_STATE, viewport: { width: 1440, height: 900 } });

  test('CRM Dashboard keeps its direct, keyboard-operable settings menu', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/crm`);
    const configure = page.getByRole('main').getByRole('button', { name: 'Settings', exact: true });
    await configure.focus(); await page.keyboard.press('Enter');
    const items = page.getByRole('menuitem');
    await expect(items).toHaveCount(DOORS.length);
    for (const [index, [label, segment]] of DOORS.entries()) {
      await expect(items.nth(index)).toHaveText(label);
      await expect(items.nth(index)).toHaveAttribute('href', `${base}/crm/configuration/${segment}`);
    }
    await page.keyboard.press('Escape'); await expect(configure).toBeFocused();
  });

  test('existing editor addresses select Contacts or Pipeline and preserve their ancestry', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    for (const [label, segment] of DOORS) {
      await page.goto(`${base}/crm/configuration/${segment}`);
      const owner = segment === 'opportunity-stages' ? 'Pipeline' : 'Contacts';
      await expect(sidebarNav(page).getByRole('link', { name: owner, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(sidebarNav(page).getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
      await expect(breadcrumb(page).getByRole('link', { name: owner, exact: true })).toHaveAttribute('href', `${base}/crm/${owner === 'Contacts' ? 'contacts' : 'pipeline'}`);
      await expect(page.getByRole('heading', { level: 1, name: label, exact: true })).toHaveCount(1);
    }
  });

  test('legacy landing and Settings links retain redirects without a Back loop', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/crm`);
    await page.goto(`${base}/crm/configuration`);
    await expect(page).toHaveURL(`${base}/crm/configuration/relationship-stages`);
    await page.goBack(); await expect(page).toHaveURL(`${base}/crm`);
    await page.goto(`${base}/settings/sales-stages`);
    await expect(page).toHaveURL(`${base}/crm/configuration/relationship-stages`);
  });

  test('Contacts offers relationship stages and fields, while Pipeline configures only opportunity stages', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/crm/contacts`);
    await page.getByRole('button', { name: 'Contact settings', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Relationship stages', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Contact fields', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Opportunity stages', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.goto(`${base}/crm/pipeline`);
    const configure = page.getByRole('link', { name: /^(Set up stages|Opportunity stages)$/ });
    await expect(configure).toHaveCount(1);
    await configure.click(); await expect(page).toHaveURL(`${base}/crm/configuration/opportunity-stages`);
  });

  test('desktop, tablet and phone retain the same Contacts-owned fields entry and keyboard control', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    for (const width of [390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/crm/contacts`);
      const configure = page.getByRole('button', { name: 'Contact settings', exact: true });
      await configure.focus(); await page.keyboard.press('Enter');
      await page.getByRole('menuitem', { name: 'Contact fields', exact: true }).click();
      await expect(page).toHaveURL(`${base}/crm/configuration/fields`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (width === 390) {
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
        const sheet = page.locator('[data-slot="sidebar"][data-mobile="true"]');
        await expect(sheet.getByRole('link', { name: 'Contacts', exact: true })).toHaveAttribute('aria-current', 'page');
        await expect(sheet.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
        await page.keyboard.press('Escape');
      }
    }
  });
});

test.describe('a reduced-role colleague', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE, viewport: { width: 1440, height: 900 } });

  test('hides configuration controls and refuses direct editor access', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/crm`);
    await expect(page.getByRole('main').getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
    for (const [, segment] of DOORS) {
      await page.goto(`${base}/crm/configuration/${segment}`);
      await expect(page.getByRole('heading', { name: 'This page does not exist', exact: true })).toBeVisible();
    }
  });
});

test.describe('a configuration-only member', () => {
  const email = `crm-config-${randomUUID()}@example.test`;
  const password = randomUUID();
  let accountId = '';
  let roleId = '';
  const url = process.env.SUPABASE_URL!;
  const local = (value: string) => { if (!['localhost', '127.0.0.1'].includes(new URL(value).hostname)) throw new Error('CRM configuration fixtures are local-only.'); };
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const owner = createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

  test.beforeAll(async () => {
    local(url);
    const { organizationId, ownerEmail } = loadDemoContext();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    accountId = created.data.user.id;
    const signed = await owner.auth.signInWithPassword({ email: ownerEmail, password: DEMO_PASSWORD });
    if (signed.error) throw signed.error;
    roleId = await createRole(owner, { organizationId, name: `CRM configure ${randomUUID().slice(0, 8)}`, capabilities: ['field.manage'] });
    await addMember(owner, { organizationId, email, roleId, displayName: 'Configuration member' });
  });
  test.afterAll(async () => {
    if (accountId) await admin.auth.admin.deleteUser(accountId);
    if (!roleId) return;
    const connectionString = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    local(connectionString);
    const pg = new Client({ connectionString });
    await pg.connect();
    try { await pg.query('delete from public.roles where id=$1', [roleId]); } finally { await pg.end(); }
  });

  test('keeps every CRM configuration page, through the group, the Home menu and the old landing', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page).toHaveURL(/organizations/);
    await page.goto(`${base}/crm/configuration`);
    await expect(page).toHaveURL(`${base}/crm/configuration/relationship-stages`);
    for (const [label, segment] of DOORS) {
      await page.goto(`${base}/crm/configuration/${segment}`);
      await expect(page.getByRole('heading', { name: label, exact: true, level: 1 })).toBeVisible();
    }
    await expect(sidebarNav(page).getByRole('link', { name: 'Contacts', exact: true })).toHaveCount(0);
    // CRM Home needs no capability, so this member may open it. Communications Home does, so there
    // they are configuration-only: ADR-047 keeps that workspace heading plain text, and the
    // workspace's own row opens their first configuration page, never a landing.
    await page.goto(`${base}/comms/configuration/calling`);
    await expect(sidebarNav(page).locator(`a[href="${base}/comms"]`)).toHaveCount(0);
    await expect(sidebarNav(page).getByText('Communications', { exact: true })).toBeVisible();
    await expect(sidebarNav(page).getByRole('link', { name: 'Calling & routing', exact: true })).toHaveAttribute('aria-current', 'page');
  });
});
