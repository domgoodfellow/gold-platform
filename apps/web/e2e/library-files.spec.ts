import { test, expect } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

/**
 * The Library's Files collection, driven through the browser. The journeys are the ones a person
 * takes: add a file, find it, open it, and see that the page still fits a phone.
 */

test('adds a file to the Library, finds it, and opens its details without leaving the list', async ({ page }) => {
  const ctx = loadDemoContext();
  const base = `/organizations/${ctx.organizationId}/library/files`;

  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible();

  const fileName = `library-${Date.now()}.txt`;
  await page.setInputFiles('input[type="file"]', {
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from('a file the whole business can use'),
  });
  await page.getByRole('button', { name: 'Add to Library' }).click();

  const row = page.getByRole('link', { name: fileName });
  await expect(row).toBeVisible({ timeout: 10_000 });

  // Searching by part of the name narrows the list and writes the search into the address.
  await page.getByRole('searchbox', { name: 'Search' }).fill(fileName.slice(0, 12));
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect(page).toHaveURL(/q=library-/);
  await expect(row).toBeVisible();

  await row.click();
  await expect(page).toHaveURL(/file=[0-9a-f-]{36}/);
  const detail = page.getByRole('complementary', { name: 'Selected file' });
  await expect(detail.getByRole('heading', { name: fileName })).toBeVisible();
  await expect(detail.getByText('Not used by any record yet.')).toBeVisible();
  await expect(detail.getByRole('link', { name: 'Download' })).toBeVisible();
  await expect(row).toHaveAttribute('aria-current', 'true');
});

test('a filter that matches nothing says so, and Reset returns the full list', async ({ page }) => {
  const ctx = loadDemoContext();
  const base = `/organizations/${ctx.organizationId}/library/files`;

  await page.goto(`${base}?q=no-such-file-anywhere`);
  await expect(page.getByText('No files match these filters.')).toBeVisible();

  await page.getByRole('link', { name: 'Reset' }).click();
  await expect(page).toHaveURL(base);
  await expect(page.getByText('No files match these filters.')).toHaveCount(0);
});

test('the Files page fits a phone without sideways scrolling', async ({ page }) => {
  const ctx = loadDemoContext();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/organizations/${ctx.organizationId}/library/files`);
  await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
