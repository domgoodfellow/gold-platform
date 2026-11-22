import { test, expect } from '@playwright/test';
import { financeUrl, OWNER_STORAGE_STATE, platformUrl, STAFF_STORAGE_STATE } from './helpers';

/**
 * The canonical Product -> Module -> Feature catalogue and Plans/Add-ons above it
 * (`20260918000001`). Catalogue and Plan data is global platform vocabulary, not per-tenant, so
 * these journeys need no demo fixture beyond the two signed-in sessions `global-setup.ts` already
 * provides. Navigates by URL rather than clicking through card grids — cards render as `<div>`s
 * (shadcn's `CardTitle`), not headings, and a local dev database can carry other Plans besides
 * GOLD Internal (e.g. from a test suite run against the same stack), so "click the Nth Open link"
 * is not a stable way to prove a route renders.
 */

test.describe('platform catalog', () => {
  test.use({ storageState: STAFF_STORAGE_STATE });

  test('shows the eight Gild Products on the landing page', async ({ page }) => {
    await page.goto(platformUrl('catalog'));
    await expect(page.getByRole('heading', { name: 'Products', level: 1 })).toBeVisible();
    for (const label of ['Gild Sales', 'Gild Service', 'Gild Comms', 'Gild Finance', 'Gild Agents', 'Gild Automations', 'Gild Field', 'Gild Studio']) {
      await expect(page.locator('main').getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test('opens the Communications Product detail and its Modules & Features tab', async ({ page }) => {
    await page.goto(platformUrl('catalog/families/comms'));
    await expect(page.getByRole('heading', { name: 'Gild Comms', level: 1 })).toBeVisible();

    await page.getByRole('tab', { name: 'Features' }).click();
    await expect(page.getByText('Voice', { exact: true }).first()).toBeVisible();
    // A planned Feature is visibly planned, never claimed as implemented.
    await expect(page.getByText('Planned').first()).toBeVisible();
  });

  test('opens GildOps Internal as a plan record in GildOps’ Catalog & Pricing, with what it switches on', async ({ page }) => {
    await page.goto(financeUrl('catalog'));
    await page.getByRole('link', { name: 'GildOps Internal', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'GildOps Internal', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What it switches on' })).toBeVisible();
    await page.getByRole('tab', { name: 'Allowances' }).click();
    await expect(page.getByText('AI tokens').first()).toBeVisible();
  });

  test('has no plan page in Administration and no Finance plans address', async ({ page }) => {
    for (const address of [platformUrl('catalog/plans'), platformUrl('plans'), financeUrl('plans'), '/platform/catalog/plans']) {
      await page.goto(address);
      await expect(page.getByRole('heading', { name: /^This page does not exist/ }), address).toBeVisible();
      await expect(page).toHaveURL(address);
    }
  });
});

test.describe('tenant plan & usage', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('renders the plan and the module terms bought before plans', async ({ page }) => {
    const { loadDemoContext } = await import('./helpers');
    const context = loadDemoContext();
    await page.goto(`/organizations/${context.organizationId}/settings/plan`);

    await expect(page.getByRole('heading', { name: 'Plan & usage', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What’s been bought' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Usage', exact: true })).toBeVisible();
  });
});
