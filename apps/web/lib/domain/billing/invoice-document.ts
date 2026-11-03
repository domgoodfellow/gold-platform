import type { DocumentFont, DocumentRenderer, InvoiceDocument } from '@/lib/adapters/documents';
import { readableOn } from '@/lib/domain/branding/palette';
import { DomainError } from '@/lib/domain/errors';
import { priceWorkItem, type PricedLine } from '@/lib/domain/pricing/prices';
import { countryName } from '@/lib/domain/tenancy/regional-defaults';
import { formatMoney } from '@/lib/domain/work-items/consumption';

/**
 * An invoice as a document, and nothing else: no database, no storage, no session. The money is
 * the invoice's own lines, totalled by the one price calculation; how it looks is its recorded
 * presentation. `apps/api`'s invoice-document writer draws issued invoices with exactly this
 * module, bundled from here (`apps/api/invoice_documents/generate.mjs`), so a draft and the issued
 * PDF are composed by one implementation.
 */

/** What an invoice carried at issue besides its money. Null colours mean the business had chosen none. */
export type InvoicePresentation = {
  sellerName: string;
  tradingName: string | null;
  addressLines: string[];
  countryCode: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  billToName: string;
  billToEmail: string | null;
  accent: string | null;
  headingFont: DocumentFont;
  bodyFont: DocumentFont;
  /** The retained private copy, or null. */
  logoPath: string | null;
  timezone: string;
};

export type PresentationRow = {
  seller_name: string; trading_name: string | null; address_lines: string[]; country_code: string | null;
  contact_email: string | null; contact_phone: string | null; website_url: string | null;
  bill_to_name: string; bill_to_email: string | null; accent: string | null;
  heading_font: string; body_font: string; logo_path: string | null; timezone: string;
};

export type DocumentLine = Pick<PricedLine, 'description' | 'unit' | 'unitAmountMinor' | 'currency' | 'quantity'>;

const font = (value: string): DocumentFont => (value === 'serif' || value === 'mono' ? value : 'sans');

export function presentationFrom(row: PresentationRow): InvoicePresentation {
  return {
    sellerName: row.seller_name, tradingName: row.trading_name, addressLines: row.address_lines ?? [],
    countryCode: row.country_code, contactEmail: row.contact_email, contactPhone: row.contact_phone,
    websiteUrl: row.website_url, billToName: row.bill_to_name, billToEmail: row.bill_to_email,
    accent: row.accent, headingFont: font(row.heading_font), bodyFont: font(row.body_font),
    logoPath: row.logo_path, timezone: row.timezone,
  };
}

/** A logo the layout can draw: PNG or JPEG, by its bytes rather than its name. */
export function logoFormat(bytes: Uint8Array): 'png' | 'jpg' | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

/** Bytes a renderer produced that are a whole PDF: its header, and its end-of-file marker near the end. */
export function isPdf(bytes: Uint8Array): boolean {
  if (bytes.length < 64) return false;
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 5));
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 1024)));
  return head === '%PDF-' && tail.includes('%%EOF');
}

const dateIn = (timezone: string) => (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso));

/**
 * The document for an invoice or a draft of one. Pure: every value is the caller's and every
 * amount goes through `priceWorkItem`. It states the invoice as issued and never its payments, so
 * the same invoice is the same document whenever it is drawn; what has been paid since is the
 * Finance inspector's and the customer portal's to show.
 */
export function composeInvoiceDocument(input: {
  status: 'draft' | 'issued';
  number: number | null;
  issuedAt: string | null;
  dueAt: string | null;
  currency: string;
  lines: DocumentLine[];
  presentation: InvoicePresentation | null;
  /** For an invoice with no recorded presentation: the business's name and clock, and nothing else. */
  fallback: { sellerName: string; billToName: string; timezone: string };
  logo: InvoiceDocument['logo'];
}): InvoiceDocument {
  const p = input.presentation;
  const timezone = p?.timezone ?? input.fallback.timezone;
  const date = dateIn(timezone);
  const money = (minor: number) => formatMoney(minor, input.currency);
  const price = (lines: typeof input.lines) => priceWorkItem(lines.map((line, index) => ({ id: String(index), ...line })));
  const total = price(input.lines);
  const sellerName = p?.sellerName ?? input.fallback.sellerName;
  const numberLabel = input.number === null ? 'Assigned on issue' : `#${input.number}`;
  const notes: string[] = [];
  if (!p && input.status === 'issued') notes.push('This invoice was issued before document details were recorded, so it shows the invoice’s own facts in a plain layout.');
  return {
    status: input.status,
    title: input.number === null ? `Draft invoice — ${sellerName}` : `Invoice #${input.number} — ${sellerName}`,
    seller: {
      name: sellerName,
      tradingName: p?.tradingName ?? null,
      addressLines: p ? [...p.addressLines, ...(p.countryCode ? [countryName(p.countryCode)] : [])] : [],
      contactLines: p ? [p.contactEmail, p.contactPhone, p.websiteUrl].filter((line): line is string => !!line) : [],
    },
    billTo: { name: p?.billToName ?? input.fallback.billToName, detailLines: p?.billToEmail ? [p.billToEmail] : [] },
    facts: [
      { label: 'Number', value: numberLabel },
      { label: 'Issued', value: input.issuedAt ? date(input.issuedAt) : 'On issue' },
      { label: 'Due', value: input.dueAt ? date(input.dueAt) : 'No due date' },
      { label: 'Currency', value: input.currency },
    ],
    lines: input.lines.map((line) => ({
      description: line.unit ? `${line.description} (${line.unit})` : line.description,
      quantity: String(line.quantity),
      unitAmount: money(line.unitAmountMinor),
      amount: money(price([line])?.totalMinor ?? 0),
    })),
    total: { label: 'Total', value: total ? money(total.totalMinor) : '—' },
    notes,
    brand: {
      accent: p?.accent ? readableOn(p.accent, '#ffffff') : null,
      headingFont: p?.headingFont ?? 'sans',
      bodyFont: p?.bodyFont ?? 'sans',
    },
    logo: input.logo,
  };
}

/** A logo whose bytes look right but do not decode is not a reason to refuse the document: draw it again with the seller's name. */
export async function drawWithLogoFallback(renderer: DocumentRenderer, document: InvoiceDocument): Promise<Uint8Array> {
  try {
    return await renderer.renderInvoice(document);
  } catch {
    try {
      if (document.logo) return await renderer.renderInvoice({ ...document, logo: null });
    } catch { /* Reported below. */ }
    throw new DomainError('The invoice PDF could not be drawn. Try again.', 'invoice_documents.render_failed');
  }
}
