import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { definePDFJSModule, extractText, getDocumentProxy } from 'unpdf';
import { OWNER_STORAGE_STATE } from './helpers';
import { populateFinanceBusiness, provisionFinanceBusiness, signInOwner, type FinanceFixture } from './finance-fixtures';
import { issueDirectInvoice } from '../lib/domain/billing/invoices';
import { setBrand, uploadLogo } from '../lib/domain/branding/brand';
import { listContacts } from '../lib/domain/contacts/contacts';
import { createCustomer } from '../lib/domain/customers/customers';
import { createPortalInvite } from '../lib/domain/portal/portal';
import { listPriceBookItems } from '../lib/domain/pricing/price-book';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';

/**
 * Branded invoice documents in a real browser against the production build (Work Order 2G). The
 * business is an ordinary one, not GildOps, with its own legal identity, colour, fonts and logo.
 * The owner previews a draft from the invoice dialog — stamped DRAFT, nothing issued — issues the
 * invoice, and downloads its PDF from the invoice. The business then changes its branding and name;
 * the same PDF downloads again. The invoice's customer downloads those same bytes from the portal;
 * another customer's invoice is refused to them, and a signed-out request is refused. Screenshots
 * at phone, tablet and desktop width go to `.artifacts/invoice-documents/current`.
 */
const OUT = path.join(__dirname, '..', '..', '..', '.artifacts', 'invoice-documents', 'current');
const VIEWPORTS = [{ name: 'phone', width: 390, height: 844 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'desktop', width: 1440, height: 900 }] as const;
const fits = async (page: Page, label: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label} scrolls sideways`).toBe(true);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const choose = (scope: ReturnType<Page['getByRole']>, name: RegExp) => scope.locator('label').filter({ has: scope.page().getByRole('radio', { name }) }).click();
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function pdfText(bytes: Uint8Array): Promise<string> {
  await definePDFJSModule(() => import('unpdf/pdfjs'));
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
  return (text as string).replace(/\s+/g, ' ');
}

async function sql<T = Record<string, unknown>>(query: string, args: unknown[] = []): Promise<T[]> {
  const pg = new Client(process.env.SUPABASE_DB_URL!);
  await pg.connect();
  try { return (await pg.query(query, args)).rows as T[]; } finally { await pg.end(); }
}

let owner: { db: SupabaseClient; userId: string; ownerEmail: string };
let fx: FinanceFixture;
let customerId: string;
let invoiceId: string;
let invoiceNumber: number;
let issuedSha: string;
let neighbourInvoiceId: string;
let portalToken: string;

test.describe.serial('Invoice documents', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    owner = await signInOwner();
    const organizationId = await provisionFinanceBusiness(owner, `Invoice documents ${Date.now().toString(36)}`);
    fx = await populateFinanceBusiness(owner.db, organizationId);
    customerId = (await listContacts(owner.db, { organizationId, search: 'Vertex HVAC', limit: 1 }))[0].id;
    await sql(
      `insert into public.organization_identity(organization_id,legal_name,address_line1,city,region,postal_code,country_code,contact_email,updated_by)
       values($1,'Northwind Mechanical Inc.','88 Rue Saint-Paul','Montréal','QC','H2Y 1H3','CA','billing@northwind.example',$2)
       on conflict (organization_id) do update set legal_name = excluded.legal_name, address_line1 = excluded.address_line1, city = excluded.city`,
      [organizationId, owner.userId],
    );
    await setBrand(owner.db, { organizationId, accent: '#0b7a5c', headingFont: 'serif', bodyFont: 'sans' });
    await uploadLogo(owner.db, { organizationId, file: new File([PNG], 'logo.png', { type: 'image/png' }) });
    await setModuleEnabled(owner.db, { organizationId, key: 'portal', enabled: true });
    await sql(
      `insert into public.organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note)
       values($1,'module:portal','2020-01-01','9999-12-31',1,0,'CAD',$2,'invoice documents browser verification')`,
      [organizationId, owner.userId],
    );
    // Another customer of the same business, with an invoice issued outside the dialog (so with no PDF yet), that Vertex HVAC must never reach.
    const neighbour = await createCustomer(owner.db, { organizationId, name: 'Harbour Neighbour' });
    const labour = (await listPriceBookItems(owner.db, { organizationId })).find((item) => item.name === 'Labour')!;
    neighbourInvoiceId = await issueDirectInvoice(owner.db, { organizationId, customerId: neighbour, lines: [{ priceBookItemId: labour.id, quantity: 1 }], issuedAt: null, dueAt: null, issuanceKey: crypto.randomUUID() });
    portalToken = await createPortalInvite(owner.db, { customerId });
  });

  test.describe('seller', () => {
    test.use({ storageState: OWNER_STORAGE_STATE });

    test('previews a draft, issues the invoice and downloads its PDF', async ({ page }) => {
      test.setTimeout(180_000);
      const before = (await sql<{ n: number }>(`select count(*)::int n from public.invoices where organization_id = $1`, [fx.organizationId]))[0].n;
      await page.setViewportSize(VIEWPORTS[2]);
      await page.goto(`/organizations/${fx.organizationId}/finance/invoices`);
      await page.getByRole('main').getByRole('button', { name: 'New invoice' }).click();
      const dialog = page.getByRole('dialog', { name: 'New invoice' });
      await choose(dialog, /A customer, from catalog items/);
      await choose(dialog, /Vertex HVAC/);
      await dialog.getByLabel('Item 1', { exact: true }).selectOption({ label: 'Labour · CA$95.50 / hour' });
      await dialog.getByLabel('Quantity', { exact: true }).fill('3');

      await dialog.getByRole('button', { name: 'Preview document' }).click();
      const open = dialog.getByRole('link', { name: /Open draft preview/ });
      await expect(open).toBeVisible();
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await fits(page, `draft preview ${viewport.name}`);
        await page.screenshot({ path: path.join(OUT, `draft-preview-${viewport.name}.png`) });
      }
      await page.setViewportSize(VIEWPORTS[2]);
      const draft = Buffer.from(await page.evaluate(async (href) => {
        const bytes = new Uint8Array(await (await fetch(href)).arrayBuffer());
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary);
      }, (await open.getAttribute('href'))!), 'base64');
      const draftText = await pdfText(draft);
      for (const expected of ['DRAFT', 'Draft invoice', 'Assigned on issue', 'Northwind Mechanical Inc.', '88 Rue Saint-Paul', 'Montréal QC H2Y 1H3', 'Vertex HVAC', 'Labour (hour)', 'CA$286.50']) expect(draftText).toContain(expected);
      expect((await sql<{ n: number }>(`select count(*)::int n from public.invoices where organization_id = $1`, [fx.organizationId]))[0].n).toBe(before);

      await dialog.getByRole('button', { name: 'Continue' }).click();
      await dialog.getByRole('button', { name: 'Issue invoice' }).click();
      await expect(dialog.getByText(/Invoice #\d+ issued/)).toBeVisible();
      await expect(dialog.getByText(/PDF was not created/)).toHaveCount(0);
      const [issued] = await sql<{ id: string; number: number }>(`select id, number from public.invoices where organization_id = $1 and customer_id = $2 order by number desc limit 1`, [fx.organizationId, customerId]);
      invoiceId = issued.id;
      invoiceNumber = issued.number;
      const [record] = await sql<{ sha256: string; storage_path: string }>(`select sha256, storage_path from public.invoice_documents where invoice_id = $1`, [invoiceId]);
      expect(record.storage_path).toMatch(new RegExp(`^${fx.organizationId}/invoices/${invoiceId}/invoice-standard-1-[0-9a-f-]+\\.pdf$`));
      issuedSha = record.sha256;

      await dialog.getByRole('link', { name: 'Open invoice' }).click();
      const drawer = page.getByRole('dialog', { name: `Invoice #${invoiceNumber}` });
      const downloadLink = drawer.getByRole('link', { name: 'Download PDF' });
      await expect(downloadLink).toBeVisible();
      const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
      expect(download.suggestedFilename()).toBe(`invoice-${invoiceNumber}.pdf`);
      const bytes = readFileSync((await download.path())!);
      expect(sha(bytes)).toBe(issuedSha);
      const text = await pdfText(bytes);
      for (const expected of [`#${invoiceNumber}`, 'Northwind Mechanical Inc.', 'Vertex HVAC', 'Labour (hour)', '3', 'CA$95.50', 'CA$286.50', 'Payment status on']) expect(text).toContain(expected);
      expect(text).not.toContain('DRAFT');
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await expect(downloadLink).toBeVisible();
        await fits(page, `invoice drawer ${viewport.name}`);
        await page.screenshot({ path: path.join(OUT, `invoice-drawer-${viewport.name}.png`), fullPage: true });
      }
    });

    test('creates a missing PDF from the invoice drawer', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[2]);
      await page.goto(`/organizations/${fx.organizationId}/finance/invoices?invoice=${neighbourInvoiceId}`);
      const drawer = page.getByRole('dialog', { name: /^Invoice #\d+$/ });
      await expect(drawer.getByText(/has not been created/)).toBeVisible();
      await expect(drawer.getByRole('link', { name: 'Download PDF' })).toHaveCount(0);
      await drawer.getByRole('button', { name: 'Create PDF' }).click();
      await expect(drawer.getByRole('link', { name: 'Download PDF' })).toBeVisible();
      expect((await sql(`select count(*)::int n from public.invoice_documents where invoice_id = $1`, [neighbourInvoiceId]))[0]).toEqual({ n: 1 });
    });

    test('downloads the same PDF after the business changes its branding and name', async ({ page }) => {
      await setBrand(owner.db, { organizationId: fx.organizationId, accent: '#b42318', headingFont: 'mono', bodyFont: 'mono' });
      await uploadLogo(owner.db, { organizationId: fx.organizationId, file: new File([PNG], 'logo-2.png', { type: 'image/png' }) });
      await sql(`update public.organization_identity set legal_name = 'Renamed Holdings Ltd.' where organization_id = $1`, [fx.organizationId]);
      await page.setViewportSize(VIEWPORTS[2]);
      await page.goto(`/organizations/${fx.organizationId}/finance/invoices?invoice=${invoiceId}`);
      const drawer = page.getByRole('dialog', { name: `Invoice #${invoiceNumber}` });
      const [download] = await Promise.all([page.waitForEvent('download'), drawer.getByRole('link', { name: 'Download PDF' }).click()]);
      const bytes = readFileSync((await download.path())!);
      expect(sha(bytes)).toBe(issuedSha);
      expect(await pdfText(bytes)).not.toContain('Renamed Holdings Ltd.');
      expect((await sql(`select count(*)::int n from public.invoice_documents where invoice_id = $1`, [invoiceId]))[0]).toEqual({ n: 1 });
    });
  });

  test.describe('customer', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('downloads the same PDF from the portal, and nobody else’s', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[0]);
      await page.goto(`/portal/${portalToken}`);
      await expect(page.getByRole('heading', { name: 'Your invoices' })).toBeVisible();
      const link = page.getByRole('link', { name: `Download PDF of invoice #${invoiceNumber}` });
      await expect(link).toBeVisible();
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await fits(page, `portal ${viewport.name}`);
        await page.screenshot({ path: path.join(OUT, `portal-${viewport.name}.png`), fullPage: true });
      }
      const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
      expect(sha(readFileSync((await download.path())!))).toBe(issuedSha);

      const refused = await page.request.get(`/portal/invoices/${neighbourInvoiceId}/document`);
      expect(refused.status()).toBe(404);
      const member = await page.request.get(`/organizations/${fx.organizationId}/finance/invoices/${invoiceId}/document`, { maxRedirects: 0 });
      expect(member.status()).not.toBe(200);
    });

    test('a signed-out request is refused on both routes', async ({ playwright, baseURL }) => {
      const stranger = await playwright.request.newContext({ baseURL });
      try {
        expect((await stranger.get(`/portal/invoices/${invoiceId}/document`)).status()).toBe(404);
        const member = await stranger.get(`/organizations/${fx.organizationId}/finance/invoices/${invoiceId}/document`, { maxRedirects: 0 });
        expect(member.status()).not.toBe(200);
        expect(member.headers()['content-type'] ?? '').not.toContain('application/pdf');
      } finally {
        await stranger.dispose();
      }
    });
  });
});
