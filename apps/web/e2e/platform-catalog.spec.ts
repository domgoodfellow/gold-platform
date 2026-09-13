import { test, expect } from '@playwright/test';
import { STAFF_STORAGE_STATE } from './helpers';

test.use({ storageState: STAFF_STORAGE_STATE });

/**
 * The Products catalogue used to edit a product through a `<details>` popover floating over the
 * data table row — no page, no breadcrumb, and (discovered while replacing it) a hidden runtime
 * bug: `actions.ts` exported a plain object from a `'use server'` file, which Next.js refuses to
 * build a client reference for, so the popover's save button 500'd the moment anyone actually
 * used it. This proves the real replacement: a real record page, reachable by a real link, whose
 * save button actually persists.
 */
test('opens a product from the list, edits it on its own page, and the edit persists', async ({
  page,
}) => {
  await page.goto('/platform/catalog/products');
  const row = page.getByRole('link', { name: 'Ask' });
  await expect(row).toBeVisible();

  await Promise.all([page.waitForURL(/\/platform\/catalog\/products\/.+/), row.click()]);
  await expect(page.getByRole('heading', { name: 'Ask', level: 1 })).toBeVisible();
  await expect(page.getByText('module:assistant')).toBeVisible();

  const description = `E2E — edited ${Date.now()}`;
  await page.getByLabel('Description').fill(description);
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByText('Updated.')).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.getByLabel('Description')).toHaveValue(description);
});
