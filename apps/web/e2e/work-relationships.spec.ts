import { test, expect } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

/**
 * Work Item is the busiest record and the one every other record's "related work" section
 * links back to — this proves the reverse direction actually works: from the job, out to the
 * customer it names, not just text claiming a relationship exists.
 */
test('opens a work item and follows its customer relationship to a real customer record', async ({
  page,
}) => {
  const ctx = loadDemoContext();

  await page.goto(`/organizations/${ctx.organizationId}/work/${ctx.workItemId}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // The job overview section's "Customer" row is the first relationship link on the page.
  const overview = page.getByRole('region', { name: 'Job overview' });
  const customerRow = overview.getByRole('link').first();
  await expect(customerRow).toBeVisible();
  await customerRow.click();

  await expect(page).toHaveURL(/\/crm\/contacts\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('shows the job\'s own documents and activity history', async ({ page }) => {
  const ctx = loadDemoContext();

  await page.goto(`/organizations/${ctx.organizationId}/work/${ctx.workItemId}`);
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'e2e-job-photo.txt' })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  // The event-attribution fix (20260917000001): a document attached to this job appears in
  // its own history, not only in the Documents section's file list.
  await expect(page.getByText('Document attached: e2e-job-photo.txt')).toBeVisible();
});
