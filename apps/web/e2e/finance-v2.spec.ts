import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { COLLEAGUE_STORAGE_STATE, OWNER_STORAGE_STATE, loadDemoContext } from './helpers';
import { populateFinanceBusiness, provisionFinanceBusiness, signInOwner, type FinanceFixture } from './finance-fixtures';
import { getInvoiceForWorkItem, issueInvoice } from '../lib/domain/billing/invoices';
import { readFinanceInvoices, readFinancePayments } from '../lib/domain/billing/finance-reads';
import { addPricedLine, listPricedLines } from '../lib/domain/pricing/prices';
import { createWorkItem } from '../lib/domain/work-items/work-items';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { resetAppearance, saveAppearance } from '../lib/domain/identity/appearance';

/**
 * Finance V2.0 in a real browser against the isolated run (`playwright.isolated.config.ts`): two
 * extra businesses this spec provisions and records for teardown — one new, one populated with
 * synthetic CAD and USD records — plus the run's reduced-role colleague. Dashboard, transaction
 * dialogs, collections and catalog, each checked against the database, with screenshots at phone,
 * tablet and desktop width saved under `.artifacts/finance-v2/after`.
 */
const OUT = path.join(__dirname, '..', '..', '..', '.artifacts', 'finance-v2', 'after');
const VIEWPORTS = [{ name: 'phone', width: 390, height: 844 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'desktop', width: 1440, height: 900 }] as const;
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
const fits = async (page: Page, label: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label} scrolls sideways`).toBe(true);
const sidebarNav = (page: Page) => page.locator('[data-slot="sidebar-container"]').getByRole('navigation', { name: 'This business' });
const main = (page: Page) => page.getByRole('main');
/** A record choice is a whole row; a person clicks the row, not the hidden radio inside it. */
const choose = (scope: ReturnType<Page['getByRole']>, name: RegExp) => scope.locator('label').filter({ has: scope.page().getByRole('radio', { name }) }).click();

let owner: { db: SupabaseClient; userId: string; ownerEmail: string };
let empty: string;
let fx: FinanceFixture;

test.describe.serial('Finance V2.0', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    owner = await signInOwner();
    const run = Date.now().toString(36);
    empty = await provisionFinanceBusiness(owner, `Finance new ${run}`);
    const populated = await provisionFinanceBusiness(owner, `Finance populated ${run}`);
    fx = await populateFinanceBusiness(owner.db, populated);
    // The run's own business, so its reduced-role colleague meets Finance with billing on.
    await setModuleEnabled(owner.db, { organizationId: loadDemoContext().organizationId, key: 'billing', enabled: true });
  });

  test.describe('owner', () => {
    test.use({ storageState: OWNER_STORAGE_STATE });

    test('a new business starts at its catalog instead of zero-valued figures', async ({ page }) => {
      test.setTimeout(120_000);
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(`/organizations/${empty}/finance`);
        await expect(page.getByRole('region', { name: 'Get started with Finance' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Financial overview' })).toHaveCount(0);
        await expect(main(page).getByRole('button', { name: 'New invoice' })).toHaveCount(0);
        await fits(page, `new dashboard ${viewport.name}`);
        await shot(page, `dashboard-new-${viewport.name}`);
      }
      await main(page).getByRole('link', { name: 'Add services' }).first().click();
      await expect(page).toHaveURL(`/organizations/${empty}/finance/catalog`);
      await expect(page.getByText('No services priced yet.')).toBeVisible();
      await shot(page, 'catalog-empty-desktop');
    });

    test('Finance navigation lists Dashboard first, then its operating pages, with configuration last', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const base = `/organizations/${fx.organizationId}/finance`;
      await page.goto(base);
      const names = (await sidebarNav(page).getByRole('link').allInnerTexts()).map(text => text.trim()).filter(Boolean);
      const start = names.indexOf('Dashboard');
      expect(names.slice(start, start + 7)).toEqual(['Dashboard', 'Catalog & Pricing', 'Quotes', 'Invoices', 'Payments', 'Financial reports', 'Configuration']);
      await expect(sidebarNav(page).getByRole('link', { name: 'Configuration', exact: true })).toHaveAttribute('href', `${base}/configuration/pricing`);
      await sidebarNav(page).getByRole('link', { name: 'Catalog & Pricing' }).click();
      await expect(page).toHaveURL(`${base}/catalog`);
      await expect(sidebarNav(page).getByRole('link', { name: 'Catalog & Pricing' })).toHaveAttribute('aria-current', 'page');
      // Old addresses still resolve inside Finance, never to /platform.
      for (const legacy of ['pricing', 'settings/pricing']) {
        await page.goto(`/organizations/${fx.organizationId}/${legacy}`);
        await expect(page).toHaveURL(`${base}/configuration/pricing`);
        await expect(page.getByRole('link', { name: 'Catalog & Pricing' }).last()).toBeVisible();
      }
    });

    test('the populated Dashboard reads overview, attention, activity and reporting, with currencies apart', async ({ page }) => {
      test.setTimeout(180_000);
      const base = `/organizations/${fx.organizationId}/finance`;
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(base);
        const outstanding = main(page).getByRole('link', { name: /^Outstanding/ });
        await expect(outstanding).toContainText('CA$');
        await expect(outstanding).toContainText('US$360.00');
        await expect(main(page).getByRole('link', { name: /^Overdue/ })).toBeVisible();
        await fits(page, `dashboard ${viewport.name}`);
        await shot(page, `dashboard-populated-${viewport.name}`);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      // Header hierarchy: one primary action; the others secondary; Configure present.
      await expect(main(page).getByRole('button', { name: 'New invoice' })).toHaveAttribute('data-variant', 'default');
      for (const name of ['New quote', 'Record payment']) await expect(main(page).getByRole('button', { name })).toHaveAttribute('data-variant', 'outline');
      const attention = page.getByRole('region', { name: 'Needs attention' });
      await expect(attention.getByRole('button', { name: 'Overdue 2' })).toBeVisible();
      await expect(attention.getByRole('button', { name: 'Due soon 1' })).toBeVisible();
      await expect(attention.getByRole('button', { name: 'Ready to invoice 1' })).toBeVisible();
      await attention.getByRole('button', { name: 'Due soon 1' }).click();
      await expect(attention.getByText('Due today')).toBeVisible();
      await attention.getByRole('link', { name: 'View all' }).click();
      await expect(page).toHaveURL(/status=due-soon/);
      await expect(page.getByRole('status').filter({ hasText: 'match this view' })).toContainText('1 invoice');
      await page.goto(base);
      const activity = page.getByRole('region', { name: 'Financial activity' });
      await expect(activity.getByText('Correction recorded')).toBeVisible();
      await activity.getByRole('link', { name: /Correction recorded/ }).click();
      await expect(page).toHaveURL(new RegExp(`/work/${fx.work.overdueA}\\?tab=financials`));
      await page.goto(base);
      await expect(page.getByRole('region', { name: 'Collections & receivables' })).toBeVisible();
      await page.getByLabel('Reporting month').fill('2025-12');
      await page.getByRole('button', { name: 'Apply' }).click();
      await expect(page).toHaveURL(/month=2025-12/);
      await expect(main(page).getByRole('link', { name: /Payments received/ })).toContainText('None this month');
    });

    test('a quote line is a snapshot: added through the dialog, unchanged when the catalog price changes', async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/organizations/${fx.organizationId}/finance`);
      const before = await listPricedLines(owner.db, { organizationId: fx.organizationId, workItemId: fx.work.quoted });
      await main(page).getByRole('button', { name: 'New quote' }).click();
      const dialog = page.getByRole('dialog', { name: 'New quote' });
      await dialog.getByLabel('Search Work items').fill('Heat pump');
      await choose(dialog, /Heat pump estimate/);
      await expect(dialog.getByText('Cedar Tree Properties')).toBeVisible();
      await dialog.getByLabel('Service').selectOption({ label: 'Labour · CA$95.50 / hour' });
      await dialog.getByLabel('Quantity').fill('2');
      await expect(dialog.getByLabel('Quote totals')).toContainText('Quote after this line');
      await shot(page, 'quote-dialog-desktop');
      await dialog.getByRole('button', { name: 'Add to quote' }).click();
      await expect(dialog.getByRole('status')).toContainText('Priced line added to quote.');
      const after = await listPricedLines(owner.db, { organizationId: fx.organizationId, workItemId: fx.work.quoted });
      expect(after).toHaveLength(before.length + 1);
      expect(after.at(-1)).toMatchObject({ description: 'Labour', unitAmountMinor: 9550, quantity: 2, currency: 'CAD' });
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(main(page).getByRole('button', { name: 'New quote' })).toBeFocused();
      // Re-price Labour in the catalog's own row; the quoted line keeps its snapshot.
      await page.goto(`/organizations/${fx.organizationId}/finance/catalog`);
      await page.getByRole('button', { name: 'Edit Labour', exact: true }).click();
      const row = page.getByRole('form', { name: 'Edit Labour', exact: true });
      await row.getByLabel('Amount in CAD for Labour').fill('99.00');
      await row.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(row).toHaveCount(0);
      expect((await listPricedLines(owner.db, { organizationId: fx.organizationId, workItemId: fx.work.quoted })).at(-1)!.unitAmountMinor).toBe(9550);
      for (const viewport of VIEWPORTS) { await page.setViewportSize(viewport); await page.reload(); await fits(page, `catalog ${viewport.name}`); await shot(page, `catalog-${viewport.name}`); }
      await expect(page.getByText('Priced in USD')).toBeVisible();
    });

    test('an invoice is reviewed, confirmed and then matches its priced Work; it cannot be issued twice', async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/organizations/${fx.organizationId}/finance`);
      const lines = await listPricedLines(owner.db, { organizationId: fx.organizationId, workItemId: fx.work.quoted });
      await main(page).getByRole('button', { name: 'New invoice' }).click();
      const dialog = page.getByRole('dialog', { name: 'New invoice' });
      await choose(dialog, /Heat pump estimate/);
      await expect(dialog.getByRole('list', { name: 'Invoice lines' }).getByRole('listitem')).toHaveCount(lines.length);
      await dialog.getByLabel(/Due date/).fill('2026-01-01');
      await expect(dialog.getByRole('button', { name: 'Continue' })).toBeDisabled();
      await dialog.getByLabel(/Due date/).fill('');
      await shot(page, 'invoice-review-desktop');
      await dialog.getByRole('button', { name: 'Continue' }).click();
      await expect(dialog.getByRole('group', { name: 'Confirmation' })).toContainText('Issue invoice to Cedar Tree Properties?');
      expect(await getInvoiceForWorkItem(owner.db, { organizationId: fx.organizationId, workItemId: fx.work.quoted })).toBeNull();
      await shot(page, 'invoice-confirm-desktop');
      await dialog.getByRole('button', { name: 'Issue invoice' }).click();
      await expect(dialog.getByRole('status')).toContainText('issued');
      const issued = (await getInvoiceForWorkItem(owner.db, { organizationId: fx.organizationId, workItemId: fx.work.quoted }))!;
      expect(issued.lines.map(l => [l.description, l.unitAmountMinor, l.quantity])).toEqual(lines.map(l => [l.description, l.unitAmountMinor, l.quantity]));
      await dialog.getByRole('link', { name: 'Open invoice' }).click();
      await expect(page).toHaveURL(new RegExp(`/work/${fx.work.quoted}\\?tab=financials`));
      // A second issue for the same Work is refused by the database, whatever the caller.
      await expect(issueInvoice(owner.db, { workItemId: fx.work.quoted })).rejects.toThrow('already been invoiced');
      await page.goto(`/organizations/${fx.organizationId}/finance/quotes?status=invoiced`);
      await expect(page.getByRole('link', { name: 'View invoice' }).first()).toBeVisible();
    });

    test('payments keep exact amounts, corrections stay append-only, and the dialog fits a phone', async ({ page }) => {
      test.setTimeout(150_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      const invoicesPage = `/organizations/${fx.organizationId}/finance/invoices`;
      await page.goto(invoicesPage);
      const history = async (workItemId: string) => (await getInvoiceForWorkItem(owner.db, { organizationId: fx.organizationId, workItemId }))!.payments.map(p => p.amountMinor);
      const beforeDue = await history(fx.work.dueToday);
      await page.getByRole('button', { name: /Record payment for invoice #3/ }).filter({ visible: true }).click();
      let dialog = page.getByRole('dialog', { name: 'Record payment' });
      await expect(dialog.getByText('Invoice #3')).toBeVisible();
      await dialog.getByLabel('Amount (CAD)').fill('100.05');
      await expect(dialog.getByLabel('Balance')).toContainText('Outstanding after this');
      await shot(page, 'payment-dialog-desktop');
      await dialog.getByRole('button', { name: 'Record payment' }).click();
      await expect(dialog.getByRole('status')).toContainText('Payment recorded.');
      expect(await history(fx.work.dueToday)).toEqual([...beforeDue, 10005]);
      await dialog.getByRole('button', { name: 'Done' }).click();
      // A correction on the settled invoice: its own confirmed negative row; earlier rows untouched.
      const beforeSettled = await history(fx.work.settled);
      await page.reload();
      await page.getByRole('button', { name: /Record a correction on invoice #5/ }).filter({ visible: true }).click();
      dialog = page.getByRole('dialog', { name: 'Record correction' });
      await dialog.getByLabel('Amount (CAD)').fill('12.34');
      await dialog.getByRole('button', { name: 'Continue' }).click();
      await expect(dialog.getByRole('group', { name: 'Confirmation' })).toContainText('-CA$12.34');
      await shot(page, 'correction-confirm-desktop');
      await dialog.getByRole('button', { name: 'Record correction' }).click();
      await expect(dialog.getByRole('status')).toContainText('Correction recorded.');
      expect(await history(fx.work.settled)).toEqual([...beforeSettled, -1234]);
      await dialog.getByRole('button', { name: 'Done' }).click();
      // Unsaved input asks before it is discarded, and focus returns to the trigger.
      await page.goto(`/organizations/${fx.organizationId}/finance`);
      const trigger = main(page).getByRole('button', { name: 'Record payment' });
      await trigger.click();
      dialog = page.getByRole('dialog', { name: 'Record payment' });
      await choose(dialog, /Invoice #4/);
      await dialog.getByLabel('Amount (CAD)').fill('5');
      await page.keyboard.press('Escape');
      await page.getByRole('alertdialog', { name: 'Discard unsaved changes?' }).getByRole('button', { name: 'Discard' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      // Phone: the dialog scrolls inside, its actions stay on screen, nothing scrolls sideways.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/organizations/${fx.organizationId}/finance`);
      await main(page).getByRole('button', { name: 'Record payment' }).click();
      dialog = page.getByRole('dialog', { name: 'Record payment' });
      await choose(dialog, /Invoice #1/);
      await dialog.getByLabel('Amount (CAD)').fill('10');
      const action = dialog.getByRole('button', { name: 'Record payment' });
      const box = (await action.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(844);
      await fits(page, 'payment dialog phone');
      await shot(page, 'payment-dialog-phone');
      await page.keyboard.press('Escape');
      await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();
      // Priced Work of its own, so the invoice dialog has something to review at phone width.
      const survey = await createWorkItem(owner.db, { organizationId: fx.organizationId, statusId: fx.statusId, title: 'Rooftop survey' });
      await addPricedLine(owner.db, { workItemId: survey, priceBookItemId: fx.prices.visit, quantity: 1 });
      await page.reload();
      for (const [label, name] of [['New invoice', 'invoice'], ['New quote', 'quote']] as const) {
        await main(page).getByRole('button', { name: label }).click();
        await page.getByRole('dialog', { name: label }).locator('label').filter({ has: page.getByRole('radio') }).first().click();
        await page.waitForTimeout(600);
        await fits(page, `${name} dialog phone`);
        await shot(page, `${name}-dialog-phone`);
        await page.keyboard.press('Escape');
        const discard = page.getByRole('alertdialog').getByRole('button', { name: 'Discard' });
        if (await discard.isVisible().catch(() => false)) await discard.click();
      }
    });

    test('collections agree with the database, keep their view in the URL, and paginate', async ({ page }) => {
      test.setTimeout(240_000);
      const base = `/organizations/${fx.organizationId}/finance`;
      for (let i = 0; i < 22; i++) {
        const id = await createWorkItem(owner.db, { organizationId: fx.organizationId, statusId: fx.statusId, title: `Pagination ${i}` });
        await addPricedLine(owner.db, { workItemId: id, priceBookItemId: fx.prices.visit, quantity: 1 });
        await issueInvoice(owner.db, { workItemId: id });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      const count = async () => Number((await page.getByRole('status').filter({ hasText: /invoice|entr|priced/ }).first().innerText()).match(/\d+/)![0]);
      await page.goto(`${base}/invoices`);
      expect(await count()).toBe((await readFinanceInvoices(owner.db, fx.organizationId)).total);
      await page.getByRole('link', { name: 'Overdue' }).click();
      await expect(page).toHaveURL(/status=overdue/);
      expect(await count()).toBe((await readFinanceInvoices(owner.db, fx.organizationId, { status: 'overdue' })).total);
      await page.getByText('Filters', { exact: true }).click();
      await page.getByLabel('Filter by contact').selectOption({ label: 'Vertex HVAC' });
      await page.getByRole('button', { name: 'Apply filters' }).click();
      await expect(page).toHaveURL(/customer=/);
      await expect(page).toHaveURL(/status=overdue/);
      await expect(page.getByRole('group', { name: 'Active filters' })).toContainText('Contact: Vertex HVAC');
      await page.reload();
      await expect(page.getByRole('group', { name: 'Active filters' })).toContainText('Contact: Vertex HVAC');
      expect(await count()).toBe(1);
      await page.getByRole('link', { name: 'Reset' }).click();
      await expect(page).toHaveURL(`${base}/invoices`);
      await page.goto(`${base}/invoices?sort=due&status=outstanding`);
      await expect(page.getByLabel('Sort invoices')).toHaveValue('due');
      await page.goto(`${base}/invoices`);
      const total = (await readFinanceInvoices(owner.db, fx.organizationId)).total;
      await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText(`Page 1 of 2 · ${total} records`);
      await page.getByRole('link', { name: 'Next' }).click();
      await expect(page).toHaveURL(/page=2/);
      await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText('Page 2 of 2');
      await page.goto(`${base}/payments?entry=corrections`);
      expect(await count()).toBe((await readFinancePayments(owner.db, fx.organizationId, { entry: 'corrections' })).total);
      await expect(page.getByText('Correction', { exact: true }).first()).toBeVisible();
      await page.getByRole('link', { name: '#1', exact: true }).filter({ visible: true }).first().click();
      await expect(page).toHaveURL(new RegExp(`/work/${fx.work.overdueA}\\?tab=financials`));
      for (const kind of ['quotes', 'invoices', 'payments']) {
        for (const viewport of VIEWPORTS) {
          await page.setViewportSize(viewport);
          await page.goto(`${base}/${kind}`);
          await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
          await fits(page, `${kind} ${viewport.name}`);
          await shot(page, `${kind}-${viewport.name}`);
        }
      }
    });

    test('the Dashboard and dialogs keep their structure in Minimal, Layered and Expressive', async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      try {
        for (const preset of ['minimal', 'layered', 'expressive'] as const) {
          await saveAppearance(owner.db, { preset });
          await page.goto(`/organizations/${fx.organizationId}/finance`);
          await expect(page.getByRole('region', { name: 'Needs attention' })).toBeVisible();
          await shot(page, `dashboard-${preset}-desktop`);
          await main(page).getByRole('button', { name: 'Record payment' }).click();
          await page.getByRole('dialog', { name: 'Record payment' }).locator('label').filter({ has: page.getByRole('radio') }).first().click();
          await page.waitForTimeout(500);
          await shot(page, `payment-dialog-${preset}-desktop`);
          await page.keyboard.press('Escape');
        }
      } finally {
        await resetAppearance(owner.db);
      }
    });
  });

  test.describe('reduced-role colleague', () => {
    test.use({ storageState: COLLEAGUE_STORAGE_STATE });
    test('sees no financial writes, amounts, catalog or reports they cannot use', async ({ page }) => {
      const base = `/organizations/${loadDemoContext().organizationId}/finance`;
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(base);
      for (const name of ['New invoice', 'New quote', 'Record payment', 'Add services']) await expect(main(page).getByRole(name === 'Add services' ? 'link' : 'button', { name, exact: true })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Collections & receivables' })).toHaveCount(0);
      for (const name of ['Catalog & Pricing', 'Financial reports']) await expect(sidebarNav(page).getByRole('link', { name })).toHaveCount(0);
      await shot(page, 'dashboard-reduced-role-desktop');
      // The page streams, so refusal is the rendered not-found, as for any other refused organization page.
      await page.goto(`${base}/catalog`);
      await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible();
      await expect(page.getByRole('region', { name: /Price book/ })).toHaveCount(0);
      await page.goto(`${base}/invoices`);
      await expect(page.getByRole('button', { name: /Record payment/ })).toHaveCount(0);
    });
  });
});
