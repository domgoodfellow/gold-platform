import { expect, test } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from '../helpers';

/** Baseline: Organization Settings' own index. */
test.use({ storageState: OWNER_STORAGE_STATE });

test('Organization Settings', async ({ page }) => {
  const { organizationId } = loadDemoContext();
  await page.goto(`/organizations/${organizationId}/settings`);
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('settings.png', { fullPage: true });
});
