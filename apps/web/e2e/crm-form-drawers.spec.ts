import { test, expect, type Locator, type Page } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';
import { chooseOption } from './select-field';

/**
 * The drawer contract for CRM editing forms, driven in a real browser: footer actions that stay
 * visible while the form scrolls, a refused save that keeps what was typed and moves focus to the
 * reason, Escape that keeps working after it, a confirmation before discarding changes (and only
 * then), Escape inside that confirmation closing only it, focus returning to what opened the drawer,
 * one submission while saving, and unchanged CRM page identity. Runs against one disposable
 * business (`playwright.isolated.config.ts`); records it creates carry a run-unique suffix.
 */

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

// Drawers confirm in a dialog, focused dialogs in an alertdialog; the contract is the same.
const confirmation = (page: Page) => page.getByRole('dialog', { name: 'Discard unsaved changes?' }).or(page.getByRole('alertdialog', { name: 'Discard unsaved changes?' }));

/** The footer is reachable, inside the window, and below the scrolling body rather than over it. */
async function expectFooterBelowBody(page: Page, drawer: Locator) {
  const footer = await drawer.locator('[data-drawer-footer], [data-dialog-footer]').boundingBox();
  const body = await drawer.locator('[data-drawer-body], [data-dialog-body]').boundingBox();
  const viewport = page.viewportSize()!;
  expect(footer).not.toBeNull();
  expect(body).not.toBeNull();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(body!.y + body!.height).toBeLessThanOrEqual(footer!.y + 1);
}

/** With changes, Escape asks; Escape in the confirmation closes only it; Discard returns focus. */
async function expectGuardedDiscard(page: Page, drawer: Locator, trigger: Locator) {
  await page.keyboard.press('Escape');
  await expect(confirmation(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation(page)).toBeHidden();
  await expect(drawer).toBeVisible();
  expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await drawer.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirmation(page)).toBeVisible();
  await page.getByRole('button', { name: /^Discard/ }).click();
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.pointerEvents)).not.toBe('none');
}

for (const viewport of VIEWPORTS) {
  test.describe(`CRM form drawers at ${viewport.name}`, () => {
    test.use({ storageState: OWNER_STORAGE_STATE, viewport: { width: viewport.width, height: viewport.height } });
    const run = `${viewport.name}${Date.now() % 100000}`;

    test('Customer fields: refusal keeps input, guarded discard, create, edit and persisted values', async ({ page }) => {
      const { organizationId } = loadDemoContext();
      await page.goto(`/organizations/${organizationId}/crm/configuration/fields`);
      await expect(page.getByRole('heading', { level: 1, name: 'Customer fields' })).toBeAttached();
      const trigger = page.getByRole('button', { name: /New field/ });
      const drawer = page.getByRole('dialog', { name: 'New field' });

      // A field to collide with, created through the drawer itself.
      await trigger.click();
      await expect(page.getByLabel('Label', { exact: true })).toBeFocused();
      await expectFooterBelowBody(page, drawer);
      await page.getByLabel('Label', { exact: true }).fill(`Reference ${run}`);
      await page.getByLabel('Key', { exact: true }).fill(`ref_${run}`);
      await drawer.getByRole('button', { name: 'Add field' }).click();
      await expect(drawer).toBeHidden();
      await expect(confirmation(page)).toBeHidden();

      // Clean close: no question.
      await trigger.click();
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(confirmation(page)).toBeHidden();

      // Refusal: typed values stay, focus moves to the reason, Escape still asks.
      await trigger.click();
      await page.getByLabel('Label', { exact: true }).fill('Duplicate');
      await page.getByLabel('Key', { exact: true }).fill(`ref_${run}`);
      await drawer.getByRole('button', { name: 'Add field' }).click();
      await expect(drawer.getByRole('alert')).toContainText('already exists');
      await expect(page.getByLabel('Label', { exact: true })).toHaveValue('Duplicate');
      await expect(page.getByLabel('Key', { exact: true })).toHaveValue(`ref_${run}`);
      expect(await drawer.getByRole('alert').evaluate((alert) => alert.parentElement === document.activeElement)).toBe(true);

      // A long form on a short window: the body scrolls, the footer stays put.
      await chooseOption(page.getByLabel('Type', { exact: true }), { label: 'Choice' });
      await page.getByLabel('Choices').fill(Array.from({ length: 12 }, (_, index) => `Option ${index + 1}`).join('\n'));
      await page.setViewportSize({ width: viewport.width, height: 520 });
      await drawer.locator('[data-drawer-body]').evaluate((body) => body.scrollTo(0, body.scrollHeight));
      await expectFooterBelowBody(page, drawer);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await expectGuardedDiscard(page, drawer, trigger);

      // Edit: saved values open, a change is saved and is what reopens.
      await page.getByRole('button', { name: `Edit Reference ${run}` }).click();
      const edit = page.getByRole('dialog', { name: `Edit Reference ${run}` });
      await expect(edit.getByLabel('Label', { exact: true })).toHaveValue(`Reference ${run}`);
      await edit.getByLabel('Label', { exact: true }).fill(`Renamed ${run}`);
      await edit.getByRole('button', { name: 'Save changes' }).click();
      await expect(edit).toBeHidden();
      await page.getByRole('button', { name: `Edit Renamed ${run}` }).click();
      await expect(page.getByRole('dialog', { name: `Edit Renamed ${run}` }).getByLabel('Label', { exact: true })).toHaveValue(`Renamed ${run}`);
    });

    // Contact creation is now the Add contacts intake dialog, covered by crm-intake.spec.ts at every width.

    test('Opportunity and follow-up from a customer record: refusals keep input, saves behave as before', async ({ page }) => {
      const { organizationId, customerId } = loadDemoContext();
      await page.goto(`/organizations/${organizationId}/crm/contacts/${customerId}`);

      // V1.4: opportunities live under the record's Sales section.
      await page.getByRole('link', { name: 'Sales', exact: true }).click();
      const newOpportunity = page.getByRole('button', { name: 'New opportunity' });
      const opportunity = page.getByRole('dialog', { name: 'New opportunity' });
      await newOpportunity.click();
      await expectFooterBelowBody(page, opportunity);
      await opportunity.getByLabel('Title', { exact: true }).fill(`Drawer opportunity ${run}`);
      await opportunity.getByLabel('Value').fill('1250.50');
      await opportunity.getByLabel('Currency').fill('1');
      await opportunity.getByRole('button', { name: 'Save opportunity' }).click();
      await expect(opportunity.getByRole('alert')).toContainText('three-letter currency');
      await expect(opportunity.getByLabel('Title', { exact: true })).toHaveValue(`Drawer opportunity ${run}`);
      await expect(opportunity.getByLabel('Value')).toHaveValue('1250.50');
      await expectGuardedDiscard(page, opportunity, newOpportunity);

      await page.getByRole('link', { name: 'Tasks', exact: true }).click();
      const newFollowUp = page.getByRole('button', { name: 'New task' });
      const followUp = page.getByRole('dialog', { name: 'New task' });
      await newFollowUp.click();
      await expectFooterBelowBody(page, followUp);
      await followUp.getByLabel('Title', { exact: true }).fill('   ');
      await followUp.getByLabel('Due', { exact: true }).fill('2027-01-15T09:30');
      await followUp.getByLabel('Notes').fill(`Kept after refusal ${run}`);
      await followUp.getByRole('button', { name: 'Save task' }).click();
      await expect(followUp.getByRole('alert')).toContainText('Enter a title');
      await expect(followUp.getByLabel('Due', { exact: true })).toHaveValue('2027-01-15T09:30');
      await expect(followUp.getByLabel('Notes')).toHaveValue(`Kept after refusal ${run}`);
      await followUp.getByLabel('Title', { exact: true }).fill(`Drawer follow-up ${run}`);
      await followUp.getByRole('button', { name: 'Save task' }).click();
      await expect(followUp).toBeHidden();
      await expect(confirmation(page)).toBeHidden();
      await expect(page.getByRole('button', { name: `Drawer follow-up ${run}` }).first()).toBeVisible();

      // Saving an opportunity still opens it, as it did before the footer moved.
      await page.getByRole('link', { name: 'Sales', exact: true }).click();
      await newOpportunity.click();
      await opportunity.getByLabel('Title', { exact: true }).fill(`Saved opportunity ${run}`);
      await opportunity.getByRole('button', { name: 'Save opportunity' }).click();
      await expect(page).toHaveURL(new RegExp(`/organizations/${organizationId}/crm/opportunities/[a-f0-9-]+$`));
      await expect(page.getByRole('heading', { name: `Saved opportunity ${run}` })).toBeVisible();
    });
  });
}
