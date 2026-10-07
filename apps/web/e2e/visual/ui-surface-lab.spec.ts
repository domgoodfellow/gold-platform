import { expect, test } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from '../helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

test('UI surface lab', async ({ page }) => {
  const { organizationId } = loadDemoContext();
  await page.goto(`/organizations/${organizationId}/ui-lab`);
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('ui-surface-lab.png', { fullPage: true });
});
