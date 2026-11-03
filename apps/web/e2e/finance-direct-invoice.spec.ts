import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { guardedShot } from './visual-guard';
import { COLLEAGUE_STORAGE_STATE, OWNER_STORAGE_STATE, loadDemoContext } from './helpers';
import { populateFinanceBusiness, provisionFinanceBusiness, signInOwner, type FinanceFixture } from './finance-fixtures';
import { getInvoice, getInvoiceForWorkItem, invoiceStanding } from '../lib/domain/billing/invoices';
import { readFinanceInvoices } from '../lib/domain/billing/finance-reads';
import { listContacts } from '../lib/domain/contacts/contacts';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { chooseOption } from './select-field';

/**
 * Invoicing a customer directly from catalog items, in a real browser against the isolated run
 * (ADR-051, first slice). One populated business this spec provisions and records for teardown.
 * The owner issues a direct invoice through the ordinary New invoice dialog, inspects it, records a
 * payment against it and still invoices priced Work the existing way; every step is checked against
 * the database. Screenshots at phone, tablet and desktop width go to `.artifacts/finance-direct-invoice/current`.
 */
const OUT = path.join(__dirname, '..', '..', '..', '.artifacts', 'finance-direct-invoice', 'current');
const VIEWPORTS = [{ name: 'phone', width: 390, height: 844 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'desktop', width: 1440, height: 900 }] as const;
const ours = () => new RegExp(`^/organizations/(${[fx?.organizationId, loadDemoContext().organizationId].filter(Boolean).join('|')})(/|[?#]|$)`);
const shot = (page: Page, name: string) => guardedShot(page, { url: ours(), content: page.getByRole('dialog').or(page.getByRole('main').getByRole('heading', { level: 1 })).first() }, { path: path.join(OUT, `${name}.png`), fullPage: true });
const fits = async (page: Page, label: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label} scrolls sideways`).toBe(true);
/** A record choice is a whole row; a person clicks the row, not the hidden radio inside it. */
const choose = (scope: ReturnType<Page['getByRole']>, name: RegExp) => scope.locator('label').filter({ has: scope.page().getByRole('radio', { name }) }).click();

let owner: { db: SupabaseClient; userId: string; ownerEmail: string };
let fx: FinanceFixture;
let customerId: string;
let directInvoiceId: string;

/** Opens New invoice from Finance → Invoices, chooses the catalog route and a customer. */
async function startDirectInvoice(page: Page) {
  await page.goto(`/organizations/${fx.organizationId}/finance/invoices`);
  await page.getByRole('main').getByRole('button', { name: 'New invoice' }).click();
  const dialog = page.getByRole('dialog', { name: 'New invoice' });
  await choose(dialog, /A customer, from catalog items/);
  await choose(dialog, /Vertex HVAC/);
  await expect(dialog.getByText('Invoiced directly, with no Work item')).toBeVisible();
  return dialog;
}

test.describe.serial('Finance direct invoices', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    owner = await signInOwner();
    const organizationId = await provisionFinanceBusiness(owner, `Finance direct ${Date.now().toString(36)}`);
    fx = await populateFinanceBusiness(owner.db, organizationId);
    customerId = (await listContacts(owner.db, { organizationId, search: 'Vertex HVAC', limit: 1 }))[0].id;
    await setModuleEnabled(owner.db, { organizationId: loadDemoContext().organizationId, key: 'billing', enabled: true });
  });

  test.describe('owner', () => {
    test.use({ storageState: OWNER_STORAGE_STATE });

    test('issues an invoice to a customer from catalog items, priced by the catalog', async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(VIEWPORTS[2]);
      const dialog = await startDirectInvoice(page);
      await chooseOption(dialog.getByLabel('Item 1', { exact: true }), { label: 'Labour · CA$95.50 / hour' });
      await dialog.getByLabel('Quantity', { exact: true }).fill('2');
      await dialog.getByRole('button', { name: 'Add item' }).click();
      await chooseOption(dialog.getByLabel('Item 2', { exact: true }), { label: 'Filter replacement · CA$38.25 / each' });
      await dialog.getByLabel('Quantity', { exact: true }).nth(1).fill('3');
      // 2 × 95.50 + 3 × 38.25.
      await expect(dialog.getByLabel('Invoice total')).toContainText('CA$305.75');
      await shot(page, 'direct-review-desktop');
      await dialog.getByRole('button', { name: 'Continue' }).click();
      await expect(dialog.getByRole('group', { name: 'Confirmation' })).toContainText('Issue invoice to Vertex HVAC?');
      await expect(dialog.getByRole('group', { name: 'Confirmation' })).toContainText('not attached to any Work item');
      await dialog.getByRole('button', { name: 'Issue invoice' }).click();
      await expect(dialog.getByRole('status')).toContainText(/Invoice #\d+ issued/);

      const { rows } = await readFinanceInvoices(owner.db, fx.organizationId, { customer: customerId });
      const direct = rows.find((row) => row.source === 'direct');
      expect(direct).toMatchObject({ workItemId: null, billedTo: 'Vertex HVAC', total: { totalMinor: 30_575, currency: 'CAD' } });
      directInvoiceId = direct!.id;
      const invoice = await getInvoice(owner.db, { organizationId: fx.organizationId, invoiceId: directInvoiceId });
      expect(invoice!.lines.map((line) => [line.description, line.unitAmountMinor, line.quantity])).toEqual([['Labour', 9_550, 2], ['Filter replacement', 3_825, 3]]);

      await dialog.getByRole('link', { name: 'Open invoice' }).click();
      await expect(page).toHaveURL(new RegExp(`/finance/invoices\\?invoice=${directInvoiceId}`));
      const drawer = page.getByRole('dialog', { name: `Invoice #${invoice!.number}` });
      await expect(drawer.getByText('Direct, from catalog items')).toBeVisible();
      await expect(drawer.getByRole('link', { name: 'Open Work record' })).toHaveCount(0);
    });

    test('is inspected, listed and paid without any Work association, at every width', async ({ page }) => {
      test.setTimeout(150_000);
      const invoice = (await getInvoice(owner.db, { organizationId: fx.organizationId, invoiceId: directInvoiceId }))!;
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(`/organizations/${fx.organizationId}/finance/invoices?invoice=${directInvoiceId}`);
        const drawer = page.getByRole('dialog', { name: `Invoice #${invoice.number}` });
        await expect(drawer.getByText('Direct, from catalog items')).toBeVisible();
        await expect(drawer.getByText('Filter replacement')).toBeVisible();
        await fits(page, `inspector ${viewport.name}`);
        await shot(page, `direct-inspector-${viewport.name}`);
      }
      await page.setViewportSize(VIEWPORTS[2]);
      await page.goto(`/organizations/${fx.organizationId}/finance/invoices`);
      const link = page.getByRole('main').getByRole('link', { name: `#${invoice.number}`, exact: true });
      await expect(link).toHaveAttribute('href', `/organizations/${fx.organizationId}/finance/invoices?invoice=${directInvoiceId}`);
      await expect(page.getByRole('main').getByRole('link', { name: /\/work\/null|undefined/ })).toHaveCount(0);

      await page.goto(`/organizations/${fx.organizationId}/finance/invoices?invoice=${directInvoiceId}`);
      await page.getByRole('dialog', { name: `Invoice #${invoice.number}` }).getByRole('button', { name: 'Record payment' }).click();
      const pay = page.getByRole('dialog', { name: 'Record payment' });
      await expect(pay.getByText(`Invoice #${invoice.number}`)).toBeVisible();
      await pay.getByLabel('Amount (CAD)').fill('100.00');
      await pay.getByRole('button', { name: 'Record payment' }).click();
      await expect(pay.getByRole('status')).toContainText('Payment recorded.');
      const paid = (await getInvoice(owner.db, { organizationId: fx.organizationId, invoiceId: directInvoiceId }))!;
      expect(invoiceStanding(paid)).toMatchObject({ paidMinor: 10_000, outstandingMinor: 20_575 });

      await page.goto(`/organizations/${fx.organizationId}/finance/payments`);
      const paymentLink = page.getByRole('main').getByRole('link', { name: `#${invoice.number}`, exact: true }).first();
      await expect(paymentLink).toHaveAttribute('href', `/organizations/${fx.organizationId}/finance/invoices?invoice=${directInvoiceId}`);

      await page.goto(`/organizations/${fx.organizationId}/crm/contacts/${customerId}?section=sales&view=invoices`);
      const history = page.getByRole('main').getByRole('link', { name: `Invoice #${invoice.number}` });
      await expect(history).toHaveAttribute('href', `/organizations/${fx.organizationId}/finance/invoices?invoice=${directInvoiceId}`);
    });

    test('composes the catalog dialog at phone, tablet and desktop width', async ({ page }) => {
      test.setTimeout(150_000);
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        const dialog = await startDirectInvoice(page);
        await chooseOption(dialog.getByLabel('Item 1', { exact: true }), { label: 'Service visit · CA$145.00 / visit' });
        await expect(dialog.getByLabel('Invoice total')).toContainText('CA$145.00');
        await fits(page, `dialog ${viewport.name}`);
        await shot(page, `direct-dialog-${viewport.name}`);
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        const discard = page.getByRole('button', { name: /Discard/ });
        if (await discard.isVisible().catch(() => false)) await discard.click();
      }
    });

    test('still invoices priced Work the existing way', async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(VIEWPORTS[2]);
      await page.goto(`/organizations/${fx.organizationId}/finance/invoices`);
      await page.getByRole('main').getByRole('button', { name: 'New invoice' }).click();
      const dialog = page.getByRole('dialog', { name: 'New invoice' });
      await expect(dialog.getByRole('radio', { name: /Priced Work/ })).toBeChecked();
      await choose(dialog, /Heat pump estimate/);
      await dialog.getByRole('button', { name: 'Continue' }).click();
      await dialog.getByRole('button', { name: 'Issue invoice' }).click();
      await expect(dialog.getByRole('status')).toContainText(/Invoice #\d+ issued/);
      const invoice = await getInvoiceForWorkItem(owner.db, { organizationId: fx.organizationId, workItemId: fx.work.quoted });
      expect(invoice).toMatchObject({ source: 'work_item', workItemId: fx.work.quoted });
      await page.goto(`/organizations/${fx.organizationId}/finance/invoices`);
      await expect(page.getByRole('main').getByRole('link', { name: `#${invoice!.number}`, exact: true })).toHaveAttribute('href', `/organizations/${fx.organizationId}/work/${fx.work.quoted}?tab=financials`);
    });
  });

  test.describe('reduced-role colleague', () => {
    test.use({ storageState: COLLEAGUE_STORAGE_STATE });

    test('is offered New invoice exactly when their role holds invoice.issue', async ({ page }) => {
      const { organizationId } = loadDemoContext();
      const pg = new Client(process.env.SUPABASE_DB_URL!);
      await pg.connect();
      const { rows } = await pg.query<{ capabilities: string[] }>(
        `select r.capabilities from public.memberships m join auth.users u on u.id = m.user_id join public.roles r on r.id = m.role_id
          where m.organization_id = $1 and u.email like 'isolated-colleague-%'`,
        [organizationId],
      ).finally(() => pg.end());
      expect(rows).toHaveLength(1);
      await page.goto(`/organizations/${organizationId}/finance/invoices`);
      await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Invoices' })).toBeVisible();
      await expect(page.getByRole('main').getByRole('button', { name: 'New invoice' })).toHaveCount(rows[0].capabilities.includes('invoice.issue') ? 1 : 0);
    });
  });
});
