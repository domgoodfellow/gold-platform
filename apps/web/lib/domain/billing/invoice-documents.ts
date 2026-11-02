import type { Db } from '@/lib/db/types';
import { documentRenderer, type DocumentFont, type InvoiceDocument } from '@/lib/adapters/documents';
import { readableOn } from '@/lib/domain/branding/palette';
import { DomainError } from '@/lib/domain/errors';
import { priceWorkItem, type PricedLine } from '@/lib/domain/pricing/prices';
import { countryName } from '@/lib/domain/tenancy/regional-defaults';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { getInvoice, invoiceStanding } from './invoices';

/**
 * An invoice as a document. The money is the invoice's: its own lines, totalled by the one price
 * calculation, never re-read from the catalog. How it looks is its recorded presentation
 * (`invoice_presentations`, written in the transaction that issued it), so later branding never
 * reaches an issued invoice. Each issued invoice has one canonical PDF, stored privately and never
 * replaced; every download serves those same bytes.
 */

export const DOCUMENT_BUCKET = 'finance-documents';

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

export type InvoiceDocumentRecord = {
  invoiceId: string;
  storagePath: string;
  sha256: string;
  sizeBytes: number;
  renderer: string;
  createdAt: string;
};

type PresentationRow = {
  seller_name: string; trading_name: string | null; address_lines: string[]; country_code: string | null;
  contact_email: string | null; contact_phone: string | null; website_url: string | null;
  bill_to_name: string; bill_to_email: string | null; accent: string | null;
  heading_font: string; body_font: string; logo_path: string | null; timezone: string;
};

const font = (value: string): DocumentFont => (value === 'serif' || value === 'mono' ? value : 'sans');

function presentationFrom(row: PresentationRow): InvoicePresentation {
  return {
    sellerName: row.seller_name, tradingName: row.trading_name, addressLines: row.address_lines ?? [],
    countryCode: row.country_code, contactEmail: row.contact_email, contactPhone: row.contact_phone,
    websiteUrl: row.website_url, billToName: row.bill_to_name, billToEmail: row.bill_to_email,
    accent: row.accent, headingFont: font(row.heading_font), bodyFont: font(row.body_font),
    logoPath: row.logo_path, timezone: row.timezone,
  };
}

const PRESENTATION_COLUMNS = 'seller_name, trading_name, address_lines, country_code, contact_email, contact_phone, website_url, bill_to_name, bill_to_email, accent, heading_font, body_font, logo_path, timezone';

/** The presentation recorded at issue, or null for an invoice issued before presentations were recorded. */
export async function getInvoicePresentation(db: Db, input: { organizationId: string; invoiceId: string }): Promise<InvoicePresentation | null> {
  const { data, error } = await db.from('invoice_presentations').select(PRESENTATION_COLUMNS)
    .eq('organization_id', input.organizationId).eq('invoice_id', input.invoiceId).maybeSingle();
  if (error) throw new DomainError(error.message, 'invoice_documents.read_failed');
  return data ? presentationFrom(data) : null;
}

/** What an invoice issued now would carry. Writes nothing. */
export async function previewInvoicePresentation(db: Db, input: { organizationId: string; customerId: string | null }): Promise<InvoicePresentation> {
  const { data, error } = await db.rpc('preview_invoice_presentation', { p_organization_id: input.organizationId, p_customer_id: input.customerId as string });
  if (error) {
    if (error.code === '42501') throw new DomainError('Your role cannot preview this business’s invoices.', 'invoice_documents.forbidden');
    throw new DomainError(error.message, 'invoice_documents.preview_failed');
  }
  return presentationFrom(data as unknown as PresentationRow);
}

export async function getInvoiceDocumentRecord(db: Db, input: { organizationId: string; invoiceId: string }): Promise<InvoiceDocumentRecord | null> {
  const { data, error } = await db.from('invoice_documents').select('invoice_id, storage_path, sha256, size_bytes, renderer, created_at')
    .eq('organization_id', input.organizationId).eq('invoice_id', input.invoiceId).maybeSingle();
  if (error) throw new DomainError(error.message, 'invoice_documents.read_failed');
  return data ? { invoiceId: data.invoice_id, storagePath: data.storage_path, sha256: data.sha256, sizeBytes: data.size_bytes, renderer: data.renderer, createdAt: data.created_at } : null;
}

/** Which of these invoices already have their canonical PDF. */
export async function listInvoiceDocumentIds(db: Db, input: { organizationId: string; invoiceIds: string[] }): Promise<Set<string>> {
  if (input.invoiceIds.length === 0) return new Set();
  const { data, error } = await db.from('invoice_documents').select('invoice_id')
    .eq('organization_id', input.organizationId).in('invoice_id', input.invoiceIds);
  if (error) throw new DomainError(error.message, 'invoice_documents.read_failed');
  return new Set((data ?? []).map((row) => row.invoice_id));
}

/** A logo the layout can draw: PNG or JPEG, by its bytes rather than its name. */
export function logoFormat(bytes: Uint8Array): 'png' | 'jpg' | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

async function loadLogo(db: Db, bucket: string, path: string | null): Promise<InvoiceDocument['logo']> {
  if (!path) return null;
  const { data, error } = await db.storage.from(bucket).download(path);
  // A missing or unreadable logo is not a reason to refuse the document: the seller's name stands in.
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const format = logoFormat(bytes);
  return format ? { bytes, format } : null;
}

/**
 * Keep a private, unreplaceable copy of the business's current logo, so an invoice issued with it
 * can still draw it after the logo is replaced or removed. Idempotent: the copy's name is the
 * logo's own key, and storage refuses a second object there.
 */
export async function retainCurrentLogo(db: Db, input: { organizationId: string }): Promise<void> {
  const { data } = await db.from('brand_settings').select('logo_path').eq('organization_id', input.organizationId).maybeSingle();
  const path = data?.logo_path;
  if (!path) return;
  const target = `${input.organizationId}/logos/${path.split('/')[1] ?? ''}`;
  const { data: blob, error } = await db.storage.from('brand').download(path);
  if (error || !blob) return;
  // Best effort, and an "already exists" refusal is the success case. Issuing never waits on this.
  await db.storage.from(DOCUMENT_BUCKET).upload(target, blob, { contentType: blob.type || 'application/octet-stream', upsert: false });
}

const dateIn = (timezone: string) => (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso));

/**
 * The document for an invoice or a draft of one. Pure: every value is the caller's, every amount
 * goes through `priceWorkItem`, and payment activity is labelled with the moment it was read so it
 * is never mistaken for the invoice as issued.
 */
export function composeInvoiceDocument(input: {
  status: 'draft' | 'issued';
  number: number | null;
  issuedAt: string | null;
  dueAt: string | null;
  currency: string;
  lines: Pick<PricedLine, 'description' | 'unit' | 'unitAmountMinor' | 'currency' | 'quantity'>[];
  presentation: InvoicePresentation | null;
  /** For an invoice with no recorded presentation: the business's name and clock, and nothing else. */
  fallback: { sellerName: string; billToName: string; timezone: string };
  payments: { paidMinor: number; outstandingMinor: number | null; asOf: Date } | null;
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
    payments: input.payments ? {
      heading: `Payment status on ${date(input.payments.asOf.toISOString())}`,
      rows: [
        { label: 'Paid', value: money(input.payments.paidMinor) },
        { label: 'Outstanding', value: input.payments.outstandingMinor === null ? '—' : money(Math.max(0, input.payments.outstandingMinor)) },
      ],
      note: `Payments recorded after this date are not shown here. Ask ${sellerName} for the current balance.`,
    } : null,
    notes,
    brand: {
      accent: p?.accent ? readableOn(p.accent, '#ffffff') : null,
      headingFont: p?.headingFont ?? 'sans',
      bodyFont: p?.bodyFont ?? 'sans',
    },
    logo: input.logo,
  };
}

/** A draft, drawn with the business's current identity and stamped DRAFT. Stores and records nothing. */
export async function renderDraftInvoice(db: Db, input: {
  organizationId: string; customerId: string | null; billedTo: string; currency: string;
  lines: Pick<PricedLine, 'description' | 'unit' | 'unitAmountMinor' | 'currency' | 'quantity'>[];
  issuedAt: string | null; dueAt: string | null; timezone: string; organizationName: string;
}): Promise<Uint8Array> {
  const presentation = await previewInvoicePresentation(db, { organizationId: input.organizationId, customerId: input.customerId });
  if (input.billedTo) presentation.billToName = input.billedTo;
  const { data: brand } = await db.from('brand_settings').select('logo_path').eq('organization_id', input.organizationId).maybeSingle();
  const logo = await loadLogo(db, 'brand', brand?.logo_path ?? null);
  const renderer = await documentRenderer();
  return drawWithLogoFallback(renderer, composeInvoiceDocument({
    status: 'draft', number: null, issuedAt: input.issuedAt, dueAt: input.dueAt, currency: input.currency, lines: input.lines,
    presentation, fallback: { sellerName: input.organizationName, billToName: input.billedTo, timezone: input.timezone }, payments: null, logo,
  }));
}

/** A logo whose bytes look right but do not decode is not a reason to refuse the document: draw it again with the seller's name. */
async function drawWithLogoFallback(renderer: Awaited<ReturnType<typeof documentRenderer>>, document: InvoiceDocument): Promise<Uint8Array> {
  try {
    return await renderer.renderInvoice(document);
  } catch {
    try {
      if (document.logo) return await renderer.renderInvoice({ ...document, logo: null });
    } catch { /* Reported below. */ }
    throw new DomainError('The invoice PDF could not be drawn. Try again.', 'invoice_documents.render_failed');
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The issued invoice's canonical PDF, created once. Safe to call again after any failure: an
 * invoice already recorded returns its record untouched; bytes an earlier attempt stored in the
 * invoice's folder are recorded as they are rather than drawn again; and concurrent calls each store
 * under their own name — storage can let a refused upload overwrite an object at a shared name — and
 * the database records the first one, once. Every caller returns that record, and only a recorded
 * object is ever served.
 */
export async function ensureInvoiceDocument(db: Db, input: { organizationId: string; invoiceId: string; now?: Date }): Promise<InvoiceDocumentRecord> {
  const existing = await getInvoiceDocumentRecord(db, input);
  if (existing) return existing;

  const invoice = await getInvoice(db, input);
  if (!invoice) throw new DomainError('That invoice is unavailable.', 'invoice_documents.not_found');
  const [presentation, organization] = await Promise.all([
    getInvoicePresentation(db, input),
    db.from('organizations').select('name, timezone').eq('id', input.organizationId).maybeSingle(),
  ]);
  const renderer = await documentRenderer();
  const folder = `${input.organizationId}/invoices/${invoice.id}`;

  let path: string;
  let bytes: Uint8Array;
  const { data: stored } = await db.storage.from(DOCUMENT_BUCKET).list(folder, { sortBy: { column: 'created_at', order: 'asc' } });
  const earlier = (stored ?? []).find((object) => object.name.endsWith('.pdf'));
  const kept = earlier ? (await db.storage.from(DOCUMENT_BUCKET).download(`${folder}/${earlier.name}`)).data : null;
  if (earlier && kept) {
    // Stored by an earlier attempt whose record failed: that object is the document.
    path = `${folder}/${earlier.name}`;
    bytes = new Uint8Array(await kept.arrayBuffer());
  } else {
    const standing = invoiceStanding(invoice);
    const document = composeInvoiceDocument({
      status: 'issued', number: invoice.number, issuedAt: invoice.issuedAt, dueAt: invoice.dueAt, currency: invoice.currency,
      lines: invoice.lines, presentation,
      fallback: { sellerName: organization.data?.name ?? 'Business', billToName: invoice.billedTo, timezone: organization.data?.timezone ?? 'UTC' },
      payments: { paidMinor: standing.paidMinor, outstandingMinor: standing.outstandingMinor, asOf: input.now ?? new Date() },
      logo: await loadLogo(db, DOCUMENT_BUCKET, presentation?.logoPath ?? null),
    });
    bytes = await drawWithLogoFallback(renderer, document);
    path = `${folder}/${renderer.version}-${crypto.randomUUID()}.pdf`;
    const upload = await db.storage.from(DOCUMENT_BUCKET).upload(path, new Blob([bytes as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false });
    if (upload.error) {
      // Refused, most often because another request recorded the document meanwhile.
      const recorded = await getInvoiceDocumentRecord(db, input);
      if (recorded) return recorded;
      throw new DomainError('The invoice document could not be stored. Try again.', 'invoice_documents.store_failed');
    }
  }

  const { data, error } = await db.rpc('record_invoice_document', {
    p_invoice_id: invoice.id, p_storage_path: path, p_sha256: await sha256Hex(bytes), p_size_bytes: bytes.length, p_renderer: renderer.version,
  });
  if (error || !data) {
    if (error?.code === '42501') throw new DomainError('Your role cannot create this invoice’s document.', 'invoice_documents.forbidden');
    throw new DomainError('The invoice document could not be recorded. Try again.', 'invoice_documents.record_failed');
  }
  return { invoiceId: data.invoice_id, storagePath: data.storage_path, sha256: data.sha256, sizeBytes: data.size_bytes, renderer: data.renderer, createdAt: data.created_at };
}

/** The canonical PDF's bytes, read under the caller's own session — a member of the business, or the invoice's own customer. */
export async function readInvoiceDocument(db: Db, input: { organizationId: string; invoiceId: string }): Promise<{ fileName: string; bytes: Uint8Array }> {
  const record = await getInvoiceDocumentRecord(db, input);
  if (!record) throw new DomainError('This invoice has no document yet.', 'invoice_documents.not_found');
  const { data: invoice } = await db.from('invoices').select('number').eq('organization_id', input.organizationId).eq('id', input.invoiceId).maybeSingle();
  const { data, error } = await db.storage.from(DOCUMENT_BUCKET).download(record.storagePath);
  if (error || !data || !invoice) throw new DomainError('This invoice document is unavailable.', 'invoice_documents.not_found');
  return { fileName: `invoice-${invoice.number}.pdf`, bytes: new Uint8Array(await data.arrayBuffer()) };
}
