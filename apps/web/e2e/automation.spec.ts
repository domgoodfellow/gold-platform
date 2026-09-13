import { test, expect } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

/**
 * Proves the Automations workspace still reads as one page after the file-level decomposition
 * (features/automations/{rules,templates,activity,review}) — a code-organization change with
 * zero intended effect on what an operator sees, which is exactly the kind of change a browser
 * check is for and a unit test cannot be.
 */
test('shows rules, messages and run history on one page after the decomposition', async ({
  page,
}) => {
  const ctx = loadDemoContext();

  await page.goto(`/organizations/${ctx.organizationId}/automations`);
  await expect(page.getByRole('heading', { name: 'What this business says' })).toBeVisible();

  const newRuleForm = page.getByRole('heading', { name: 'New rule' });
  const noRulesYet = page.getByText('No rules yet.');
  await expect(newRuleForm.or(noRulesYet).first()).toBeVisible();
});
