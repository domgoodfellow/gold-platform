import { expect, test } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from '../helpers';

/**
 * Baseline: a workspace Home — CRM's, reached at its canonical address (`WORKSPACES[].home`).
 * Spacing, alignment, density and how the page behaves at phone width are what this catches; a
 * business rule is never asserted here (`docs/testing.md`'s visual-verification boundary).
 */
test.use({ storageState: OWNER_STORAGE_STATE });

test('CRM workspace home', async ({ page }) => {
  const { organizationId } = loadDemoContext();
  await page.goto(`/organizations/${organizationId}/sales`);
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('crm-home.png', { fullPage: true });
});
