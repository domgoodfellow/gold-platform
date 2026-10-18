import { expect, test } from '@playwright/test';
import { STAFF_STORAGE_STATE } from '../helpers';

/** Baseline: one Platform control-plane page — the Overview staff lands on. */
test.use({ storageState: STAFF_STORAGE_STATE });

test('Platform overview', async ({ page }) => {
  await page.goto(`/platform`);
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('platform-overview.png', { fullPage: true });
});
