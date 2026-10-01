import { expect, test } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from '../helpers';

/** Baseline: one record/detail page — the work item the demo seeds. */
test.use({ storageState: OWNER_STORAGE_STATE });

test('work item detail', async ({ page }) => {
  const { organizationId, workItemId } = loadDemoContext();
  await page.goto(`/organizations/${organizationId}/work/${workItemId}`);
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('work-item-detail.png', {
    fullPage: true,
    // The record's own timeline/activity entries carry real relative timestamps ("2 minutes
    // ago") that move between runs; masked rather than frozen, since freezing the clock would
    // hide a real regression in everything else on the page.
    mask: [page.locator('time')],
  });
});
