import { test, expect } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

test('reaches /account through the account menu and sees identity and businesses', async ({
  page,
}) => {
  const ctx = loadDemoContext();

  await page.goto(`/organizations/${ctx.organizationId}/today`);

  // The sidebar footer's account button shows the signed-in email as its visible text.
  const accountTrigger = page.getByRole('button').filter({ hasText: ctx.ownerEmail });
  await expect(accountTrigger).toBeVisible();
  await accountTrigger.click();
  // Radix's DropdownMenuItem renders `role="menuitem"` even when it wraps a Link via `asChild`
  // — not `role="link"`, which is what the underlying `<a>` would suggest.
  await page.getByRole('menuitem', { name: 'Account' }).click();

  await expect(page).toHaveURL('/account');
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  await expect(page.getByText(ctx.ownerEmail)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Businesses' })).toBeVisible();
});
