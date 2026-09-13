import { test, expect } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

/**
 * The durable contract: a route existing is not enough, so this proves the actual journey —
 * list row to record, with the sections that route composes actually present.
 */
test('opens the asset list, follows a row to its record, and finds readings and documents', async ({
  page,
}) => {
  const ctx = loadDemoContext();

  await page.goto(`/organizations/${ctx.organizationId}/assets`);
  const row = page.getByRole('link', { name: 'E2E Test Compressor' });
  await expect(row).toBeVisible();
  await row.click();

  await expect(page).toHaveURL(new RegExp(`/assets/${ctx.assetId}$`));
  await expect(page.getByRole('heading', { name: 'E2E Test Compressor', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Readings' })).toBeVisible();
  await expect(page.getByText('42', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();

  // The reading itself stays a dedicated log, not folded into History — this asset's creation
  // is what proves the timeline reader is actually wired to the route rather than merely present
  // in the domain layer.
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(page.getByText('Asset created')).toBeVisible();
});

test('opens the location list and follows a row to its record', async ({ page }) => {
  const ctx = loadDemoContext();

  await page.goto(`/organizations/${ctx.organizationId}/locations`);
  const firstRowLink = page.getByRole('table').getByRole('link').first();
  await expect(firstRowLink).toBeVisible();
  const label = await firstRowLink.textContent();
  await firstRowLink.click();

  await expect(page).toHaveURL(new RegExp(`/locations/[0-9a-f-]+$`));
  if (label) {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(label.trim());
  }
  await expect(page.getByRole('heading', { name: 'Coordinates' })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(page.getByText('Location created')).toBeVisible();
});

test('opens the resource list and follows a row to its record', async ({ page }) => {
  const ctx = loadDemoContext();

  await page.goto(`/organizations/${ctx.organizationId}/resources`);
  const firstRowLink = page.getByRole('table').getByRole('link').first();
  await expect(firstRowLink).toBeVisible();
  await firstRowLink.click();

  await expect(page).toHaveURL(new RegExp(`/resources/[0-9a-f-]+$`));
  await expect(page.getByRole('heading', { name: 'Work' })).toBeVisible();
});
