import { test, expect } from '@playwright/test';
import { financeUrl, loadDemoContext, OWNER_STORAGE_STATE, platformUrl, STAFF_STORAGE_STATE } from './helpers';

/**
 * Finance is tenant Financial Operations: the business's own prices, quotes, invoices and payments
 * with its own customers. What a business buys from GildOps is Settings → Plan & usage, and
 * GildOps' commercial control plane (Plans & Add-ons) is Platform. These journeys drive the real
 * app on `pnpm demo` data and save a screenshot of each state for a person to look at.
 */

const ARTIFACTS = '../../.artifacts/finance';

test.describe('tenant Finance workspace', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('Home is about this business’s own money, and reaches Quotes, Invoices and Payments from the sidebar', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}/finance`;
    await page.goto(`/organizations/${organizationId}/home`);
    await page.getByRole('link', { name: 'Finance', exact: true }).click();
    await expect(page).toHaveURL(base);
    await expect(page.getByRole('heading', { name: 'Finance', level: 1 })).toBeVisible();

    // The commercial plane is not here.
    for (const text of ['Plan & usage', 'Usage allowances', 'Manage plan', 'Financial connections', 'Known COGS']) {
      await expect(page.locator('main').getByText(text, { exact: false })).toHaveCount(0);
    }
    await expect(page.locator('main').getByRole('link', { name: 'Plans & Add-ons' })).toHaveCount(0);
    await page.screenshot({ path: `${ARTIFACTS}/finance-workspace-home-desktop.png`, fullPage: true });

    for (const [label, path] of [['Quotes', 'quotes'], ['Invoices', 'invoices'], ['Payments', 'payments']] as const) {
      await page.getByRole('link', { name: label, exact: true }).first().click();
      await expect(page).toHaveURL(`${base}/${path}`);
      await expect(page.getByRole('heading', { name: label, level: 1 })).toBeVisible();
      await page.screenshot({ path: `${ARTIFACTS}/finance-workspace-${path}-desktop.png`, fullPage: true });
    }
  });

  test('the Finance row opens Home, and Pricing is configured from Settings rather than duplicated', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/finance/invoices`);
    await page.getByRole('link', { name: 'Finance', exact: true }).first().click();
    await expect(page).toHaveURL(`/organizations/${organizationId}/finance`);

    // Pricing is configured from Settings; Finance reaches it through its Configure menu.
    await page.getByRole('button', { name: 'Configure' }).click();
    await page.getByRole('menuitem', { name: 'Services & pricing' }).click();
    await expect(page).toHaveURL(`/organizations/${organizationId}/finance/configuration/pricing`);
    await expect(page.getByRole('heading', { name: /Pricing/, level: 1 })).toBeVisible();
  });

  test('Plan & usage stays outside Finance, under Settings', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/settings/plan`);
    await expect(page.getByRole('heading', { name: 'Plan & usage', level: 1 })).toBeVisible();
  });

  test('an empty collection says what it is waiting for, and the page stays usable at 320px', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.setViewportSize({ width: 320, height: 800 });
    for (const path of ['', '/quotes', '/invoices', '/payments']) {
      await page.goto(`/organizations/${organizationId}/finance${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path || 'home'} scrolls sideways`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${ARTIFACTS}/finance-workspace-${path.slice(1) || 'home'}-narrow.png`, fullPage: true });
    }
  });
});

test.describe('GildOps staff', () => {
  test.use({ storageState: STAFF_STORAGE_STATE });

  test('GildOps’ own Finance is ordinary tenant Finance, with no commercial controls', async ({ page }) => {
    await page.goto(financeUrl());
    await expect(page.getByRole('heading', { name: 'Finance', level: 1 })).toBeVisible();
    await expect(page.locator('main').getByRole('link', { name: 'Plans & Add-ons' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Economics' })).toHaveCount(0);
    await page.screenshot({ path: `${ARTIFACTS}/finance-workspace-gildops-home.png`, fullPage: true });
  });

  test('Plans & Add-ons is reached in Platform under Commercial, and the old Finance address redirects', async ({ page }) => {
    await page.goto(platformUrl('plans'));
    await expect(page.getByRole('heading', { name: 'Plans & Add-ons', level: 1 })).toBeVisible();
    await page.screenshot({ path: `${ARTIFACTS}/platform-plans-desktop.png`, fullPage: true });

    await page.goto(financeUrl('plans'));
    await expect(page).toHaveURL(platformUrl('plans'));
    await page.goto(financeUrl('economics'));
    await expect(page).toHaveURL(platformUrl('economics'));
    await expect(page.getByRole('heading', { name: 'Portfolio economics', level: 1 })).toBeVisible();
  });
});
