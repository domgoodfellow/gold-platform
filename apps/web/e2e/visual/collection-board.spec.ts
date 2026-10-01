import { expect, test } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from '../helpers';

/** Baseline: the CRM pipeline board — this repo's one collection-board pattern today. */
test.use({ storageState: OWNER_STORAGE_STATE });

test('CRM pipeline board', async ({ page }) => {
  const { organizationId } = loadDemoContext();
  await page.goto(`/organizations/${organizationId}/customers/pipeline`);
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('pipeline-board.png', { fullPage: true });
});
