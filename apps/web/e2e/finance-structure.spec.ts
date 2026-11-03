import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { COLLEAGUE_STORAGE_STATE, OWNER_STORAGE_STATE, loadDemoContext } from './helpers';
import { populateFinanceBusiness, provisionFinanceBusiness, signInOwner, type FinanceFixture } from './finance-fixtures';
import { assertCapturable, guardedShot } from './visual-guard';
import { chooseOption, selectFieldValue } from './select-field';

/**
 * Finance Structural Correction in a real browser, against a disposable database: Finance has no
 * Configuration row, crumb or landing; trading currency (Organization Settings → General) and payment
 * collection (Organization Settings → Customer payments) are reached at their one owners; no platform link sits inside Finance and platform
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
let fx: FinanceFixture; let empty: string; let fresh: string;

test.describe.serial('Finance structural correction', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    owner = await signInOwner();
    const run = Date.now().toString(36);
    fx = await populateFinanceBusiness(owner.db, await provisionFinanceBusiness(owner, `Finance structure ${run}`));
    empty = await provisionFinanceBusiness(owner, `Finance structure empty ${run}`);
    fresh = await provisionFinanceBusiness(owner, `Finance structure fresh ${run}`);
  });

  test('the capture guard refuses a signed-out page and a refused page', async ({ browser }) => {
    const signedOut = await browser.newContext();
    const page = await signedOut.newPage();
    await page.goto(`/organizations/${fx.organizationId}/finance`);
    await expect(assertCapturable(page, { url: `/organizations/${fx.organizationId}/finance`, content: page.getByRole('main') })).rejects.toThrow(/Refusing to capture/);
    // The old payments address gives a signed-out visitor nothing but the sign-in page.
    await page.goto(`/organizations/${fx.organizationId}/finance/configuration/pricing#getting-paid`);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Getting paid')).toHaveCount(0);
    await signedOut.close();
  });

  test.describe('reduced-role colleague', () => {
    test.use({ storageState: COLLEAGUE_STORAGE_STATE });

    test('the old addresses refuse another business and show no payment settings without permission', async ({ page }) => {
      // Not a member of this business: the redirect is refused, never forwarded to its settings.
      // The payments address is a plain HTTP redirect: a non-member gets 404 and no Location.
      const direct = await page.request.get(`/organizations/${fx.organizationId}/finance/configuration/pricing`, { maxRedirects: 0 });
      expect(direct.status()).toBe(404);
      expect(direct.headers()['location']).toBeUndefined();
      expect(await direct.text()).not.toContain('Getting paid');
      for (const old of ['finance/configuration/pricing#getting-paid', 'finance/configuration']) {
        await page.goto(`/organizations/${fx.organizationId}/${old}`);
        await expect(page).not.toHaveURL(/\/settings\/general/);
        await expect(page.getByText('Getting paid')).toHaveCount(0);
        await expect(page.getByText(fx.organizationId)).toHaveCount(0);
      }
      // The landing address renders the application's own refusal for a business they do not belong to.
      await expect(page.getByText('This business is not available')).toBeVisible();
      // Their own business: Customer payments is not theirs to open, so they land on General, which offers no payment settings.
      const own = loadDemoContext().organizationId;
      await page.goto(`/organizations/${own}/finance/configuration/pricing#getting-paid`);
      await expect(page).toHaveURL(`/organizations/${own}/settings/general#getting-paid`);
      await expect(page.getByRole('heading', { name: 'Getting paid' })).toHaveCount(0);
      await expect(page.locator('#getting-paid')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Manage payment features' })).toHaveCount(0);
    });
  });

  test.describe('owner', () => {
    test.use({ storageState: OWNER_STORAGE_STATE });

    test('the guard refuses a page the owner may not open, and a wrong address', async ({ page }) => {
      await page.goto('/platform/plans');
      await expect(assertCapturable(page, { url: '/platform/plans', content: page.getByRole('heading', { name: 'Plans & Add-ons' }) })).rejects.toThrow(/Refusing to capture|expected content/);
      await page.goto(`/organizations/${fx.organizationId}/finance/catalog`);
      await expect(assertCapturable(page, { url: `/organizations/${empty}/finance/catalog`, content: page.getByRole('main') })).rejects.toThrow(/Refusing to capture/);
    });

    test('Finance has no Configuration and links payment collection to Customer payments', async ({ page }) => {
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
      // The old Finance configuration addresses land on Customer payments, never on a Finance landing.
      await page.goto(`${base}/finance/configuration`);
      await expect(page).toHaveURL(`${base}/settings/payments`);
      await page.goto(`${base}/finance/configuration/pricing#getting-paid`);
      await expect(page).toHaveURL(`${base}/settings/payments#getting-paid`);
      // Catalog & Pricing links to the one owner of payment collection.
      await page.goto(`${base}/finance/catalog`);
      await page.getByRole('main').getByRole('link', { name: 'Payment settings', exact: true }).click();
      await expect(page).toHaveURL(`${base}/settings/payments`);
      await expect(page.getByRole('main')).toContainText('New prices and invoices are in CAD');
      await expect(page.locator('#getting-paid').getByRole('heading', { name: 'Card payments' })).toBeVisible();
      // The one currency editor is General's Regional settings, which shows the stored currency even with no country.
      await page.getByRole('main').getByRole('link', { name: 'Change in General → Regional settings' }).click();
      const regional = page.getByRole('region', { name: 'Regional settings' });
      await expect(regional).toContainText('trading currency CAD');
      await regional.getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(selectFieldValue(page.getByLabel('Currency', { exact: true }))).toHaveValue('CAD');
    });

    test('an empty business customizes its Dashboard, opens New quote, reaches pricing and comes back unchanged', async ({ page }) => {
      test.setTimeout(120_000);
      const base = `/organizations/${fresh}/finance`;
      const order = () => page.locator('[data-widget-id]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.widgetId));
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(base);
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: 'Customize dashboard' }).click();
      await expect(page.getByRole('toolbar', { name: 'Customize dashboard' })).toBeVisible();
      // Nothing is recorded, so Financial activity is not drawn yet; the overview and Getting started still reorder.
      await expect(page.locator('[data-widget-id="activity"]')).toHaveCount(0);
      await page.getByRole('button', { name: 'Move Needs attention earlier' }).click();
      const edited = await order();
      expect(edited.indexOf('attention')).toBeLessThan(edited.indexOf('overview'));
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Dashboard layout saved.' })).toBeVisible();
      // New quote opens; with no Work yet it says a quote starts from Work, and closing returns focus.
      const newQuote = page.getByRole('main').getByRole('button', { name: 'New quote', exact: true });
      await newQuote.click();
      const dialog = page.getByRole('dialog', { name: 'New quote' });
      await expect(dialog).toContainText('A quote is priced Work, so it starts from a Work item.');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(newQuote).toBeFocused();
      await page.getByRole('region', { name: 'Getting started' }).getByRole('link', { name: 'Set up pricing' }).click();
      await expect(page).toHaveURL(`${base}/catalog`);
      await expect(page.getByText('Nothing is priced yet.')).toBeVisible();
      // Back returns to the same Dashboard, with the saved arrangement and the Getting started panel.
      await page.goBack();
      await expect(page).toHaveURL(base);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('region', { name: 'Getting started' })).toBeVisible();
      expect(await order()).toEqual(edited);
      await page.reload();
      await page.waitForLoadState('networkidle');
      expect(await order()).toEqual(edited);
      await guardedShot(page, { url: base, content: page.getByRole('region', { name: 'Getting started' }) }, { path: path.join(OUT, 'dashboard-empty-customized-desktop.png'), fullPage: true });
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
        await chooseOption(dialog.getByLabel('Price item'), { label: 'Labour · CA$95.50 / hour' });
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
        // Organization currency and payment collection, at their one owners.
        await page.goto(`${base}/settings/general`);
        await capture(`settings-general-currency-${v}`, `${base}/settings/general`, heading(page, 'General'));
        await page.goto(`${base}/settings/payments`);
        await capture(`settings-payments-${v}`, `${base}/settings/payments`, heading(page, 'Customer payments'));
      }
    });
  });
});
