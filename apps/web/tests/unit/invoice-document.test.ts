import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { definePDFJSModule, extractText, getDocumentProxy } from 'unpdf';
import { reactPdfRenderer } from '@/lib/adapters/documents/react-pdf';
import { composeInvoiceDocument, logoFormat, type InvoicePresentation } from '@/lib/domain/billing/invoice-documents';
import { contrastRatio } from '@/lib/domain/branding/palette';

const PRESENTATION: InvoicePresentation = {
  sellerName: 'Harbour Plumbing Ltd.', tradingName: 'Harbour Plumbing', addressLines: ['12 Wharf Street', 'Halifax NS B3H 1A1'], countryCode: 'CA',
  contactEmail: 'office@harbour.example', contactPhone: '+1 902 555 0100', websiteUrl: null, billToName: 'Élodie Bérubé', billToEmail: 'elodie@example.com',
  accent: '#ffe066', headingFont: 'serif', bodyFont: 'sans', logoPath: null, timezone: 'America/Halifax',
};
const LINE = { description: 'Service call', unit: 'visit', unitAmountMinor: 9550, currency: 'CAD', quantity: 2 };
const FALLBACK = { sellerName: 'Harbour Plumbing', billToName: 'Élodie Bérubé', timezone: 'America/Halifax' };

const compose = (overrides: Partial<Parameters<typeof composeInvoiceDocument>[0]> = {}) => composeInvoiceDocument({
  status: 'issued', number: 42, issuedAt: '2026-11-02T04:00:00Z', dueAt: '2026-12-02T04:00:00Z', currency: 'CAD',
  lines: [LINE, { ...LINE, description: 'Copper pipe', unit: 'metre', unitAmountMinor: 1200, quantity: 15 }],
  presentation: PRESENTATION, fallback: FALLBACK, payments: { paidMinor: 5000, outstandingMinor: 30100, asOf: new Date('2026-11-02T15:00:00Z') }, logo: null,
  ...overrides,
});

async function pages(bytes: Uint8Array) {
  await definePDFJSModule(() => import('unpdf/pdfjs'));
  const pdf = await getDocumentProxy(bytes.slice());
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { totalPages, text: text as string[] };
}

describe('the invoice document', () => {
  it('carries the invoice’s own amounts through the one price calculation, with no tax invented', () => {
    const doc = compose();
    expect(doc.lines.map(line => line.amount)).toEqual(['CA$191.00', 'CA$180.00']);
    expect(doc.total).toEqual({ label: 'Total', value: 'CA$371.00' });
    expect(JSON.stringify(doc)).not.toMatch(/tax|GST|HST|VAT/i);
  });

  it('labels payment activity with when it was read, apart from the invoice as issued', () => {
    const doc = compose();
    expect(doc.payments?.heading).toBe('Payment status on Nov 2, 2026');
    expect(doc.payments?.rows).toEqual([{ label: 'Paid', value: 'CA$50.00' }, { label: 'Outstanding', value: 'CA$301.00' }]);
    expect(doc.payments?.note).toMatch(/not shown here/);
  });

  it('dates in the business’s clock and names the seller as it was recorded', () => {
    const doc = compose();
    expect(doc.facts).toEqual([
      { label: 'Number', value: '#42' }, { label: 'Issued', value: 'Nov 2, 2026' }, { label: 'Due', value: 'Dec 2, 2026' }, { label: 'Currency', value: 'CAD' },
    ]);
    expect(doc.seller).toEqual({ name: 'Harbour Plumbing Ltd.', tradingName: 'Harbour Plumbing', addressLines: ['12 Wharf Street', 'Halifax NS B3H 1A1', 'Canada'], contactLines: ['office@harbour.example', '+1 902 555 0100'] });
    expect(doc.billTo).toEqual({ name: 'Élodie Bérubé', detailLines: ['elodie@example.com'] });
  });

  it('darkens a brand colour too light to read on white rather than using it as chosen', () => {
    const accent = compose().brand.accent!;
    expect(contrastRatio(accent, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('draws an invoice issued before presentations were recorded plainly, without today’s brand', () => {
    const doc = compose({ presentation: null });
    expect(doc.brand).toEqual({ accent: null, headingFont: 'sans', bodyFont: 'sans' });
    expect(doc.seller.addressLines).toEqual([]);
    expect(doc.notes[0]).toMatch(/issued before document details were recorded/);
  });

  it('draws only PNG and JPEG logos, by their bytes', () => {
    expect(logoFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('png');
    expect(logoFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(logoFormat(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  });
});

describe('the built-in invoice PDF', () => {
  it('is a readable PDF whose text matches the invoice, French accents included', async () => {
    const bytes = await reactPdfRenderer.renderInvoice(compose());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const { totalPages, text } = await pages(bytes);
    expect(totalPages).toBe(1);
    for (const expected of ['Invoice', '#42', 'Harbour Plumbing Ltd.', 'Élodie Bérubé', 'Service call (visit)', 'CA$191.00', 'CA$371.00', 'Payment status on Nov 2, 2026', 'Page 1 of 1']) {
      expect(text[0]).toContain(expected);
    }
    expect(text[0]).not.toContain('DRAFT');
  });

  it('marks a draft on every page and gives it no number', async () => {
    const doc = compose({ status: 'draft', number: null, payments: null });
    const { text } = await pages(await reactPdfRenderer.renderInvoice(doc));
    expect(text[0]).toContain('DRAFT');
    expect(text[0]).toContain('Assigned on issue');
    expect(text[0]).toContain('Draft — not an issued invoice');
  });

  it('runs a long invoice across pages, repeating the line headings and wrapping long descriptions', async () => {
    const long = 'Replace the full run of corroded supply pipe beneath the north wing, including access panels, fittings, pressure testing and making good every surface disturbed along the way';
    const lines = Array.from({ length: 120 }, (_, index) => ({ ...LINE, description: index === 3 ? long : `Line item ${index + 1}` }));
    const { totalPages, text } = await pages(await reactPdfRenderer.renderInvoice(compose({ lines })));
    expect(totalPages).toBeGreaterThan(2);
    for (const page of text) expect(page).toMatch(/DESCRIPTION QTY UNIT PRICE AMOUNT/);
    expect(text.join(' ')).toContain('Line item 120');
    expect(text.join(' ').replace(/\s+/g, ' ')).toContain('making good every surface disturbed');
    expect(text.at(-1)).toContain(`Page ${totalPages} of ${totalPages}`);
    expect(text.at(-1)).toContain('CA$22,920.00');
  });

  it('falls back to the seller’s name when there is no drawable logo', async () => {
    const { text } = await pages(await reactPdfRenderer.renderInvoice(compose({ logo: null })));
    expect(text[0]).toContain('Harbour Plumbing');
  });

  it('reads nothing from personal Appearance', () => {
    for (const file of ['lib/domain/billing/invoice-documents.ts', 'lib/adapters/documents/react-pdf.tsx', 'lib/adapters/documents/index.ts']) {
      expect(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')).not.toMatch(/appearance/i);
    }
  });
});
