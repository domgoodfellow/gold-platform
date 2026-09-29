import { test, expect } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

test('reaches Account through the one Settings entry, and its tab bar can return to the business', async ({
  page,
}) => {
  const ctx = loadDemoContext();

  await page.goto(`/organizations/${ctx.organizationId}/home`);

  // The sidebar footer's account button shows the signed-in email as its visible text.
  const accountTrigger = page.getByRole('button').filter({ hasText: ctx.ownerEmail });
  await expect(accountTrigger).toBeVisible();
  await accountTrigger.click();
  // Radix's DropdownMenuItem renders `role="menuitem"` even when it wraps a Link via `asChild`
  // — not `role="link"`, which is what the underlying `<a>` would suggest. There is one Settings
  // entry now (D71); it lands on Organization when a business is offered, so reach Account from
  // the shared tab bar instead.
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Account' }).click();

  await expect(page).toHaveURL(`/settings/account?org=${ctx.organizationId}`);
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expect(page.getByText(ctx.ownerEmail).first()).toBeVisible();

  // The retired address lands here rather than on a second surface.
  await page.goto('/account');
  await expect(page).toHaveURL('/settings/account');

  // The Organization tab is the way back into the business's own Settings.
  await page.goto(`/settings/account?org=${ctx.organizationId}`);
  await page.getByRole('link', { name: 'Organization' }).click();
  await expect(page).toHaveURL(`/organizations/${ctx.organizationId}/settings`);
});
