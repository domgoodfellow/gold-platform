import './appearance-env';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { test, expect, type Page } from '@playwright/test';
import { createRole } from '../lib/domain/tenancy/roles';
import { addMember } from '../lib/domain/tenancy/members';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { COLLEAGUE_STORAGE_STATE, loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

/**
 * How CRM configuration is found (Package 3A), in a real browser: CRM Home's Configure menu, a
 * Configuration sidebar group that expands rather than links, plain-text Configuration ancestry,
 * the retired landing address resolving to an eligible page without a Back loop, and the same
 * doors on desktop, tablet and phone. Other workspaces keep their landing. Runs against one
 * disposable business (`playwright.isolated.config.ts`).
 */

const DOORS = [['Relationship stages', 'relationship-stages'], ['Opportunity stages', 'opportunity-stages'], ['Customer fields', 'fields']] as const;
const sidebarNav = (page: Page) => page.locator('[data-slot="sidebar-container"]').getByRole('navigation', { name: 'This business' });
const breadcrumb = (page: Page) => page.getByRole('navigation', { name: 'breadcrumb' });

test.describe('an owner', () => {
  test.use({ storageState: OWNER_STORAGE_STATE, viewport: { width: 1440, height: 900 } });

  test('CRM Home offers a Configure menu of direct links, operable from the keyboard', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/sales`);
    await expect(page.getByRole('main').getByRole('link', { name: 'Configuration', exact: true })).toHaveCount(0);
    const configure = page.getByRole('main').getByRole('button', { name: 'Configure', exact: true });
    await configure.focus();
    await page.keyboard.press('Enter');
    const items = page.getByRole('menuitem');
    await expect(items).toHaveCount(DOORS.length);
    for (const [index, [label, segment]] of DOORS.entries()) {
      await expect(items.nth(index)).toHaveText(label);
      await expect(items.nth(index)).toHaveAttribute('href', `${base}/sales/configuration/${segment}`);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(configure).toBeFocused();
    await configure.click();
    await page.getByRole('menuitem', { name: 'Opportunity stages' }).click();
    await expect(page).toHaveURL(`${base}/sales/configuration/opportunity-stages`);
  });

  test('a configuration page names Configuration as plain text and has one heading', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/sales/configuration/relationship-stages`);
    await expect(breadcrumb(page).getByRole('link', { name: 'CRM', exact: true })).toHaveAttribute('href', `${base}/sales`);
    await expect(breadcrumb(page).getByText('Configuration', { exact: true })).toBeVisible();
    await expect(breadcrumb(page).getByRole('link', { name: 'Configuration', exact: true })).toHaveCount(0);
    await expect(breadcrumb(page).locator('[aria-current="page"]')).toHaveText('Relationship stages');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('[data-header-controls] nav')).toHaveCount(0);
  });

  test('the retired landing resolves to an eligible page, and Back does not return to it', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/sales`);
    await page.goto(`${base}/sales/configuration`);
    await expect(page).toHaveURL(`${base}/sales/configuration/relationship-stages`);
    await page.goBack();
    await expect(page).toHaveURL(`${base}/sales`);
    // The legacy Settings address still lands on its canonical page.
    await page.goto(`${base}/settings/sales-stages`);
    await expect(page).toHaveURL(`${base}/sales/configuration/relationship-stages`);
  });

  test('the sidebar Configuration heading expands and collapses; only its children navigate', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/sales/configuration/relationship-stages`);
    const nav = sidebarNav(page);
    await expect(nav.getByRole('link', { name: 'Configuration', exact: true })).toHaveCount(0);
    const heading = nav.getByRole('button', { name: 'Configuration', exact: true });
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
    await heading.click();
    await expect(heading).toHaveAttribute('aria-expanded', 'false');
    await expect(nav.getByRole('link', { name: 'Customer fields', exact: true })).toHaveCount(0);
    await heading.focus();
    await page.keyboard.press('Enter');
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Space');
    await expect(heading).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(`${base}/sales/configuration/relationship-stages`);
    for (const [label, segment] of DOORS) {
      const link = nav.getByRole('link', { name: label, exact: true });
      await link.click();
      await expect(page).toHaveURL(`${base}/sales/configuration/${segment}`);
      await expect(link).toHaveAttribute('aria-current', 'page');
    }
    await page.reload();
    await expect(nav.getByRole('link', { name: 'Customer fields', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(page).toHaveURL(`${base}/sales/configuration/opportunity-stages`);
    // The workspace heading remains the separate way to CRM Home.
    await nav.getByRole('link', { name: /^CRM/ }).first().click();
    await expect(page).toHaveURL(`${base}/sales`);
  });

  test('Customers has no Configure panel; Relationship pipeline links straight to Relationship stages', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/customers`);
    await expect(page.getByRole('main').getByRole('button', { name: 'Configure', exact: true })).toHaveCount(0);
    await page.goto(`${base}/customers/pipeline`);
    await expect(page.getByText(/Stage settings/)).toHaveCount(0);
    const door = page.getByRole('main').getByRole('link', { name: 'Relationship stages' }).first();
    await expect(door).toHaveAttribute('href', `${base}/sales/configuration/relationship-stages`);
  });

  test('other workspaces keep their Configuration landing and linked parent', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/comms/configuration`);
    await expect(page).toHaveURL(`${base}/comms/configuration`);
    await expect(page.getByRole('navigation', { name: 'Communications configuration' })).toBeVisible();
    await expect(sidebarNav(page).getByRole('link', { name: 'Configuration', exact: true })).toBeVisible();
  });

  test('tablet: the rail Configuration opens the navigation with the group expanded', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(`${base}/sales`);
    await expect(page.locator('[data-slot="sidebar"]:not([data-mobile])')).toHaveAttribute('data-state', 'collapsed');
    await sidebarNav(page).getByRole('button', { name: 'Configuration', exact: true }).click();
    await expect(page.locator('[data-slot="sidebar"]:not([data-mobile])')).toHaveAttribute('data-overlay', 'true');
    const fields = sidebarNav(page).getByRole('link', { name: 'Customer fields', exact: true });
    await expect(fields).toBeVisible();
    await fields.click();
    await expect(page).toHaveURL(`${base}/sales/configuration/fields`);
    await expect(page.locator('[data-slot="sidebar"]:not([data-mobile])')).not.toHaveAttribute('data-overlay', 'true');
  });

  test('phone: the menu sheet offers the Configuration group and its pages', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/sales`);
    await page.locator('header').getByRole('button', { name: 'Menu', exact: true }).click();
    const sheet = page.locator('[data-slot="sidebar"][data-mobile="true"]');
    const heading = sheet.getByRole('button', { name: 'Configuration', exact: true });
    await expect(heading).toBeVisible();
    if ((await heading.getAttribute('aria-expanded')) !== 'true') await heading.click();
    await sheet.getByRole('link', { name: 'Opportunity stages', exact: true }).click();
    await expect(page).toHaveURL(`${base}/sales/configuration/opportunity-stages`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

test.describe('a reduced-role colleague', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE, viewport: { width: 1440, height: 900 } });

  test('sees CRM configuration only as far as their permissions reach, consistently everywhere', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/sales`);
    const group = sidebarNav(page).getByRole('button', { name: 'Configuration', exact: true });
    const doors = await group.count() ? await sidebarNav(page).locator(`a[href^="${base}/sales/configuration/"]`).evaluateAll((links) => links.map((link) => link.getAttribute('href'))) : [];
    const control = page.getByRole('main').getByRole('button', { name: 'Configure', exact: true }).or(page.getByRole('main').getByRole('link', { name: /Relationship stages|Opportunity stages|Customer fields/ }));
    await page.goto(`${base}/sales/configuration`);
    if (doors.length === 0) {
      await page.goto(`${base}/sales`);
      await expect(control).toHaveCount(0);
      await page.goto(`${base}/sales/configuration`);
      await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible();
    } else {
      expect(doors).toContain(new URL(page.url()).pathname);
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
    await page.goto(`${base}/sales/configuration`);
    await expect(page).toHaveURL(`${base}/sales/configuration/relationship-stages`);
    for (const [label, segment] of DOORS) await expect(sidebarNav(page).getByRole('link', { name: label, exact: true })).toHaveAttribute('href', `${base}/sales/configuration/${segment}`);
  });
});
