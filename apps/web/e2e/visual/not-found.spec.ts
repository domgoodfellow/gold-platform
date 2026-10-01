import { expect, test } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from '../helpers';

/**
 * Baseline: the authenticated 404/StatePage — a signed-in person inside their own organization's
 * shell, on an address that matches no page. The shell (sidebar, header) still renders; only the
 * content area says the address does not exist.
 */
test.use({ storageState: OWNER_STORAGE_STATE });

test('authenticated 404 inside the organization shell', async ({ page }) => {
  const { organizationId } = loadDemoContext();
  await page.goto(`/organizations/${organizationId}/this-address-does-not-exist`);
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('not-found.png', { fullPage: true });
});
