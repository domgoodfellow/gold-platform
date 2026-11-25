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

  // Upload is the header's action: a focused dialog, closed with a toast once the file is stored.
  const fileName = `library-${Date.now()}.txt`;
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload a file' });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from('a file the whole business can use'),
  });
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText(`Uploaded ${fileName}`)).toBeVisible();

  const row = page.getByRole('link', { name: fileName });
  await expect(row).toBeVisible({ timeout: 10_000 });

  // Searching by part of the name narrows the list and writes the search into the address.
  await page.getByRole('searchbox', { name: 'Search files' }).fill(fileName.slice(0, 12));
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
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

  // Runs after the upload above: an empty Library shows its empty state instead of the collection controls.
  await page.goto(`${base}?q=no-such-file-anywhere`);
  await expect(page.getByText('No files match these filters.')).toBeVisible();

  await page.getByRole('link', { name: 'Reset', exact: true }).click();
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
