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
  ['comms/configuration/email', 'Email'],
  ['comms/configuration/numbers', 'Numbers'],
  ['settings/general', 'General'],
  ['sales/configuration', 'Configuration'],
  ['sales/configuration/relationship-stages', 'Relationship stages'],
  ['sales/configuration/opportunity-stages', 'Opportunity stages'],
  ['sales/configuration/fields', 'Customer fields'],
  ['finance/configuration/pricing', 'Services & Pricing'],
  ['support/configuration/queues', 'Queues & assignment'],
  ['support/configuration/service-levels', 'Service levels'],
  ['work/configuration', 'Work configuration'],
  ['schedule/configuration', 'Schedule configuration'],
  ['studio/configuration', 'Configuration'],
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


test('CRM Configuration is a navigable disclosure with canonical child routes and browser history', async ({ page }) => {
 const { organizationId } = loadDemoContext();
 const root = `/organizations/${organizationId}/sales/configuration`;
 await page.goto(root);
 await expect(page).toHaveURL(root);
 const nav = page.locator('[data-slot="sidebar-container"]').getByRole('navigation', { name: 'This business' });
 const parent = nav.getByRole('link', { name: 'Configuration', exact: true });
 await expect(parent).toHaveAttribute('aria-current', 'page');
 await nav.getByRole('button', { name: 'Collapse Configuration' }).click();
 await expect(nav.getByRole('link', { name: 'Customer fields' })).toHaveCount(0);
 await nav.getByRole('button', { name: 'Expand Configuration' }).press('Enter');
 for (const [name, segment] of [['Relationship stages', 'relationship-stages'], ['Opportunity stages', 'opportunity-stages'], ['Customer fields', 'fields']]) {
  const link = nav.getByRole('link', { name, exact: true });
  await link.click();
  await expect(page).toHaveURL(`${root}/${segment}`);
  await expect(link).toHaveAttribute('aria-current', 'page');
  await expect(parent).not.toHaveAttribute('aria-current');
  await expect(page.getByRole('navigation', { name: 'Configuration sections' })).toHaveCount(0);
  await page.reload();
  await expect(link).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page).toHaveURL(root);
 }
});


test.describe('Configuration disclosure input methods', () => {
 for (const [name, width, touch] of [['desktop', 1440, false], ['phone touch', 390, true]] as const) {
  test.describe(name, () => {
   test.use({ hasTouch: touch, viewport: { width, height: width === 390 ? 844 : 1000 } });
   test(`Finance Configuration expands and collapses by pointer, Enter and Space (${name})`, async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/finance/configuration/pricing`);
    if (width < 768) await page.locator('header').getByRole('button', { name: 'Menu', exact: true }).click();
    const nav = (width < 768 ? page.getByRole('dialog', { name: 'Sidebar', exact: true }) : page.locator('[data-slot="sidebar-container"]')).getByRole('navigation', { name: 'This business' });
    const child = nav.getByRole('link', { name: 'Services & pricing', exact: true });
    await expect(child).toBeVisible();
    await expect(child).toHaveAttribute('aria-current', 'page');
    const collapse = nav.getByRole('button', { name: 'Collapse Configuration' });
    if (touch) {
     const box = await collapse.boundingBox();
     expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    if (touch) await collapse.tap(); else await collapse.click();
    await expect(child).toHaveCount(0);
    const expand = nav.getByRole('button', { name: 'Expand Configuration' });
    await expand.focus(); await page.keyboard.press('Enter');
    await expect(child).toBeVisible();
    await nav.getByRole('button', { name: 'Collapse Configuration' }).focus(); await page.keyboard.press('Space');
    await expect(child).toHaveCount(0);
    await nav.getByRole('button', { name: 'Expand Configuration' }).focus(); await page.keyboard.press('Space');
    await expect(child).toBeVisible();
    await expect(page).toHaveURL(`/organizations/${organizationId}/finance/configuration/pricing`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
   });
  });
 }
});

test.describe('Configuration landing', () => {
 test.use({ storageState: OWNER_STORAGE_STATE });
 test('a workspace with several destinations opens an overview of its own destinations, and the chevron does not navigate', async ({ page }) => {
  const { organizationId } = loadDemoContext();
  const root = `/organizations/${organizationId}`;
  await page.goto(`${root}/finance/configuration`);
  await expect(page).toHaveURL(`${root}/finance/configuration`);
  await expect(page.getByRole('heading', { level: 1, name: 'Configuration', exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Services & pricing' })).toHaveAttribute('href', `${root}/finance/configuration/pricing`);
  await expect(page.getByRole('main').getByRole('link', { name: 'Payment collection' })).toBeVisible();
  await expect(page.getByRole('main').getByText(/Branding|Website/)).toHaveCount(0);
  const nav = page.locator('[data-slot="sidebar-container"]').getByRole('navigation', { name: 'This business' });
  await nav.getByRole('button', { name: 'Collapse Configuration' }).click();
  await expect(page).toHaveURL(`${root}/finance/configuration`);
  await nav.getByRole('button', { name: 'Expand Configuration' }).click();
  await nav.getByRole('link', { name: 'Payment collection', exact: true }).click();
  await expect(page).toHaveURL(`${root}/finance/configuration/pricing#getting-paid`);
  await page.goBack();
  await expect(page).toHaveURL(`${root}/finance/configuration`);
 });
});
