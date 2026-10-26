import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { COLLEAGUE_STORAGE_STATE, OWNER_STORAGE_STATE, loadDemoContext } from './helpers';
import { populateFinanceBusiness, provisionFinanceBusiness, signInOwner, ZONE, type FinanceFixture } from './finance-fixtures';
import { getInvoiceForWorkItem } from '../lib/domain/billing/invoices';
import { readFinanceInvoices, readFinanceSummary } from '../lib/domain/billing/finance-reads';
import { resetAppearance, saveAppearance } from '../lib/domain/identity/appearance';
import { setBrand } from '../lib/domain/branding/brand';
import { startOfMonth, shiftMonth, todayInZone } from '../lib/domain/scheduling/window';
import { formatMoney } from '../lib/domain/work-items/consumption';

/**
 * Finance V2.1 in a real browser, against a disposable database: shared charts checked against the
 * read model, the customizable Dashboard (pointer and keyboard resizing, moving, presentation,
 * save, reload, per-organization isolation, reset, phone editing), the invoice inspector and the
 * reduced-role colleague. Screenshots land in `.artifacts/finance-v21/after`.
 */
const OUT = path.join(__dirname, '..', '..', '..', '.artifacts', 'finance-v21', 'after');
const VIEWPORTS = [{ name: 'phone', width: 390, height: 844 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'compact', width: 1024, height: 800 }, { name: 'desktop', width: 1440, height: 900 }] as const;
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
/** The app scrolls inside its own container, so a whole composition is captured with a tall window at the same width. */
const tallShot = async (page: Page, name: string) => { const size = page.viewportSize()!; await page.setViewportSize({ width: size.width, height: 2600 }); await page.waitForTimeout(300); await shot(page, name); await page.setViewportSize(size); };
/** The header's controls: everything in the page's own header row above the dashboard. */
const headerTops = (page: Page) => page.locator('[data-slot="workspace-intro"] button:visible, [data-slot="workspace-intro"] input:visible, [data-slot="workspace-intro"] a:visible').evaluateAll(nodes => [...new Set(nodes.map(node => { const box = node.getBoundingClientRect(); return Math.round((box.top + box.height / 2) / 16); }))]);
const fits = async (page: Page, label: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label} scrolls sideways`).toBe(true);
const widget = (page: Page, id: string) => page.locator(`[data-widget-id="${id}"]`);
const tableRows = async (page: Page, id: string) => { await expect(widget(page, id).getByRole('table').getByRole('row').nth(1)).toBeVisible(); return widget(page, id).getByRole('table').getByRole('row').evaluateAll(rows => rows.slice(1).map(row => [...row.querySelectorAll('th, td')].map(cell => cell.textContent?.trim()))); };

let owner: { db: SupabaseClient; userId: string; ownerEmail: string };
let fx: FinanceFixture; let second: string; let empty: string;

test.describe.serial('Finance V2.1', () => {
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    owner = await signInOwner();
    const run = Date.now().toString(36);
    fx = await populateFinanceBusiness(owner.db, await provisionFinanceBusiness(owner, `Finance charts ${run}`));
    second = (await populateFinanceBusiness(owner.db, await provisionFinanceBusiness(owner, `Finance second ${run}`))).organizationId;
    empty = await provisionFinanceBusiness(owner, `Finance empty ${run}`);
    // The run's own business, populated, so its reduced-role colleague sees real counts.
    const own = loadDemoContext().organizationId;
    const { setModuleEnabled } = await import('../lib/domain/tenancy/modules');
    await setModuleEnabled(owner.db, { organizationId: own, key: 'billing', enabled: true });
    await populateFinanceBusiness(owner.db, own);
  });

  test.describe('owner', () => {
    test.use({ storageState: OWNER_STORAGE_STATE });

    test('charts show exactly the read model’s values, one currency at a time', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const base = `/organizations/${fx.organizationId}/finance`;
      await page.goto(base);
      await page.waitForLoadState('networkidle');
      const month = startOfMonth(todayInZone(ZONE));
      const summary = await readFinanceSummary(owner.db, fx.organizationId, month, shiftMonth(month, 1));
      // Payments received, as a table, equals the summary's CAD trend (net of the correction).
      // The same values as a line, as bars and as a table.
      await widget(page, 'payments-trend').screenshot({ path: path.join(OUT, 'chart-payments-line.png') });
      await widget(page, 'payments-trend').getByLabel('Payments received presentation').selectOption('bar');
      await widget(page, 'payments-trend').screenshot({ path: path.join(OUT, 'chart-payments-bar-negative-correction.png') });
      await widget(page, 'aging').screenshot({ path: path.join(OUT, 'chart-receivables-aging.png') });
      await widget(page, 'payments-trend').getByLabel('Payments received presentation').selectOption('table');
      await widget(page, 'payments-trend').screenshot({ path: path.join(OUT, 'chart-payments-table.png') });
      const trend = summary.trend.filter(row => row.currency === 'CAD').sort((a, b) => a.day.localeCompare(b.day)).map(row => formatMoney(Number(row.amount), 'CAD'));
      expect((await tableRows(page, 'payments-trend')).map(row => row[1])).toEqual(trend);
      expect(trend.some(value => value.startsWith('-'))).toBe(true);
      // Receivables aging per currency; USD is its own dataset, never added to CAD.
      await widget(page, 'aging').getByLabel('Receivables aging presentation').selectOption('table');
      const aging = (currency: string) => summary.aging.filter(row => row.currency === currency).map(row => formatMoney(Number(row.amount), currency));
      expect((await tableRows(page, 'aging')).map(row => row[1]).sort()).toEqual(aging('CAD').sort());
      await widget(page, 'aging').getByLabel('Receivables aging currency').selectOption('USD');
      expect((await tableRows(page, 'aging')).map(row => row[1])).toEqual(aging('USD'));
      await expect(widget(page, 'aging')).toContainText('Current outstanding receivables, as of today · USD');
      // Invoice status counts are the database's counts and add up to all issued invoices.
      await widget(page, 'invoice-status').getByLabel('Invoices by status presentation').selectOption('table');
      const [all, unpaid, overdue] = await Promise.all([readFinanceInvoices(owner.db, fx.organizationId), readFinanceInvoices(owner.db, fx.organizationId, { status: 'outstanding' }), readFinanceInvoices(owner.db, fx.organizationId, { status: 'overdue' })]);
      expect(await tableRows(page, 'invoice-status')).toEqual([['Overdue', String(overdue.total)], ['Unpaid, not overdue', String(unpaid.total - overdue.total)], ['Settled', String(all.total - unpaid.total)]]);
      // Costs the read model does not define would read Unknown; recorded zero reads as recorded.
      await expect(widget(page, 'performance')).toContainText('Costs recorded');
      await expect(widget(page, 'performance')).not.toContainText('Margin');
      // A chart reads by keyboard: one focus stop announcing exact labels.
      await page.reload();
      await page.waitForLoadState('networkidle');
      const plot = widget(page, 'payments-trend').getByRole('group', { name: /Payments received/ });
      await plot.focus(); await page.keyboard.press('ArrowRight');
      await expect(page.locator(`#${await plot.getAttribute('aria-describedby')}`)).toContainText(trend[0]);
      await page.keyboard.press('Escape');
      await expect(plot).toBeFocused();
    });

    test('Dashboard states across widths, themes, styles and brands', async ({ page }) => {
      test.setTimeout(300_000);
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        for (const [name, organizationId] of [['populated', fx.organizationId], ['new', empty]] as const) {
          await page.goto(`/organizations/${organizationId}/finance`);
          await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
          await page.waitForLoadState('networkidle');
          await fits(page, `${name} ${viewport.name}`);
          await tallShot(page, `dashboard-${name}-${viewport.name}`);
        }
        // The populated header stays one row up to wide desktop; secondary actions move into More below it.
        await page.goto(`/organizations/${fx.organizationId}/finance`);
        await page.waitForLoadState('networkidle');
        expect((await headerTops(page)).length, `${viewport.name} header rows`).toBe(1);
        await expect(page.getByLabel('Reporting month')).toBeVisible();
        if (viewport.name !== 'phone') await expect(page.getByRole('button', { name: 'Customize dashboard' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'New invoice' })).toBeVisible();
        if (viewport.width < 1360) {
          await expect(page.getByRole('button', { name: 'New quote' }).filter({ visible: true })).toHaveCount(0);
          await page.getByRole('button', { name: 'More finance actions' }).click();
          await expect(page.getByRole('menuitem', { name: 'Record payment' })).toBeVisible();
          await expect(page.getByRole('menuitem', { name: 'Payments & currency' })).toBeVisible();
          // On a phone, Customize dashboard is offered here instead of in the header row.
          await expect(page.getByRole('menuitem', { name: 'Customize dashboard' })).toHaveCount(viewport.name === 'phone' ? 1 : 0);
          await page.keyboard.press('Escape');
        } else {
          await expect(page.getByRole('button', { name: 'More finance actions' }).filter({ visible: true })).toHaveCount(0);
          await expect(page.getByRole('button', { name: 'New quote' }).filter({ visible: true })).toHaveCount(1);
        }
      }
      // A secondary action opened from More is the same dialog, and focus returns to More.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/organizations/${fx.organizationId}/finance`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: 'More finance actions' }).click();
      await page.getByRole('menuitem', { name: 'New quote' }).click();
      await expect(page.getByRole('dialog', { name: 'New quote' })).toBeVisible();
      await shot(page, 'quote-dialog-from-more-phone');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'New quote' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'More finance actions' })).toBeFocused();
      // Desktop with the sidebar collapsed: the dashboard container widens and the grid follows it.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/organizations/${fx.organizationId}/finance`);
      await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click();
      await shot(page, 'dashboard-populated-desktop-sidebar-collapsed');
      await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click();
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        try {
          for (const preset of ['minimal', 'layered', 'expressive'] as const) {
            await saveAppearance(owner.db, { preset, appearance: scheme });
            await page.reload();
            await expect(widget(page, 'payments-trend').getByRole('group', { name: /Payments received/ })).toBeVisible();
            await shot(page, `dashboard-${preset}-${scheme}`);
          }
        } finally { await resetAppearance(owner.db); }
      }
      await page.emulateMedia({ colorScheme: 'light' });
      for (const [name, brand] of [['teal', { accent: '#0f766e', secondary: '#7c3aed', highlight: '#f59e0b' }], ['monochrome', { accent: '', secondary: '', highlight: '' }]] as const) {
        await setBrand(owner.db, { organizationId: fx.organizationId, headingFont: 'sans', bodyFont: 'sans', ...brand });
        await page.reload();
        await shot(page, `dashboard-brand-${name}`);
      }
    });

    test('customizing: resize by pointer and keys, move, change presentation, save, isolate per organization, reset', async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      const base = `/organizations/${fx.organizationId}/finance`;
      await page.goto(base);
      await page.waitForLoadState('networkidle');
      // Normal use offers no handles.
      await expect(page.getByRole('button', { name: /^Resize / })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Drag to move/ })).toHaveCount(0);
      await page.getByRole('button', { name: 'Customize dashboard' }).click();
      await expect(page.getByRole('toolbar', { name: 'Customize dashboard' })).toBeVisible();
      // From four columns to eight: narrow it with the button, then drag its handle wider.
      await page.getByRole('button', { name: 'Decrease width of Receivables aging' }).click();
      await expect(widget(page, 'aging')).toHaveAttribute('data-span', '4');
      const handle = page.getByRole('button', { name: /^Resize Receivables aging/ });
      await handle.scrollIntoViewIfNeeded();
      const grid = (await page.locator('[data-dashboard-grid]').boundingBox())!;
      const before = (await widget(page, 'aging').boundingBox())!;
      await page.screenshot({ path: path.join(OUT, 'edit-mode-before-resize.png') });
      const h = (await handle.boundingBox())!;
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(h.x + grid.width / 3, h.y + h.height / 2, { steps: 12 });
      await page.mouse.up();
      await expect(widget(page, 'aging')).toHaveAttribute('data-span', '8');
      const after = (await widget(page, 'aging').boundingBox())!;
      expect(after.width / before.width).toBeGreaterThan(1.8);
      await handle.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, 'edit-mode-after-resize.png') });
      // The keyboard does the same through the handle.
      await handle.focus(); await page.keyboard.press('ArrowRight');
      await expect(widget(page, 'aging')).toHaveAttribute('data-span', '12');
      await page.keyboard.press('ArrowLeft');
      await expect(widget(page, 'aging')).toHaveAttribute('data-span', '8');
      // Move a secondary widget earlier, and draw the trend as bars.
      await page.getByRole('button', { name: 'Move Financial activity earlier' }).click();
      await widget(page, 'payments-trend').getByLabel('Payments received presentation').selectOption('bar');
      const order = () => page.locator('[data-widget-id]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.widgetId));
      const edited = await order();
      expect(edited.indexOf('activity')).toBeLessThan(edited.indexOf('aging'));
      await shot(page, 'edit-mode-edited');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Dashboard layout saved.' })).toBeVisible();
      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(widget(page, 'aging')).toHaveAttribute('data-span', '8');
      expect(await order()).toEqual(edited);
      await expect(widget(page, 'payments-trend').getByLabel('Payments received presentation')).toHaveValue('bar');
      await shot(page, 'saved-layout-desktop');
      // Another organization keeps its own (default) layout; coming back restores this one.
      await page.goto(`/organizations/${second}/finance`);
      await page.waitForLoadState('networkidle');
      await expect(widget(page, 'aging')).toHaveAttribute('data-span', '6');
      await expect(widget(page, 'payments-trend').getByLabel('Payments received presentation')).toHaveValue('line');
      await page.goto(base);
      await page.waitForLoadState('networkidle');
      await expect(widget(page, 'aging')).toHaveAttribute('data-span', '8');
      // Reset returns to the canonical composition.
      await page.getByRole('button', { name: 'Customize dashboard' }).click();
      await page.getByRole('button', { name: 'Reset to default' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'reset to the default' })).toBeVisible();
      await page.reload();
      await page.waitForLoadState('networkidle');
      expect(await order()).toEqual(['overview', 'attention', 'payments-trend', 'aging', 'activity', 'performance', 'invoice-status']);
      await expect(widget(page, 'aging')).toHaveAttribute('data-span', '6');
    });

    test('hiding a secondary widget, cancelling, and editing on a phone without drag handles', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/organizations/${fx.organizationId}/finance`);
      await page.getByRole('button', { name: 'Customize dashboard' }).click();
      await expect(page.getByRole('button', { name: 'Hide Financial overview' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Hide Invoices by status' }).click();
      await expect(widget(page, 'invoice-status')).toHaveCount(0);
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(widget(page, 'invoice-status')).toHaveCount(1);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: 'More finance actions' }).click();
      await page.getByRole('menuitem', { name: 'Customize dashboard' }).click();
      await expect(page.getByRole('toolbar', { name: 'Customize dashboard' })).toContainText('every widget is full width on this screen');
      await expect(page.getByRole('button', { name: /^Resize / })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Drag to move/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Move Financial activity earlier' })).toBeVisible();
      await fits(page, 'phone edit mode');
      await shot(page, 'edit-mode-phone');
      await page.getByRole('button', { name: 'Cancel' }).click();
    });

    test('the invoice inspector keeps the collection, follows Back and Forward, and records through the dialog', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const view = `/organizations/${fx.organizationId}/finance/invoices?status=outstanding&sort=due`;
      await page.goto(view);
      const preview = page.getByRole('link', { name: 'Preview invoice #1' }).filter({ visible: true });
      await preview.click();
      await expect(page).toHaveURL(/invoice=/);
      const drawer = page.getByRole('dialog', { name: 'Invoice #1' }).or(page.getByRole('complementary').filter({ hasText: 'Invoice #1' })).first();
      await expect(page.getByRole('heading', { name: 'Invoice #1', exact: true })).toBeVisible();
      const invoice = (await getInvoiceForWorkItem(owner.db, { organizationId: fx.organizationId, workItemId: fx.work.overdueA }))!;
      await expect(page.getByLabel('Payment history').first()).toContainText('Correction');
      await expect(page.getByText('not confirmed by a payment processor')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Open full record' })).toHaveAttribute('href', `/organizations/${fx.organizationId}/work/${fx.work.overdueA}?tab=financials`);
      await shot(page, 'invoice-inspector-desktop');
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`status=outstanding&sort=due$`));
      await expect(page.getByRole('heading', { name: 'Invoice #1', exact: true })).toHaveCount(0);
      await page.goForward();
      await expect(page.getByRole('heading', { name: 'Invoice #1', exact: true })).toBeVisible();
      // Record through the approved dialog, from the inspector.
      await page.getByRole('button', { name: 'Record payment', exact: true }).last().click();
      const dialog = page.getByRole('dialog', { name: 'Record payment' });
      await dialog.getByLabel('Amount (CAD)').fill('-3');
      await expect(dialog.getByRole('button', { name: 'Record payment' })).toBeDisabled();
      await dialog.getByLabel('Amount (CAD)').fill('12.34');
      await dialog.getByRole('button', { name: 'Record payment' }).click();
      await expect(dialog.getByRole('status')).toContainText('Payment recorded.');
      await dialog.getByRole('button', { name: 'Done' }).click();
      const updated = (await getInvoiceForWorkItem(owner.db, { organizationId: fx.organizationId, workItemId: fx.work.overdueA }))!;
      // Append-only: every earlier entry is still there, plus the new receipt (listed in received-date order).
      expect(updated.payments.map(payment => payment.amountMinor).sort((a, b) => a - b)).toEqual([...invoice.payments.map(payment => payment.amountMinor), 1234].sort((a, b) => a - b));
      // Closing returns to the same filtered view with focus on the row's Preview control.
      await page.getByRole('button', { name: 'Close' }).last().click();
      await expect(page).toHaveURL(new RegExp(`status=outstanding&sort=due$`));
      await expect(preview).toBeFocused();
      void drawer;
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${view}&invoice=${fx.invoices.overdueA}`);
      await expect(page.getByRole('heading', { name: 'Invoice #1', exact: true })).toBeVisible();
      await fits(page, 'inspector phone');
      await shot(page, 'invoice-inspector-phone');
    });
  });

  test.describe('reduced-role colleague', () => {
    test.use({ storageState: COLLEAGUE_STORAGE_STATE });
    test('sees counts but no amount charts, cannot open another business’s invoice, and is offered no payment action', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const own = loadDemoContext().organizationId;
      await page.goto(`/organizations/${own}/finance`);
      await expect(widget(page, 'invoice-status')).toBeVisible();
      for (const id of ['payments-trend', 'aging', 'performance']) await expect(widget(page, id)).toHaveCount(0);
      await expect(page.getByText('Payments received')).toHaveCount(0);
      await fits(page, 'restricted dashboard');
      await shot(page, 'dashboard-restricted-desktop');
      // An invoice of another business is simply not there.
      await page.goto(`/organizations/${own}/finance/invoices?invoice=${fx.invoices.overdueA}`);
      await expect(page.getByRole('heading', { name: /^Invoice #/ })).toHaveCount(0);
      const ownInvoice = (await readFinanceInvoices(owner.db, own, { status: 'overdue' })).rows[0];
      await page.goto(`/organizations/${own}/finance/invoices?invoice=${ownInvoice.id}`);
      await expect(page.getByRole('heading', { name: `Invoice #${ownInvoice.number}`, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /Record (payment|correction)/ })).toHaveCount(0);
    });
  });
});
