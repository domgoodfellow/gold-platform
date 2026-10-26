import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OWNER_STORAGE_STATE } from './helpers';
import { populateFinanceBusiness, provisionFinanceBusiness, signInOwner, type FinanceFixture } from './finance-fixtures';
import { assertCapturable, guardedShot } from './visual-guard';

/**
 * Finance Structural Correction in a real browser, against a disposable database: Finance has no
 * Configuration row, crumb or landing; trading currency and payment collection are reached at their
 * one owner (Organization Settings → General); no platform link sits inside Finance and platform
 * pages refuse a business owner; setting up pricing creates no Work; a business with nothing
 * recorded keeps its Dashboard. Every capture passes `assertCapturable` first, and the guard is
 * itself shown to refuse a signed-out page and a refused page. Screenshots land in
 * `.artifacts/finance-structure`.
 */
const OUT = path.join(__dirname, '..', '..', '..', '.artifacts', 'finance-structure');
const VIEWPORTS = [{ name: 'phone', width: 390, height: 844 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'desktop', width: 1440, height: 900 }] as const;
const sidebarNav = (page: Page) => page.locator('[data-slot="sidebar-container"]').getByRole('navigation', { name: 'This business' });
const choose = (scope: ReturnType<Page['getByRole']>, name: RegExp) => scope.locator('label').filter({ has: scope.page().getByRole('radio', { name }) }).click();
const fits = async (page: Page, label: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label} scrolls sideways`).toBe(true);
const heading = (page: Page, name: string) => page.getByRole('main').getByRole('heading', { level: 1, name, exact: true });
/** A header action, inline when it fits and in More when it does not. */
async function headerAction(page: Page, name: string) {
  const inline = page.getByRole('main').getByRole('button', { name, exact: true }).filter({ visible: true });
  if (await inline.count()) return inline.first().click();
  await page.getByRole('button', { name: 'More finance actions' }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
const count = async (db: SupabaseClient, table: string, organizationId: string) => (await db.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', organizationId)).count;

let owner: { db: SupabaseClient; userId: string; ownerEmail: string };
let fx: FinanceFixture; let empty: string;

test.describe.serial('Finance structural correction', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    owner = await signInOwner();
    const run = Date.now().toString(36);
    fx = await populateFinanceBusiness(owner.db, await provisionFinanceBusiness(owner, `Finance structure ${run}`));
    empty = await provisionFinanceBusiness(owner, `Finance structure empty ${run}`);
  });

  test('the capture guard refuses a signed-out page and a refused page', async ({ browser }) => {
    const signedOut = await browser.newContext();
    const page = await signedOut.newPage();
    await page.goto(`/organizations/${fx.organizationId}/finance`);
    await expect(assertCapturable(page, { url: `/organizations/${fx.organizationId}/finance`, content: page.getByRole('main') })).rejects.toThrow(/Refusing to capture/);
    await signedOut.close();
  });

  test.describe('owner', () => {
    test.use({ storageState: OWNER_STORAGE_STATE });

    test('the guard refuses a page the owner may not open, and a wrong address', async ({ page }) => {
      await page.goto('/platform/plans');
      await expect(assertCapturable(page, { url: '/platform/plans', content: page.getByRole('heading', { name: 'Plans & Add-ons' }) })).rejects.toThrow(/Refusing to capture|expected content/);
      await page.goto(`/organizations/${fx.organizationId}/finance/catalog`);
      await expect(assertCapturable(page, { url: `/organizations/${empty}/finance/catalog`, content: page.getByRole('main') })).rejects.toThrow(/Refusing to capture/);
    });

    test('Finance has no Configuration and links currency and payments to General', async ({ page }) => {
      const base = `/organizations/${fx.organizationId}`;
      await page.setViewportSize({ width: 1440, height: 900 });
      for (const at of ['finance', 'finance/catalog', 'finance/invoices', 'finance/payments']) {
        await page.goto(`${base}/${at}`);
        await page.waitForLoadState('networkidle');
        const nav = sidebarNav(page);
        await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Configuration', exact: true })).toHaveCount(0);
        await expect(nav.getByRole('button', { name: 'Configuration', exact: true })).toHaveCount(0);
        await expect(nav.getByRole('link', { name: 'Commercial administration' })).toHaveCount(0);
        await expect(page.getByRole('navigation', { name: 'breadcrumb' }).getByText('Configuration', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('main').getByRole('button', { name: 'Configure', exact: true })).toHaveCount(0);
      }
      // The old Finance configuration addresses land on General, never on a Finance landing.
      await page.goto(`${base}/finance/configuration`);
      await expect(page).toHaveURL(`${base}/settings/general`);
      await page.goto(`${base}/finance/configuration/pricing#getting-paid`);
      await expect(page).toHaveURL(`${base}/settings/general#getting-paid`);
      // Catalog & Pricing links to the one owner of currency and payment collection.
      await page.goto(`${base}/finance/catalog`);
      await page.getByRole('main').getByRole('link', { name: 'Currency & payment settings', exact: true }).click();
      await expect(page).toHaveURL(`${base}/settings/general#getting-paid`);
      const gettingPaid = page.locator('#getting-paid');
      await expect(gettingPaid.getByRole('heading', { name: 'Getting paid' })).toBeVisible();
      await expect(gettingPaid).toContainText('New prices and invoices are in CAD');
      // The one currency editor is General's address section.
      await gettingPaid.getByRole('link', { name: 'address section' }).click();
      // The currency follows the business's country, so a business with no country chooses one first.
      const address = page.getByRole('region', { name: 'Primary business address' });
      await address.getByLabel('Country').selectOption('CA');
      await address.getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(page.getByLabel('Currency', { exact: true })).toHaveValue('CAD');
    });

    test('setting up pricing creates no Work type or Work, and a new business keeps its Dashboard', async ({ page }) => {
      test.setTimeout(150_000);
      const base = `/organizations/${empty}`;
      const before = { types: await count(owner.db, 'work_item_types', empty), work: await count(owner.db, 'work_items', empty) };
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(`${base}/finance`);
        await expect(page.getByRole('region', { name: 'Finance dashboard' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Getting started' })).toBeVisible();
        await fits(page, `empty dashboard ${viewport.name}`);
        await guardedShot(page, { url: `${base}/finance`, content: page.getByRole('region', { name: 'Getting started' }) }, { path: path.join(OUT, `dashboard-empty-${viewport.name}.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole('region', { name: 'Getting started' }).getByRole('link', { name: 'Set up pricing' }).click();
      await expect(page).toHaveURL(`${base}/finance/catalog`);
      await page.getByRole('button', { name: 'Add price item', exact: true }).click();
      const row = page.getByRole('form', { name: 'Add price item', exact: true });
      await row.getByLabel('Name of new price item', { exact: true }).fill('Site visit');
      await row.getByLabel('Unit of new price item', { exact: true }).fill('visit');
      await row.getByLabel(/^Amount in .* for new price item$/).fill('120');
      await row.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(row).toHaveCount(0);
      expect(await count(owner.db, 'price_book_items', empty)).toBe(1);
      expect({ types: await count(owner.db, 'work_item_types', empty), work: await count(owner.db, 'work_items', empty) }).toEqual(before);
      // Priced, but nothing quoted yet: the Dashboard stays, and Getting started moves to pricing Work.
      await page.goto(`${base}/finance`);
      await expect(page.getByRole('region', { name: 'Getting started' })).toContainText('Prices are ready');
      await expect(page.getByRole('region', { name: 'Getting started' }).getByRole('button', { name: 'Price Work' })).toBeVisible();
    });

    test('captures each Finance journey at desktop, tablet and phone, only after the guard passes', async ({ page }) => {
      test.setTimeout(300_000);
      const base = `/organizations/${fx.organizationId}`;
      const capture = (name: string, url: string, content: ReturnType<Page['getByRole']>) => guardedShot(page, { url, content }, { path: path.join(OUT, `${name}.png`), fullPage: true });
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        const v = viewport.name;
        await page.goto(`${base}/finance`);
        await capture(`dashboard-populated-${v}`, `${base}/finance`, page.getByRole('region', { name: 'Finance dashboard' }));
        if (v !== 'phone') await expect(sidebarNav(page).getByRole('link', { name: 'Catalog & Pricing' })).toBeVisible();
        await page.goto(`${base}/finance/catalog`);
        await capture(`catalog-${v}`, `${base}/finance/catalog`, page.getByRole('region', { name: /Price book/ }));
        // New quote with priced Work.
        await page.goto(`${base}/finance`);
        await headerAction(page, 'New quote');
        let dialog = page.getByRole('dialog', { name: 'New quote' });
        await dialog.getByLabel('Search Work items').fill('Heat pump');
        await choose(dialog, /Heat pump estimate/);
        await dialog.getByLabel('Price item').selectOption({ label: 'Labour · CA$95.50 / hour' });
        await expect(dialog.getByLabel('Quote totals')).toContainText('Quote after this line');
        await capture(`quote-dialog-${v}`, `${base}/finance`, dialog);
        // Invoice review.
        await page.goto(`${base}/finance`);
        await page.getByRole('main').getByRole('button', { name: 'New invoice', exact: true }).click();
        dialog = page.getByRole('dialog', { name: 'New invoice' });
        await choose(dialog, /Heat pump estimate/);
        await expect(dialog.getByRole('list', { name: 'Invoice lines' })).toBeVisible();
        await capture(`invoice-review-${v}`, `${base}/finance`, dialog);
        // Payment dialog.
        await page.goto(`${base}/finance/invoices`);
        await page.getByRole('button', { name: /Record payment for invoice #3/ }).filter({ visible: true }).click();
        dialog = page.getByRole('dialog', { name: 'Record payment' });
        await dialog.getByLabel('Amount (CAD)').fill('10.00');
        await capture(`payment-dialog-${v}`, `${base}/finance/invoices`, dialog);
        // Organization currency and payment collection, at their one owner.
        await page.goto(`${base}/settings/general`);
        await capture(`settings-general-currency-${v}`, `${base}/settings/general`, heading(page, 'General'));
        await page.goto(`${base}/settings/general#getting-paid`);
        const gettingPaid = page.locator('#getting-paid');
        await gettingPaid.scrollIntoViewIfNeeded();
        await capture(`settings-general-getting-paid-${v}`, `${base}/settings/general#getting-paid`, gettingPaid);
      }
    });
  });
});
