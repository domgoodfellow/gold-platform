import './appearance-env';
import { test, expect, type Page } from '@playwright/test';
import { COLLEAGUE_STORAGE_STATE, loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

/**
 * Batch B, in a real browser: surfaces that were disproportionate to their task, replaced. A campaign
 * status change and Add member are dialogs; Home's Customize is a popover; a form's sharing is a
 * section of its page; price items are edited in their rows. Each keeps its command, refusal,
 * permission and keyboard behavior. Invitations go to `example.test` addresses and the local server
 * has no email provider, so nothing is delivered. Runs against one disposable business
 * (`playwright.isolated.config.ts`).
 */

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
const drawers = (page: Page) => page.locator('[data-drawer-body]');

test.describe('an owner', () => {
  test.use({ storageState: OWNER_STORAGE_STATE, viewport: { width: 1440, height: 900 } });

  test('a campaign status change is confirmed in a dialog, cancellable, and returns focus', async ({ page }) => {
    const base = `/organizations/${loadDemoContext().organizationId}`;
    await page.goto(`${base}/marketing`);
    await page.getByRole('button', { name: '+ New campaign', exact: true }).click();
    await page.getByLabel('Campaign name', { exact: true }).fill(`Dialog campaign ${Date.now()}`);
    await page.getByRole('button', { name: 'Create draft', exact: true }).click();
    await expect(page).toHaveURL(/marketing\/campaigns\/[\w-]+/);
    const activate = page.getByRole('button', { name: 'Activate', exact: true });
    await activate.click();
    const dialog = page.getByRole('dialog', { name: 'Activate campaign?' });
    await expect(dialog).toBeVisible();
    await expect(drawers(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(activate).toBeFocused();
    await activate.click();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(activate).toBeFocused();
    await activate.click();
    await dialog.getByRole('button', { name: 'Activate', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  });

  test('Add member is a dialog: invite, truthful delivery result, copy link, pending invitation', async ({ page }) => {
    const base = `/organizations/${loadDemoContext().organizationId}`;
    const email = `surface-${Date.now()}@example.test`;
    await page.goto(`${base}/settings/access/members`);
    const trigger = page.getByRole('button', { name: 'Add member' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Add member' });
    await expect(dialog.getByRole('tab', { name: 'Invite by email', selected: true })).toBeVisible();
    await expect(drawers(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByLabel('Email address').fill('not-an-address');
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(dialog.getByLabel('Email address')).toHaveJSProperty('validity.valid', false);
    await dialog.getByLabel('Email address').fill(email);
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    // No provider is configured locally, so the result must say the email did not go and offer the link.
    await expect(dialog.getByText(/Invitation created, but it was not emailed/)).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: /Invitation link/ })).toHaveValue(/accept-invite\/[0-9a-f]{64}/);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await page.goto(`${base}/settings/access/invitations`);
    await expect(page.getByRole('row').filter({ hasText: email })).toBeVisible();
  });

  test('Home Customize is a popover that applies at once', async ({ page }) => {
    await page.goto(`/organizations/${loadDemoContext().organizationId}/home`);
    const trigger = page.getByRole('button', { name: 'Customize' });
    await trigger.click();
    const popover = page.getByRole('dialog', { name: 'Customize Home' });
    await expect(popover).toHaveAttribute('data-slot', 'popover-content');
    await expect(drawers(page)).toHaveCount(0);
    const activity = popover.getByRole('checkbox', { name: 'Recent activity' });
    await activity.uncheck();
    await expect(page.getByRole('region', { name: 'Recent activity' })).toHaveCount(0);
    await activity.check();
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('a form shares from a section of its own page, with no Distribute drawer', async ({ page }) => {
    const base = `/organizations/${loadDemoContext().organizationId}`;
    await page.goto(`${base}/studio/forms`);
    await page.getByRole('button', { name: 'New form', exact: true }).first().click();
    await page.getByLabel('Form name').fill(`Sharing form ${Date.now()}`);
    await page.getByRole('button', { name: 'Create form' }).click();
    await expect(page).toHaveURL(/studio\/forms\/[\w-]+$/);
    await expect(page.getByRole('button', { name: 'Distribute' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Sharing', exact: true }).click();
    const sharing = page.getByRole('region', { name: 'Sharing' });
    await expect(sharing).toBeInViewport();
    await expect(sharing.getByText(/Publish this form to share it/)).toBeVisible();
    await expect(sharing.getByRole('region', { name: 'Used by' })).toContainText('Nowhere yet.');
    await sharing.getByRole('button', { name: 'Add to portal' }).click();
    await expect(sharing.getByRole('button', { name: 'Remove from portal' }).or(sharing.getByRole('alert'))).toBeVisible();
  });

  test('price items are added and edited in their rows, with refusal, Escape and focus', async ({ page }) => {
    const base = `/organizations/${loadDemoContext().organizationId}`;
    await page.goto(`${base}/finance/configuration/pricing`);
    const book = page.getByRole('region', { name: /Price book/ });
    const name = `Surface item ${Date.now()}`;
    const add = book.getByRole('button', { name: 'Add price item' });
    await add.click();
    await expect(drawers(page)).toHaveCount(0);
    let row = page.getByRole('form', { name: 'Add price item' });
    await expect(row.getByLabel('Name of new price item')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(row).toHaveCount(0);
    await expect(add).toBeFocused();
    await add.click();
    await row.getByLabel('Name of new price item').fill(name);
    await row.getByLabel('Unit of new price item').fill('visit');
    await row.getByLabel(/^Amount in [A-Z]{3} for new price item$/).fill('12.50');
    await row.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(book.getByText(name, { exact: true })).toBeVisible();

    // A duplicate name is refused by the domain; the row keeps what was typed and focuses the reason.
    const existing = (await book.getByRole('button', { name: /^Edit / }).first().getAttribute('aria-label'))!.replace(/^Edit /, '');
    await book.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
    row = page.getByRole('form', { name: `Edit ${name}` });
    await expect(book.getByRole('button', { name: 'Add price item' })).toBeDisabled();
    await row.getByLabel(`Name of ${name}`).fill(existing);
    await row.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(row.getByRole('alert')).toContainText('You already price something called');
    await expect(row.getByRole('alert')).toBeFocused();
    await expect(row.getByLabel(`Name of ${name}`)).toHaveValue(existing);
    await row.getByLabel(`Name of ${name}`).fill(`${name} revised`);
    await row.getByLabel(/^Amount in [A-Z]{3} for /).fill('13.00');
    await row.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(book.getByText(`${name} revised`, { exact: true })).toBeVisible();
  });

  test('Studio Configure names its Organization Settings pages as such', async ({ page }) => {
    await page.goto(`/organizations/${loadDemoContext().organizationId}/studio`);
    await page.getByRole('main').getByRole('button', { name: 'Configure', exact: true }).click();
    const group = page.getByRole('menu').getByRole('group', { name: 'Organization settings' });
    await expect(group.getByRole('menuitem', { name: 'Branding' })).toBeVisible();
    await expect(group.getByRole('menuitem', { name: 'Domains' })).toBeVisible();
  });

  for (const [label, width, height] of [['tablet', 1024, 900], ['phone', 390, 844]] as const) {
    test(`${label}: dialogs, popover and price rows fit without horizontal scroll`, async ({ page }) => {
      const base = `/organizations/${loadDemoContext().organizationId}`;
      await page.setViewportSize({ width, height });
      await page.goto(`${base}/settings/access/members`);
      await page.getByRole('button', { name: 'Add member' }).click();
      const dialog = page.getByRole('dialog', { name: 'Add member' });
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await noOverflow(page);
      await page.keyboard.press('Escape');
      await page.goto(`${base}/home`);
      await page.getByRole('button', { name: 'Customize' }).click();
      await expect(page.getByRole('dialog', { name: 'Customize Home' })).toBeInViewport();
      await page.keyboard.press('Escape');
      await page.goto(`${base}/finance/configuration/pricing`);
      await page.getByRole('region', { name: /Price book/ }).getByRole('button', { name: /^Edit / }).first().click();
      await expect(page.getByRole('form', { name: /^Edit / }).getByRole('button', { name: 'Save' })).toBeInViewport();
      await noOverflow(page);
    });
  }
});

test.describe('a reduced-role colleague', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE, viewport: { width: 1440, height: 900 } });

  test('is not offered the replaced surfaces it may not use', async ({ page }) => {
    const base = `/organizations/${loadDemoContext().organizationId}`;
    await page.goto(`${base}/settings/access/members`);
    await expect(page.getByRole('button', { name: 'Add member' })).toHaveCount(0);
    await page.goto(`${base}/finance/configuration/pricing`);
    if (await page.getByRole('heading', { name: 'This page does not exist' }).isVisible()) return;
    await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add price item' })).toHaveCount(0);
  });
});
