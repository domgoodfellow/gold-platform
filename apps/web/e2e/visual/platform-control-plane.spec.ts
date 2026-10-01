import { expect, test } from '@playwright/test';
import { loadDemoContext, STAFF_STORAGE_STATE } from '../helpers';

/** Baseline: one Platform control-plane page — the Overview staff lands on. */
test.use({ storageState: STAFF_STORAGE_STATE });

test('Platform overview', async ({ page }) => {
  const { goldOrganizationId } = loadDemoContext();
  await page.goto(`/organizations/${goldOrganizationId}/platform`);
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('platform-overview.png', { fullPage: true });
});
