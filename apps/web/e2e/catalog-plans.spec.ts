import { test, expect } from '@playwright/test';
import { OWNER_STORAGE_STATE, platformUrl, STAFF_STORAGE_STATE } from './helpers';

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

    await page.getByRole('tab', { name: 'Modules & Features' }).click();
    await expect(page.getByText('Voice', { exact: true }).first()).toBeVisible();
    // A planned Feature is visibly planned, never claimed as implemented.
    await expect(page.getByText('Planned').first()).toBeVisible();
  });

  test('shows GildOps Internal in Plans & Add-ons, non-billable, with entitlements and quotas', async ({ page }) => {
    await page.goto(platformUrl('catalog/plans'));
    await expect(page.getByRole('heading', { name: 'Plans & Add-ons', level: 1 })).toBeVisible();
    await expect(page.getByText('GildOps Internal').first()).toBeVisible();

    await page.goto(platformUrl('catalog/plans/gold_internal'));
    await expect(page.getByRole('heading', { name: 'GildOps Internal', level: 1 })).toBeVisible();
    await expect(page.getByText('Non-billable').first()).toBeVisible();

    await page.getByRole('tab', { name: 'Quotas' }).click();
    await expect(page.getByText('AI tokens')).toBeVisible();

    await page.getByRole('tab', { name: 'Organizations' }).click();
    await expect(page.getByRole('tab', { name: 'Organizations', selected: true })).toBeVisible();
  });
});

test.describe('tenant plan & usage', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('renders with no Plan assigned, and still shows legacy module state', async ({ page }) => {
    const { loadDemoContext } = await import('./helpers');
    const context = loadDemoContext();
    await page.goto(`/organizations/${context.organizationId}/settings/plan`);

    await expect(page.getByRole('heading', { name: 'Plan & usage', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your Plan' })).toBeVisible();
    await expect(page.getByText('This organization does not currently have a standard Plan')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Available Features' })).toBeVisible();
  });
});
