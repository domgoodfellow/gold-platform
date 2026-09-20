import { test, expect } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

test('reaches Personal settings through the account menu and can return to the business', async ({
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
  await page.getByRole('menuitem', { name: 'Personal settings' }).click();

  await expect(page).toHaveURL(`/settings/account?org=${ctx.organizationId}`);
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expect(page.getByText(ctx.ownerEmail).first()).toBeVisible();

  // The retired address lands here rather than on a second surface.
  await page.goto('/account');
  await expect(page).toHaveURL('/settings/account');

  await page.goto(`/settings/account?org=${ctx.organizationId}`);
  await page.getByRole('link', { name: /^Back to/ }).click();
  await expect(page).toHaveURL(new RegExp(`/organizations/${ctx.organizationId}/`));
});
