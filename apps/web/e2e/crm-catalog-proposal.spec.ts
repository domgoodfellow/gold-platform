import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { guardedShot } from './visual-guard';
import { OWNER_STORAGE_STATE } from './helpers';
import { populateFinanceBusiness, provisionFinanceBusiness, signInOwner, type FinanceFixture } from './finance-fixtures';
import { getCommercialProposal, listCommercialProposals } from '../lib/domain/customers/commercial-proposals';
import { listContacts } from '../lib/domain/contacts/contacts';
import { getInvoice, invoiceStanding, issueInvoiceFromProposal, listInvoicesForProposals } from '../lib/domain/billing/invoices';
import { listProposalInvites } from '../lib/domain/customers/proposal-invites';
import { updatePriceBookItem } from '../lib/domain/pricing/price-book';
import { chooseOption, optionTexts } from './select-field';

/**
 * A commercial proposal built from an ordinary business's own catalog, in a real browser against
 * the isolated run (ADR-051, second slice). The business is not GildOps: it is provisioned here
 * with no platform authority. The owner builds a version from catalog items in CRM → contact →
 * Sales → Commercial proposals, sends it and makes a link; the catalog price then changes; the
 * customer opens the link and accepts. Every step is checked against the database: the accepted
 * version keeps the price it was sent at, and nothing is invoiced or handed off. The owner then
 * invoices the accepted version from CRM: the invoice carries the accepted prices, appears in
 * Finance and the customer's history, Create invoice becomes View invoice, a second issuance is
 * refused, and no payment or hand-off follows. Screenshots at
 * phone, tablet and desktop width go to `.artifacts/crm-catalog-proposal/current`.
 */
const OUT = path.join(__dirname, '..', '..', '..', '.artifacts', 'crm-catalog-proposal', 'current');
const VIEWPORTS = [{ name: 'phone', width: 390, height: 844 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'desktop', width: 1440, height: 900 }] as const;
const fits = async (page: Page, label: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label} scrolls sideways`).toBe(true);

let owner: { db: SupabaseClient; userId: string; ownerEmail: string };
let fx: FinanceFixture;
let customerId: string;
let proposalId: string;
let token: string;
let baseline: { invoices: number; handoffs: number; payments: number };

const commercialPath = () => `/organizations/${fx.organizationId}/crm/contacts/${customerId}?section=sales&view=commercial`;

async function counts() {
  const pg = new Client(process.env.SUPABASE_DB_URL!);
  await pg.connect();
  try {
    const { rows } = await pg.query(
      `select (select count(*) from public.invoices where organization_id = $1 and customer_id = $2)::int as invoices,
              (select count(*) from public.customer_proposal_handoffs where organization_id = $1)::int as handoffs,
              (select count(*) from public.payments where organization_id = $1)::int as payments`,
      [fx.organizationId, customerId],
    );
    return rows[0] as { invoices: number; handoffs: number; payments: number };
  } finally {
    await pg.end();
  }
}

test.describe.serial('CRM catalog proposals', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    owner = await signInOwner();
    const organizationId = await provisionFinanceBusiness(owner, `Catalog proposal ${Date.now().toString(36)}`);
    fx = await populateFinanceBusiness(owner.db, organizationId);
    customerId = (await listContacts(owner.db, { organizationId, search: 'Vertex HVAC', limit: 1 }))[0].id;
    baseline = await counts();
  });

  test.describe('seller', () => {
    test.use({ storageState: OWNER_STORAGE_STATE });

    test('builds a version from catalog items, sends it and makes a link for this customer', async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(VIEWPORTS[2]);
      await page.goto(commercialPath());
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { name: 'Commercial proposal' })).toBeVisible();
      // An ordinary business: the GildOps discovery and configuration views are not offered.
      await expect(page.getByRole('link', { name: 'Discovery', exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Proposed configuration', exact: true })).toHaveCount(0);
      // Only items in the business currency are offered; the USD item is not.
      expect((await optionTexts(main.getByLabel('Item 1', { exact: true }))).some(text => text.includes('Cross-border consultation'))).toBe(false);

      await chooseOption(main.getByLabel('Item 1', { exact: true }), { label: 'Labour — CA$95.50 / hour' });
      await main.getByLabel('Quantity 1', { exact: true }).fill('3');
      await main.getByRole('button', { name: 'Add line' }).click();
      await chooseOption(main.getByLabel('Item 2', { exact: true }), { label: 'Filter replacement — CA$38.25 / each' });
      await main.getByLabel('Quantity 2', { exact: true }).fill('2');
      await main.getByLabel('Notes', { exact: true }).fill('Spring service, parts included.');
      // 3 × 95.50 + 2 × 38.25.
      await expect(main.getByText(/Total at today’s catalog prices: CA\$363\.00/)).toBeVisible();
      await main.getByRole('button', { name: 'Build proposal' }).click();
      await expect(main.getByText('Labour — 3 hour × CA$95.50 = CA$286.50')).toBeVisible();

      const [built] = await listCommercialProposals(owner.db, { organizationId: fx.organizationId, customerId });
      expect(built).toMatchObject({ basis: 'catalog', status: 'draft', version: 1, planId: null, catalogTotalMinor: 36_300, notes: 'Spring service, parts included.' });
      expect(built.lines.map((line) => [line.name, line.quantity, line.unitAmountMinor, line.amountMinor])).toEqual([['Labour', 3, 9_550, 28_650], ['Filter replacement', 2, 3_825, 7_650]]);
      proposalId = built.id;

      await main.getByRole('button', { name: 'Mark sent' }).click();
      await expect(main.getByText('sent', { exact: true })).toBeVisible();
      await main.getByRole('button', { name: 'Create a link' }).click();
      await expect(main.getByRole('link', { name: /\/proposal\// })).toBeVisible();

      const invites = await listProposalInvites(owner.db, { organizationId: fx.organizationId, customerId });
      expect(invites).toHaveLength(1);
      token = invites[0].token;
      await expect(main.getByRole('link', { name: new RegExp(`/proposal/${token}$`) })).toBeVisible();
      expect(await counts()).toEqual(baseline);
    });
  });

  test.describe('customer', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('reviews the version as sent after a catalog price change, and accepts it', async ({ page }) => {
      test.setTimeout(150_000);
      await updatePriceBookItem(owner.db, { id: fx.prices.labour, name: 'Labour', unit: 'hour', unitAmountMinor: 12_000 });

      await page.setViewportSize(VIEWPORTS[0]);
      await page.goto(`/proposal/${token}`);
      await expect(page).toHaveURL(/\/proposal$/);
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { name: 'Proposal', exact: true })).toBeVisible();
      // A catalog proposal shows its terms, not GildOps discovery or configuration.
      await expect(main.getByRole('heading', { name: 'What we understood' })).toHaveCount(0);
      await expect(main.getByText('3 hour × CA$95.50 = CA$286.50')).toBeVisible();
      await expect(main.getByText('CA$120.00')).toHaveCount(0);
      await expect(main.getByText('CA$363.00')).toBeVisible();

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await fits(page, `proposal ${viewport.name}`);
        await page.screenshot({ path: path.join(OUT, `customer-review-${viewport.name}.png`), fullPage: true });
      }

      await main.getByRole('button', { name: 'Accept' }).click();
      await expect(main.getByText(/Accepted .*Nothing has been charged\./)).toBeVisible();

      const accepted = await getCommercialProposal(owner.db, { organizationId: fx.organizationId, proposalId });
      expect(accepted).toMatchObject({ status: 'accepted', catalogTotalMinor: 36_300 });
      expect(accepted!.lines.map((line) => [line.name, line.quantity, line.unitAmountMinor])).toEqual([['Labour', 3, 9_550], ['Filter replacement', 2, 3_825]]);
      expect(await counts()).toEqual(baseline);
    });
  });

  test.describe('seller after acceptance', () => {
    test.use({ storageState: OWNER_STORAGE_STATE });

    test('sees the accepted version unchanged at every width, with no hand-off and nothing invoiced', async ({ page }) => {
      test.setTimeout(120_000);
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(commercialPath());
        const main = page.getByRole('main');
        await expect(main.getByText('accepted', { exact: true })).toBeVisible();
        await expect(main.getByText(/The customer agreed to this version at these prices\. Nothing has been invoiced or charged\./)).toBeVisible();
        await expect(main.getByText('Labour — 3 hour × CA$95.50 = CA$286.50')).toBeVisible();
        await expect(main.getByRole('button', { name: 'Create this business in GildOps' })).toHaveCount(0);
        // The builder now offers today's price for a new version.
        await expect.poll(async () => (await optionTexts(main.getByLabel('Item 1', { exact: true }))).filter(text => text.includes('Labour — CA$120.00 / hour')).length).toBe(1);
        await fits(page, `seller ${viewport.name}`);
        await guardedShot(page, { url: new RegExp(`^/organizations/${fx.organizationId}/`), content: main.getByRole('heading', { name: 'Commercial proposal' }) }, { path: path.join(OUT, `seller-accepted-${viewport.name}.png`), fullPage: true });
      }
      expect(await counts()).toEqual(baseline);
    });
  });

  test.describe('seller invoicing the accepted version', () => {
    test.use({ storageState: OWNER_STORAGE_STATE });

    test('creates one invoice at the accepted prices, sees it in Finance and history, and cannot issue it twice', async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize(VIEWPORTS[2]);
      await page.goto(commercialPath());
      const main = page.getByRole('main');
      await main.getByRole('button', { name: 'Create invoice from version 1' }).click();
      const dialog = page.getByRole('dialog', { name: 'New invoice' });
      // The accepted snapshot, not today's CA$120.00, and nothing to edit but dates.
      await expect(dialog.getByLabel('Invoice total')).toHaveText(/CA\$363\.00/);
      await expect(dialog.getByText('CA$120.00')).toHaveCount(0);
      await expect(dialog.getByRole('combobox')).toHaveCount(0);
      await expect(dialog.getByRole('spinbutton')).toHaveCount(0);
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await fits(page, `invoice review ${viewport.name}`);
        await page.screenshot({ path: path.join(OUT, `invoice-review-${viewport.name}.png`), fullPage: true });
      }
      await page.setViewportSize(VIEWPORTS[2]);
      await dialog.getByRole('button', { name: 'Continue' }).click();
      await dialog.getByRole('button', { name: 'Issue invoice' }).click();
      await expect(dialog.getByRole('status')).toContainText(/Invoice #\d+ issued/);

      const invoiced = await listInvoicesForProposals(owner.db, { organizationId: fx.organizationId, proposalIds: [proposalId] });
      const invoiceId = invoiced[proposalId].id;
      const invoice = (await getInvoice(owner.db, { organizationId: fx.organizationId, invoiceId }))!;
      expect(invoice).toMatchObject({ source: 'proposal', proposalId, workItemId: null, customerId });
      expect(invoice.lines.map((line) => [line.description, line.quantity, line.unitAmountMinor])).toEqual([['Labour', 3, 9_550], ['Filter replacement', 2, 3_825]]);
      expect(invoiceStanding(invoice)).toMatchObject({ total: { totalMinor: 36_300 }, paidMinor: 0 });
      expect(await counts()).toEqual({ ...baseline, invoices: baseline.invoices + 1 });

      // Finance: listed as a proposal invoice, inspected with a way back to the proposal.
      await dialog.getByRole('link', { name: 'Open invoice' }).click();
      await expect(page).toHaveURL(new RegExp(`/finance/invoices\\?invoice=${invoiceId}`));
      const drawer = page.getByRole('dialog', { name: `Invoice #${invoice.number}` });
      await expect(drawer.getByText('Proposal', { exact: true })).toBeVisible();
      await expect(drawer.getByRole('link', { name: 'Open Work record' })).toHaveCount(0);
      await expect(drawer.getByRole('link', { name: 'Open proposal' })).toHaveAttribute('href', commercialPath());
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await fits(page, `inspector ${viewport.name}`);
        await page.screenshot({ path: path.join(OUT, `proposal-invoice-inspector-${viewport.name}.png`), fullPage: true });
      }
      await page.setViewportSize(VIEWPORTS[2]);
      await page.goto(`/organizations/${fx.organizationId}/finance/invoices`);
      await expect(page.getByRole('main').getByRole('link', { name: `#${invoice.number}`, exact: true })).toHaveAttribute('href', `/organizations/${fx.organizationId}/finance/invoices?invoice=${invoiceId}`);

      // Customer history.
      await page.goto(`/organizations/${fx.organizationId}/crm/contacts/${customerId}?section=sales&view=invoices`);
      await expect(page.getByRole('main').getByRole('link', { name: `Invoice #${invoice.number}` })).toHaveAttribute('href', `/organizations/${fx.organizationId}/finance/invoices?invoice=${invoiceId}`);

      // CRM: View invoice replaces Create invoice, at every width.
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(commercialPath());
        await expect(main.getByText(`Invoiced as #${invoice.number}.`)).toBeVisible();
        await expect(main.getByRole('link', { name: 'View invoice' })).toHaveAttribute('href', `/organizations/${fx.organizationId}/finance/invoices?invoice=${invoiceId}`);
        await expect(main.getByRole('button', { name: /^Create invoice/ })).toHaveCount(0);
        await fits(page, `seller invoiced ${viewport.name}`);
        await guardedShot(page, { url: new RegExp(`^/organizations/${fx.organizationId}/`), content: main.getByRole('heading', { name: 'Commercial proposal' }) }, { path: path.join(OUT, `seller-invoiced-${viewport.name}.png`), fullPage: true });
      }

      // A second issuance under a fresh key is refused, and nothing else was set in motion.
      await expect(issueInvoiceFromProposal(owner.db, { proposalId, issuanceKey: crypto.randomUUID() })).rejects.toMatchObject({ code: 'invoices.proposal_already_invoiced' });
      expect(await counts()).toEqual({ ...baseline, invoices: baseline.invoices + 1 });
    });
  });
});
