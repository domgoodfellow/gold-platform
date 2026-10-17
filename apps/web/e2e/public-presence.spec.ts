import { test, expect } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

/**
 * The Phase 5 fix under proof: Settings offers a real Preview link once the booking page would
 * actually resolve, and the page it opens is the real, public, unauthenticated booking surface —
 * not a stand-in.
 */
test('opens the public booking preview from Settings and finds the real public page', async ({
  page,
  context,
}) => {
  const ctx = loadDemoContext();

  await page.goto(`/organizations/${ctx.organizationId}/settings/domains#booking-address`);
  const preview = page.getByRole('link', { name: new RegExp(`Preview.*${ctx.bookingSlug}`) });
  await expect(preview).toBeVisible();

  // Opens in a new tab (target="_blank") — followed here directly rather than clicked, so the
  // test does not depend on this browser's popup-handling timing.
  const href = await preview.getAttribute('href');
  expect(href).toBe(`/book/${ctx.bookingSlug}`);

  // A fresh, signed-out context: this is the public page, and I18n/the tenant-isolation rule both say it must not
  // need the operator's own session to resolve.
  const anonymousPage = await context.browser()!.newContext().then((c) => c.newPage());
  await anonymousPage.goto(href!);
  await expect(anonymousPage.getByRole('heading', { level: 1 })).toBeVisible();
  await anonymousPage.close();
});
