import { expect, test } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';
test.use({ storageState: OWNER_STORAGE_STATE });
for (const width of [1440, 768, 390]) test(`canonical workspace configuration at ${width}px`, async ({ page }, info) => {
 test.setTimeout(90_000);
 await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
 const { organizationId } = loadDemoContext();
 const root = `/organizations/${organizationId}`;
 const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
 const screens = [
  ['comms/configuration/calling', 'Calling & routing'],
  ['comms/configuration/messaging', 'Messaging'],
  ['comms/configuration/email', 'Inbox email'],
  ['settings/email', 'Email sending'],
  ['comms/configuration/numbers', 'Numbers'],
  ['settings/general', 'General'],
  // Batch A: no workspace has a Configuration landing; each old address resolves to an eligible page.
  ['sales/configuration', 'Relationship stages'],
  ['comms/configuration', 'Calling & routing'],
  ['finance/configuration', 'Payments & currency'],
  ['support/configuration', 'Queues & assignment'],
  ['field/configuration', 'Work configuration'],
  ['sales/configuration/relationship-stages', 'Relationship stages'],
  ['sales/configuration/opportunity-stages', 'Opportunity stages'],
  ['sales/configuration/fields', 'Customer fields'],
  ['finance/configuration/pricing', 'Payments & currency'],
  ['support/configuration/queues', 'Queues & assignment'],
  ['support/configuration/service-levels', 'Service levels'],
  ['work/configuration', 'Work configuration'],
  ['schedule/configuration', 'Schedule configuration'],
  ['studio/configuration', 'Branding'],
 ] as const;
 for (const colorScheme of ['light', 'dark'] as const) {
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  for (const [path, title] of screens) {
   await page.goto(`${root}/${path}`);
   await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
   await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveCount(1);
   await expect(page.getByRole('navigation', { name: 'Configuration sections' })).toHaveCount(0);
   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
   await page.screenshot({ path: info.outputPath(`${path.replaceAll('/', '-')}-${colorScheme}.png`) });
  }
 }
 // The catalogue keeps Agent tools planned: configuration does not make it available.
 await page.goto(`${root}/ai/agents`);
 await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible();
 // Workspace-owned configuration omitted from the Settings directory is still searchable.
 await page.goto(`${root}/settings/general`);
 await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
 if (width < 768) await page.locator('header').getByRole('button', { name: 'Menu', exact: true }).click();
 await page.getByRole('searchbox', { name: 'Search settings' }).fill('Numbers');
 const numbers = page.getByRole('navigation', { name: 'Settings', exact: true }).getByRole('link', { name: 'Numbers & assignments' });
 await expect(numbers).toHaveAttribute('href', `${root}/comms/configuration/numbers`);
 await numbers.click(); await expect(page.getByRole('heading', { name: 'Numbers', exact: true })).toBeVisible();
 expect(errors).toEqual([]);
});


// Package 3A: CRM's Configuration is no longer a navigable parent. Its expand/collapse group, child
// routes, history and redirect are covered on a disposable business in e2e/crm-configuration.spec.ts.


test.describe('Configuration disclosure input methods', () => {
 for (const [name, width, touch] of [['desktop', 1440, false], ['phone touch', 390, true]] as const) {
  test.describe(name, () => {
   test.use({ hasTouch: touch, viewport: { width, height: width === 390 ? 844 : 1000 } });
   test(`Communications Configuration expands and collapses by pointer, Enter and Space (${name})`, async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/comms/configuration/calling`);
    if (width < 768) await page.locator('header').getByRole('button', { name: 'Menu', exact: true }).click();
    const nav = (width < 768 ? page.getByRole('dialog', { name: 'Sidebar', exact: true }) : page.locator('[data-slot="sidebar-container"]')).getByRole('navigation', { name: 'This business' });
    const child = nav.getByRole('link', { name: 'Calling & routing', exact: true });
    await expect(child).toBeVisible();
    await expect(child).toHaveAttribute('aria-current', 'page');
    // Batch A: the heading is one expand/collapse button, never a link to a landing.
    await expect(nav.getByRole('link', { name: 'Configuration', exact: true })).toHaveCount(0);
    const collapse = nav.getByRole('button', { name: 'Configuration', exact: true });
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    if (touch) {
     const box = await collapse.boundingBox();
     expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    if (touch) await collapse.tap(); else await collapse.click();
    await expect(child).toHaveCount(0);
    await collapse.focus(); await page.keyboard.press('Enter');
    await expect(child).toBeVisible();
    await collapse.focus(); await page.keyboard.press('Space');
    await expect(child).toHaveCount(0);
    await collapse.focus(); await page.keyboard.press('Space');
    await expect(child).toBeVisible();
    await expect(page).toHaveURL(`/organizations/${organizationId}/comms/configuration/calling`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
   });
  });
 }
});

// Batch A: the retired landings, the one-door Finance link and each Home's Configure menu are
// covered on a disposable business in e2e/workspace-configuration-cleanup.spec.ts.
