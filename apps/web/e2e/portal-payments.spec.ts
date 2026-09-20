import { test, expect } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

/**
 * The customer financial loop, through a real browser as far as this deployment can prove it.
 *
 * **What this cannot exercise, and why.** `.env.test` carries no `STRIPE_SECRET_KEY` — this
 * repository has no fake/test payment-provider adapter, and the instructions this slice shipped
 * under are explicit: no real processor calls from an automated suite. So a customer clicking
 * Pay and landing on an actual checkout page is not something this file can show; what it proves
 * instead is the two things that matter most about an *unconfigured* deployment — the invoice
 * section is genuinely reachable, and no button pretends a payment can be started when nothing
 * behind it exists (I12: hiding it is the courtesy, and `tests/integration/database/portal-payments.test.ts` already
 * proves the RPC-level guard independently of what the page renders).
 */

test.use({ storageState: OWNER_STORAGE_STATE });

test('shows the customer record\'s own invoices', async ({ page }) => {
  const ctx = loadDemoContext();
  await page.goto(`/organizations/${ctx.organizationId}/customers/${ctx.customerId}`);
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
});

test('a customer opening their portal link sees their invoices, with no live Pay action while no processor is configured', async ({
  page,
  browser,
}) => {
  const ctx = loadDemoContext();
  await page.goto(`/organizations/${ctx.organizationId}/customers/${ctx.customerId}`);

  await page.getByRole('button', { name: 'Make a portal link' }).click();
  const createdLink = page.getByLabel('Send this to the customer. Anyone holding it is them.');
  await expect(createdLink).toBeVisible();
  const link = await createdLink.inputValue();
  expect(link).toContain('/portal/');

  // A fresh, unauthenticated context — a customer opening the link in a private window, not the
  // operator's own signed-in session (which would bind the wrong account to this business).
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(link);

  await expect(guestPage.getByRole('heading', { name: 'Your invoices' })).toBeVisible();
  // No processor configured anywhere in this stack — portalCardPaymentAvailable returns null
  // for every invoice, so no "Pay …" control should exist on the page at all.
  await expect(guestPage.getByRole('button', { name: /^Pay / })).toHaveCount(0);

  await guest.close();
});
