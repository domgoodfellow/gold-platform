import { test, expect } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

/**
 * Upload through the real form, not the domain layer directly — this is the one journey in the
 * suite that proves the browser control itself works, not just that the data it would produce
 * is correct.
 */
test('uploads a document to a customer, sees it listed, and sees it in that customer\'s history', async ({
  page,
}) => {
  const ctx = loadDemoContext();

  await page.goto(`/organizations/${ctx.organizationId}/customers/${ctx.customerId}`);
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();

  const fileName = `e2e-upload-${Date.now()}.txt`;
  await page.setInputFiles('input[type="file"]', {
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from('a document a browser actually uploaded'),
  });
  await page.getByRole('button', { name: 'Attach document' }).click();

  await expect(page.getByRole('link', { name: fileName })).toBeVisible({ timeout: 10_000 });

  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(page.getByText(`Document attached: ${fileName}`)).toBeVisible();
});

test('uploads a document to a location, and sees it in that location\'s own history', async ({
  page,
}) => {
  const ctx = loadDemoContext();

  await page.goto(`/organizations/${ctx.organizationId}/locations/${ctx.locationId}`);
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();

  const fileName = `e2e-location-upload-${Date.now()}.txt`;
  await page.setInputFiles('input[type="file"]', {
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from('a document attached to a place'),
  });
  await page.getByRole('button', { name: 'Attach document' }).click();

  await expect(page.getByRole('link', { name: fileName })).toBeVisible({ timeout: 10_000 });

  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(page.getByText(`Document attached: ${fileName}`)).toBeVisible();
});

test('uploads a document to an asset, and sees it in that asset\'s own history', async ({
  page,
}) => {
  const ctx = loadDemoContext();

  await page.goto(`/organizations/${ctx.organizationId}/assets/${ctx.assetId}`);
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();

  const fileName = `e2e-asset-upload-${Date.now()}.txt`;
  await page.setInputFiles('input[type="file"]', {
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from('a document attached to a machine'),
  });
  await page.getByRole('button', { name: 'Attach document' }).click();

  await expect(page.getByRole('link', { name: fileName })).toBeVisible({ timeout: 10_000 });

  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(page.getByText(`Document attached: ${fileName}`)).toBeVisible();
});
