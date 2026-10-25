import './appearance-env';
import { test, expect, type Page } from '@playwright/test';
import { COLLEAGUE_STORAGE_STATE, loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

/**
 * Batch A, in a real browser: no workspace has a Configuration landing. Each old `{home}/configuration`
 * address resolves to an eligible page without a Back loop; each Home's Configure control is nothing,
 * one direct link or a menu of direct links; the sidebar's Configuration is a direct link for one page
 * and an expand/collapse heading for several; and no sidebar or breadcrumb links to a landing. CRM's
 * own detail is in `crm-configuration.spec.ts`. Runs against one disposable business
 * (`playwright.isolated.config.ts`).
 */

const LANDINGS = ['sales', 'comms', 'support', 'field', 'finance', 'studio', 'ai'] as const;
const sidebarNav = (page: Page) => page.locator('[data-slot="sidebar-container"]').getByRole('navigation', { name: 'This business' });
const breadcrumb = (page: Page) => page.getByRole('navigation', { name: 'breadcrumb' });
const landingHref = (base: string) => new RegExp(`^${base}/(${LANDINGS.join('|')})/configuration$`);
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

/** A retired landing never renders: it becomes another page, or not-found when nothing is offered. */
async function resolvesAway(page: Page, base: string, segment: string) {
  await page.goto(`${base}/${segment}/configuration`);
  const notFound = page.getByRole('heading', { name: 'This page does not exist' });
  if (await notFound.isVisible()) return null;
  await expect(page).not.toHaveURL(`${base}/${segment}/configuration`);
  await expect(page.getByRole('heading', { level: 1, name: 'Configuration', exact: true })).toHaveCount(0);
  return new URL(page.url()).pathname;
}

test.describe('an owner', () => {
  test.use({ storageState: OWNER_STORAGE_STATE, viewport: { width: 1440, height: 900 } });

  test('every old configuration landing resolves to a real page, and Back does not return to it', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    const expected: Record<string, string> = {
      comms: `${base}/comms/configuration/calling`,
      support: `${base}/support/configuration/queues`,
      field: `${base}/work/configuration`,
      finance: `${base}/finance/configuration/pricing`,
      studio: `${base}/settings/branding`,
    };
    for (const segment of LANDINGS) {
      const landed = await resolvesAway(page, base, segment);
      if (expected[segment]) expect(landed, segment).toBe(expected[segment]);
    }
    await page.goto(`${base}/comms`);
    await page.goto(`${base}/comms/configuration`);
    await expect(page).toHaveURL(`${base}/comms/configuration/calling`);
    await page.goBack();
    await expect(page).toHaveURL(`${base}/comms`);
  });

  test('Communications Home offers a Configure menu of direct links, without the anchor-only entry', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/comms`);
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Configuration', exact: true })).toHaveCount(0);
    const configure = main.getByRole('button', { name: 'Configure', exact: true });
    await configure.focus();
    await page.keyboard.press('Enter');
    const items = page.getByRole('menuitem');
    await expect(items.first()).toHaveText('Calling & routing');
    await expect(items.first()).toHaveAttribute('href', `${base}/comms/configuration/calling`);
    await expect(page.getByRole('menuitem', { name: /Recording/ })).toHaveCount(0);
    for (const href of await items.evaluateAll((links) => links.map((link) => link.getAttribute('href')!))) expect(href).not.toMatch(landingHref(base));
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(configure).toBeFocused();
    await configure.click();
    await page.getByRole('menuitem', { name: 'Messaging', exact: true }).click();
    await expect(page).toHaveURL(`${base}/comms/configuration/messaging`);
  });

  test('Finance has one configuration page: a direct Home link and a direct sidebar link', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/finance`);
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: 'Configure', exact: true })).toHaveCount(0);
    await expect(main.getByRole('link', { name: 'Payments & currency', exact: true })).toHaveAttribute('href', `${base}/finance/configuration/pricing`);
    const nav = sidebarNav(page);
    await expect(nav.getByRole('button', { name: 'Configuration', exact: true })).toHaveCount(0);
    const configuration = nav.getByRole('link', { name: 'Configuration', exact: true });
    await expect(configuration).toHaveAttribute('href', `${base}/finance/configuration/pricing`);
    await configuration.click();
    await expect(page).toHaveURL(`${base}/finance/configuration/pricing`);
    await expect(configuration).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Payment collection' })).toHaveCount(0);
    await expect(breadcrumb(page).getByRole('link', { name: 'Configuration', exact: true })).toHaveCount(0);
  });

  test('Work Home offers a Configure menu instead of a "Configuration" landing link', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/field`);
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Configuration', exact: true })).toHaveCount(0);
    const configure = main.getByRole('button', { name: 'Configure', exact: true }).or(main.getByRole('link', { name: 'Work types & workflow', exact: true }));
    await expect(configure).toHaveCount(1);
    if (await main.getByRole('button', { name: 'Configure', exact: true }).count()) {
      await configure.click();
      await expect(page.getByRole('menuitem', { name: 'Work types & workflow' })).toHaveAttribute('href', `${base}/work/configuration`);
      // Resources and Locations are operating lists, not configuration.
      await expect(page.getByRole('menuitem', { name: /Resources|Locations/ })).toHaveCount(0);
    }
  });

  test('Marketing and Automations offer no Configure control that could lead nowhere', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    for (const segment of ['marketing', 'automations']) {
      await page.goto(`${base}/${segment}`);
      if (await page.getByRole('heading', { name: 'This page does not exist' }).isVisible()) continue;
      await expect(page.getByRole('main').getByRole('button', { name: 'Configure', exact: true }), segment).toHaveCount(0);
      await expect(page.getByRole('main').getByRole('link', { name: 'Configuration', exact: true }), segment).toHaveCount(0);
    }
  });

  test('a Communications configuration page: group heading expands and collapses, breadcrumb level is plain text', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/comms/configuration/calling`);
    const nav = sidebarNav(page);
    await expect(nav.getByRole('link', { name: 'Configuration', exact: true })).toHaveCount(0);
    const heading = nav.getByRole('button', { name: 'Configuration', exact: true });
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
    const calling = nav.getByRole('link', { name: 'Calling & routing', exact: true });
    await expect(calling).toHaveAttribute('aria-current', 'page');
    await heading.focus();
    await page.keyboard.press('Space');
    await expect(heading).toHaveAttribute('aria-expanded', 'false');
    await expect(calling).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
    await expect(page).toHaveURL(`${base}/comms/configuration/calling`);
    await expect(breadcrumb(page).getByRole('link', { name: 'Communications', exact: true })).toHaveAttribute('href', `${base}/comms`);
    await expect(breadcrumb(page).getByText('Configuration', { exact: true })).toBeVisible();
    await expect(breadcrumb(page).getByRole('link', { name: 'Configuration', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('no sidebar in any workspace links to a configuration landing', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    for (const path of ['sales', 'comms', 'support', 'field', 'finance', 'studio', 'ai', 'comms/configuration/calling', 'settings/branding']) {
      await page.goto(`${base}/${path}`);
      const hrefs = await page.locator('[data-slot="sidebar-container"] a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href')!));
      for (const href of hrefs) expect(href, path).not.toMatch(landingHref(base));
    }
  });

  test('tablet: the rail Configuration opens the navigation with the Communications group expanded', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(`${base}/comms`);
    const sidebar = page.locator('[data-slot="sidebar"]:not([data-mobile])');
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
    await sidebarNav(page).getByRole('button', { name: 'Configuration', exact: true }).click();
    await expect(sidebar).toHaveAttribute('data-overlay', 'true');
    await sidebarNav(page).getByRole('link', { name: 'Messaging', exact: true }).click();
    await expect(page).toHaveURL(`${base}/comms/configuration/messaging`);
    await expect(sidebar).not.toHaveAttribute('data-overlay', 'true');
    await noOverflow(page);
  });

  test('phone: Finance Configuration is a direct link in the menu sheet; Communications is a group', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/finance`);
    await page.locator('header').getByRole('button', { name: 'Menu', exact: true }).click();
    const sheet = page.locator('[data-slot="sidebar"][data-mobile="true"]');
    await sheet.getByRole('link', { name: 'Configuration', exact: true }).click();
    await expect(page).toHaveURL(`${base}/finance/configuration/pricing`);
    await noOverflow(page);
    await page.goto(`${base}/comms`);
    await page.locator('header').getByRole('button', { name: 'Menu', exact: true }).click();
    const heading = sheet.getByRole('button', { name: 'Configuration', exact: true });
    if ((await heading.getAttribute('aria-expanded')) !== 'true') await heading.click();
    await sheet.getByRole('link', { name: 'Numbers & assignments', exact: true }).click();
    await expect(page).toHaveURL(`${base}/comms/configuration/numbers`);
    await noOverflow(page);
  });
});

test.describe('a reduced-role colleague', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE, viewport: { width: 1440, height: 900 } });

  test('each old landing goes only to a page the colleague is offered, or is not found', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    for (const segment of LANDINGS) {
      await page.goto(`${base}/${segment}`);
      const offered = await sidebarNav(page).locator('a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href')!));
      const landed = await resolvesAway(page, base, segment);
      if (landed) expect(offered, segment).toContain(landed);
    }
  });
});
