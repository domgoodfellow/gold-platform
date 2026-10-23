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
 * The responsive shell contract, measured in a real browser: phone uses the menu sheet; tablet
 * (768–1279px) defaults to the icon rail and expands only as a temporary overlay that keeps the page
 * its width; desktop (1280px and above) docks the sidebar and keeps the person's explicit choice.
 * Destinations, the workspace heading and authorization are the same in every form. Runs against
 * one disposable business (`playwright.isolated.config.ts`).
 */

const sidebar = (page: Page) => page.locator('[data-slot="sidebar"]:not([data-mobile])');
const toggle = (page: Page) => page.locator('header').getByRole('button', { name: 'Toggle Sidebar', exact: true });
/** The rail animates its width; measure once it has settled. */
async function settledRail(page: Page, expected: 'rail' | 'expanded') {
  await expect.poll(async () => (await geometry(page)).rail).toBeLessThanOrEqual(expected === 'rail' ? 60 : 10_000);
  if (expected === 'expanded') await expect.poll(async () => (await geometry(page)).rail).toBeGreaterThan(250);
}
/** The viewport class the page reported, so the next server render can use it. */
async function reportedViewport(page: Page, viewport: string) {
  await expect.poll(async () => (await page.context().cookies()).find((cookie) => cookie.name === 'sidebar_viewport')?.value).toBe(viewport);
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const width = (selector: string) => { const element = document.querySelector(selector); const box = element?.getBoundingClientRect(); return element && box && getComputedStyle(element).display !== 'none' ? Math.round(box.width) : 0; };
    const main = document.querySelector('main')!.getBoundingClientRect();
    return { rail: width('[data-slot="sidebar-container"]'), gap: width('[data-slot="sidebar-gap"]'), main: Math.round(main.width), mainLeft: Math.round(main.left), overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
}

/** Link targets in the visible navigation — the same projection whatever its presentation. */
async function navigationHrefs(page: Page) {
  return page.locator('[data-slot="sidebar"] nav a[href]').evaluateAll((links) => links.filter((link) => link.getBoundingClientRect().width > 0).map((link) => link.getAttribute('href')).sort());
}

test.describe('responsive shell', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  for (const width of [320, 390]) {
    test(`phone ${width}px: the menu sheet, never a docked rail, and no horizontal overflow`, async ({ page }) => {
      const { organizationId } = loadDemoContext();
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/organizations/${organizationId}/crm/contacts`);
      await expect(sidebar(page)).toHaveCount(0);
      await page.locator('header').getByRole('button', { name: 'Menu', exact: true }).click();
      const sheet = page.locator('[data-slot="sidebar"][data-mobile="true"]');
      await expect(sheet.getByRole('link', { name: 'Contacts', exact: true })).toBeVisible();
      expect((await geometry(page)).overflow).toBe(false);
    });
  }

  for (const width of [768, 820, 1024, 1279]) {
    test(`tablet ${width}px: icon rail by default, overlay that keeps the page width, Escape returns focus`, async ({ page }) => {
      const { organizationId } = loadDemoContext();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/organizations/${organizationId}/crm/contacts`);
      await expect(sidebar(page)).toHaveAttribute('data-state', 'collapsed');
      await settledRail(page, 'rail');
      const rail = await geometry(page);
      expect(rail.rail).toBeLessThanOrEqual(60);
      expect(rail.main).toBeGreaterThanOrEqual(width - 60);
      expect(rail.overflow).toBe(false);

      await toggle(page).click();
      await expect(sidebar(page)).toHaveAttribute('data-overlay', 'true');
      await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
      await settledRail(page, 'expanded');
      const expanded = await geometry(page);
      expect(expanded.rail).toBeGreaterThan(250);
      // The page keeps its rail-width layout under the overlay.
      expect(expanded.main).toBe(rail.main);
      expect(await sidebar(page).evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await expect(page.locator('[data-slot="sidebar"]').getByRole('link', { name: 'Contacts', exact: true })).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(sidebar(page)).toHaveAttribute('data-state', 'collapsed');
      await expect(toggle(page)).toBeFocused();

      await toggle(page).click();
      await page.locator('[data-slot="sidebar-scrim"]').click({ position: { x: width - 20, y: 400 } });
      await expect(sidebar(page)).toHaveAttribute('data-state', 'collapsed');

      // The header toggle sits under the open panel; the panel carries a visible close control.
      await toggle(page).click();
      const close = page.getByRole('button', { name: 'Close navigation' });
      await expect(close).toBeVisible();
      await close.click();
      await expect(sidebar(page)).toHaveAttribute('data-state', 'collapsed');
      await expect(toggle(page)).toBeFocused();
    });
  }

  for (const width of [1280, 1440]) {
    test(`desktop ${width}px: docked and expanded by default`, async ({ page, context }) => {
      await context.clearCookies({ name: 'sidebar_state' });
      const { organizationId } = loadDemoContext();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/organizations/${organizationId}/crm/contacts`);
      await expect(sidebar(page)).toHaveAttribute('data-state', 'expanded');
      await expect(sidebar(page)).not.toHaveAttribute('data-overlay', 'true');
      await settledRail(page, 'expanded');
      const docked = await geometry(page);
      expect(docked.rail).toBeGreaterThan(250);
      expect(docked.mainLeft).toBeGreaterThanOrEqual(docked.rail - 1);
      expect(docked.overflow).toBe(false);
    });
  }

  test('the 1279/1280 boundary switches cleanly in both directions, and an overlay never crosses it', async ({ page, context }) => {
    await context.clearCookies({ name: 'sidebar_state' });
    const { organizationId } = loadDemoContext();
    await page.setViewportSize({ width: 1279, height: 900 });
    await page.goto(`/organizations/${organizationId}/crm/contacts`);
    await expect(sidebar(page)).toHaveAttribute('data-state', 'collapsed');
    await toggle(page).click();
    await expect(sidebar(page)).toHaveAttribute('data-overlay', 'true');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(sidebar(page)).toHaveAttribute('data-state', 'expanded');
    await expect(sidebar(page)).not.toHaveAttribute('data-overlay', 'true');
    await page.setViewportSize({ width: 1279, height: 900 });
    await expect(sidebar(page)).toHaveAttribute('data-state', 'collapsed');
    await expect(sidebar(page)).not.toHaveAttribute('data-overlay', 'true');
  });

  test('an explicit desktop choice persists; a tablet overlay is never saved', async ({ page, context }) => {
    await context.clearCookies({ name: 'sidebar_state' });
    const { organizationId } = loadDemoContext();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/organizations/${organizationId}/crm/contacts`);
    await toggle(page).click();
    await expect(sidebar(page)).toHaveAttribute('data-state', 'collapsed');
    await page.reload();
    await expect(sidebar(page)).toHaveAttribute('data-state', 'collapsed');

    await page.setViewportSize({ width: 1024, height: 900 });
    await toggle(page).click();
    await expect(sidebar(page)).toHaveAttribute('data-overlay', 'true');
    await page.reload();
    await expect(sidebar(page)).toHaveAttribute('data-state', 'collapsed');
    await expect(sidebar(page)).not.toHaveAttribute('data-overlay', 'true');

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(sidebar(page)).toHaveAttribute('data-state', 'collapsed');
    await toggle(page).click();
    await page.reload();
    await expect(sidebar(page)).toHaveAttribute('data-state', 'expanded');
  });

  test('the server renders the layout the browser last reported, so a reload does not flash', async ({ page, context }) => {
    const { organizationId } = loadDemoContext();
    const url = `/organizations/${organizationId}/crm/contacts`;
    await context.clearCookies({ name: 'sidebar_state' });
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(url);
    await reportedViewport(page, 'tablet');
    // The tablet visit recorded its viewport; the next server response is already the rail.
    const tablet = await (await page.request.get(url)).text();
    expect(tablet).toMatch(/data-slot="sidebar"[^>]*data-state="collapsed"|data-state="collapsed"[^>]*data-slot="sidebar"/);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await reportedViewport(page, 'desktop');
    const desktop = await (await page.request.get(url)).text();
    expect(desktop).toMatch(/data-slot="sidebar"[^>]*data-state="expanded"|data-state="expanded"[^>]*data-slot="sidebar"/);
  });

  test('tablet overlay offers the same destinations as desktop, with explicit Dashboard navigation', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/organizations/${organizationId}/crm/contacts`);
    const desktop = await navigationHrefs(page);
    await page.setViewportSize({ width: 820, height: 900 });
    await toggle(page).click();
    await expect(sidebar(page)).toHaveAttribute('data-overlay', 'true');
    expect(await navigationHrefs(page)).toEqual(desktop);
    // The header carries no copy of the workspace destinations (ADR-048).
    await expect(page.locator('[data-header-controls] nav')).toHaveCount(0);
    await expect(sidebar(page).getByRole('heading', { name: 'CRM', exact: true })).toBeVisible();
    await sidebar(page).getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/organizations/${organizationId}/crm$`));
    await expect(sidebar(page)).not.toHaveAttribute('data-overlay', 'true');
  });

  test('Agent and Configure open over the tablet layout without trapping navigation, and the drawer guard still works', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(`/organizations/${organizationId}/crm/contacts`);

    await page.getByRole('button', { name: 'Agent', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Close Agent' })).toBeVisible();
    await toggle(page).click();
    await expect(sidebar(page)).toHaveAttribute('data-overlay', 'true');
    await page.keyboard.press('Escape');
    await expect(sidebar(page)).toHaveAttribute('data-state', 'collapsed');
    await page.getByRole('button', { name: 'Close Agent' }).click();
    await expect(page.getByRole('button', { name: 'Close Agent' })).toBeHidden();

    // A page that still registers a Configure panel (Package 3A retired Customers' link-only one).
    await page.goto(`/organizations/${organizationId}/resources`);
    await page.locator('main').getByRole('button', { name: /^Configure$/ }).click();
    await expect(page.getByRole('dialog', { name: 'Resources configuration' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto(`/organizations/${organizationId}/crm/configuration/fields`);
    await page.getByRole('button', { name: /New field/ }).click();
    await page.getByLabel('Label', { exact: true }).fill('Typed on a tablet');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.getByRole('dialog', { name: 'New field' })).toBeHidden();
    expect((await geometry(page)).overflow).toBe(false);
  });
});

test.describe('a reduced-role colleague', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });

  test('sees the same permitted destinations in the tablet overlay as at desktop', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/organizations/${organizationId}/home`);
    const desktop = await navigationHrefs(page);
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(sidebar(page)).toHaveAttribute('data-state', 'collapsed');
    await toggle(page).click();
    expect(await navigationHrefs(page)).toEqual(desktop);
  });
});

test.describe('a configuration-only member', () => {
  const email = `responsive-config-${randomUUID()}@example.test`;
  const password = randomUUID();
  let accountId = '';
  let roleId = '';
  const url = process.env.SUPABASE_URL!;
  const local = (value: string) => { if (!['localhost', '127.0.0.1'].includes(new URL(value).hostname)) throw new Error('Responsive shell fixtures are local-only.'); };
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
    // `field.manage` alone reaches Communications configuration (call outcomes) without operating Communications.
    roleId = await createRole(owner, { organizationId, name: `Responsive configure ${randomUUID().slice(0, 8)}`, capabilities: ['field.manage'] });
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

  test('keeps Communications configuration reachable and its operating pages absent in the tablet overlay, exactly as at desktop', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page).toHaveURL(/organizations/);
    await page.goto(`/organizations/${organizationId}/comms/configuration/calling`);
    await expect(page).toHaveURL(`/organizations/${organizationId}/comms/configuration/calling`);
    const desktop = await navigationHrefs(page);
    for (const operating of ['comms', 'calls', 'comms/inbox']) expect(desktop).not.toContain(`/organizations/${organizationId}/${operating}`);
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(sidebar(page)).toHaveAttribute('data-state', 'collapsed');
    await toggle(page).click();
    await expect(sidebar(page)).toHaveAttribute('data-overlay', 'true');
    expect(await navigationHrefs(page)).toEqual(desktop);
    await expect(page.locator('[data-slot="sidebar"]').locator(`a[href="/organizations/${organizationId}/comms/configuration/calling"]`)).toBeVisible();
  });
});
