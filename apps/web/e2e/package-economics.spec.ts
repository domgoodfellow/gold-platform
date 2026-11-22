import { expect, test } from '@playwright/test';
import { financeUrl, STAFF_STORAGE_STATE } from './helpers';
import { chooseOption, selectFieldValue } from './select-field';

test.describe('package economics', () => {
  test.use({ storageState: STAFF_STORAGE_STATE });

  test('keeps Plan, draft scenario, and agreement simulation sources visibly distinct', async ({ page }) => {
    await page.goto(financeUrl('economics/packages'));
    await expect(page.getByRole('heading', { name: 'Economics', level: 1 })).toBeVisible();
    await expect(selectFieldValue(page.getByLabel('Source', { exact: true }))).toHaveValue('plan_default');
    await expect(page.getByRole('heading', { name: 'Economics', exact: true }).nth(1)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Meter economics' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Candidate comparison' })).toBeVisible();
    await expect(page.getByText('Max-allowance COGS')).toBeVisible();

    await page.getByRole('button', { name: 'New draft scenario' }).click();
    await page.getByLabel('Name').fill(`Reference customer ${Date.now()}`);
    await page.getByLabel('Candidate monthly prices').fill('499, 699, 899, 999');
    await page.getByRole('button', { name: 'Save scenario' }).click();
    await expect(page.getByText('Scenario saved.')).toBeVisible();
    await page.keyboard.press('Escape');

    await chooseOption(page.getByLabel('Source', { exact: true }), 'draft_scenario');
    await expect(page.getByText('Draft scenario · planning only · not an agreed price')).toBeVisible();
    for (const amount of ['$499.00', '$699.00', '$899.00', '$999.00']) {
      await expect(page.getByRole('button', { name: amount }).first()).toBeVisible();
    }
    await page.getByRole('button', { name: 'Heavy' }).click();
    await expect(page.getByText('Scenario usage').nth(1)).toBeVisible();
  });
});
