import type { Db } from '@/lib/db/types';
import { callDomainCommand, requireAccessToken } from '@/lib/api/client';
import { documentRenderer, type InvoiceDocument } from '@/lib/adapters/documents';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import {
  composeInvoiceDocument,
  drawWithLogoFallback,
  logoFormat,
  presentationFrom,
  type DocumentLine,
  type InvoicePresentation,
  type PresentationRow,
} from './invoice-document';

export { composeInvoiceDocument, logoFormat, type InvoicePresentation } from './invoice-document';

/**
 * An invoice's documents, for a request. How it looks is its recorded presentation
 * (`invoice_presentations`, written in the transaction that issued it), so later branding never
 * reaches an issued invoice. Each issued invoice has one canonical PDF, stored privately and never
 * replaced; every download serves those same bytes, checked against the recorded checksum.
 *
 * **Nothing here stores or records a document.** No member may: `apps/api`'s
 * `/invoice-documents` draws the issued PDF from the database's own facts, stores it under a name
 * it chooses and records it with a checksum it computed, after the person's own session shows they
 * may issue the invoice. This file sends that command with the person's token, and draws drafts,
 * which are never stored.
 */

export const DOCUMENT_BUCKET = 'finance-documents';

export type InvoiceDocumentRecord = {
  invoiceId: string;
  storagePath: string;
  sha256: string;
  sizeBytes: number;
  renderer: string;
  createdAt: string;
};

const PRESENTATION_COLUMNS = 'seller_name, trading_name, address_lines, country_code, contact_email, contact_phone, website_url, bill_to_name, bill_to_email, accent, heading_font, body_font, logo_path, timezone';

/** The presentation recorded at issue, or null for an invoice issued before presentations were recorded. */
export async function getInvoicePresentation(db: Db, input: { organizationId: string; invoiceId: string }): Promise<InvoicePresentation | null> {
  const { data, error } = await db.from('invoice_presentations').select(PRESENTATION_COLUMNS)
    .eq('organization_id', input.organizationId).eq('invoice_id', input.invoiceId).maybeSingle();
  if (error) throw fromDatabaseError(error, 'invoice_documents.read_failed');
  return data ? presentationFrom(data) : null;
}

/** What an invoice issued now would carry. Writes nothing. */
export async function previewInvoicePresentation(db: Db, input: { organizationId: string; customerId: string | null }): Promise<InvoicePresentation> {
  const { data, error } = await db.rpc('preview_invoice_presentation', { p_organization_id: input.organizationId, p_customer_id: input.customerId as string });
  if (error) {
    if (error.code === '42501') throw new DomainError('Your role cannot preview this business’s invoices.', 'invoice_documents.forbidden');
    throw fromDatabaseError(error, 'invoice_documents.preview_failed');
  }
  return presentationFrom(data as unknown as PresentationRow);
}

export async function getInvoiceDocumentRecord(db: Db, input: { organizationId: string; invoiceId: string }): Promise<InvoiceDocumentRecord | null> {
  const { data, error } = await db.from('invoice_documents').select('invoice_id, storage_path, sha256, size_bytes, renderer, created_at')
    .eq('organization_id', input.organizationId).eq('invoice_id', input.invoiceId).maybeSingle();
  if (error) throw fromDatabaseError(error, 'invoice_documents.read_failed');
  return data ? { invoiceId: data.invoice_id, storagePath: data.storage_path, sha256: data.sha256, sizeBytes: data.size_bytes, renderer: data.renderer, createdAt: data.created_at } : null;
}

/** Which of these invoices already have their canonical PDF. */
export async function listInvoiceDocumentIds(db: Db, input: { organizationId: string; invoiceIds: string[] }): Promise<Set<string>> {
  if (input.invoiceIds.length === 0) return new Set();
  const { data, error } = await db.from('invoice_documents').select('invoice_id')
    .eq('organization_id', input.organizationId).in('invoice_id', input.invoiceIds);
  if (error) throw fromDatabaseError(error, 'invoice_documents.read_failed');
  return new Set((data ?? []).map((row) => row.invoice_id));
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

type WriterAnswer = { invoice_id: string; storage_path: string; sha256: string; size_bytes: number; renderer: string; created_at: string };

/** One writer command under the person's own token. Its refusals keep their `invoice_documents.*` codes. */
async function writer<T>(db: Db, body: Record<string, unknown>): Promise<T> {
  const token = await requireAccessToken(db);
  try {
    return await callDomainCommand<T>('/invoice-documents', { token, body, timeoutMs: 30_000 });
  } catch (error) {
    if (error instanceof DomainError && error.code.startsWith('api.invoice_documents.')) {
      throw fromDatabaseError(error, error.code.slice('api.'.length));
    }
    throw error;
  }
}

/**
 * Have the writer keep a private, unreplaceable copy of the business's current logo, so an
 * invoice issued with it can still draw it after the logo is replaced or removed. Idempotent: one
 * recorded copy per brand logo. A logo it cannot draw (anything but PNG or JPEG) is not kept, and
 * the invoice shows the business's name instead.
 */
export async function retainCurrentLogo(db: Db, input: { organizationId: string }): Promise<void> {
  await writer(db, { command: 'retain_logo', organization_id: input.organizationId });
}

/** A draft, drawn with the business's current identity and stamped DRAFT. Stores and records nothing. */
export async function renderDraftInvoice(db: Db, input: {
  organizationId: string; customerId: string | null; billedTo: string; currency: string;
  lines: DocumentLine[];
  issuedAt: string | null; dueAt: string | null; timezone: string; organizationName: string;
}): Promise<Uint8Array> {
  const presentation = await previewInvoicePresentation(db, { organizationId: input.organizationId, customerId: input.customerId });
  if (input.billedTo) presentation.billToName = input.billedTo;
  const { data: brand } = await db.from('brand_settings').select('logo_path').eq('organization_id', input.organizationId).maybeSingle();
  const logo = await loadLogo(db, 'brand', brand?.logo_path ?? null);
  const renderer = await documentRenderer();
  return drawWithLogoFallback(renderer, composeInvoiceDocument({
    status: 'draft', number: null, issuedAt: input.issuedAt, dueAt: input.dueAt, currency: input.currency, lines: input.lines,
    presentation, fallback: { sellerName: input.organizationName, billToName: input.billedTo, timezone: input.timezone }, logo,
  }));
}

/**
 * The issued invoice's canonical PDF, created once by the writer. Safe to call again after any
 * failure, and concurrently: an invoice already recorded returns its record untouched.
 */
export async function ensureInvoiceDocument(db: Db, input: { organizationId: string; invoiceId: string }): Promise<InvoiceDocumentRecord> {
  const existing = await getInvoiceDocumentRecord(db, input);
  if (existing) return existing;
  const data = await writer<WriterAnswer>(db, { command: 'create', organization_id: input.organizationId, invoice_id: input.invoiceId });
  return { invoiceId: data.invoice_id, storagePath: data.storage_path, sha256: data.sha256, sizeBytes: data.size_bytes, renderer: data.renderer, createdAt: data.created_at };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The canonical PDF's bytes, read under the caller's own session — a member of the business, or
 * the invoice's own customer — and served only when they are the bytes that were recorded.
 */
export async function readInvoiceDocument(db: Db, input: { organizationId: string; invoiceId: string }): Promise<{ fileName: string; bytes: Uint8Array }> {
  const record = await getInvoiceDocumentRecord(db, input);
  if (!record) throw new DomainError('This invoice has no document yet.', 'invoice_documents.not_found');
  const { data: invoice } = await db.from('invoices').select('number').eq('organization_id', input.organizationId).eq('id', input.invoiceId).maybeSingle();
  const { data, error } = await db.storage.from(DOCUMENT_BUCKET).download(record.storagePath);
  if (error || !data || !invoice) throw new DomainError('This invoice document is unavailable.', 'invoice_documents.not_found');
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.length !== record.sizeBytes || await sha256Hex(bytes) !== record.sha256) {
    throw new DomainError('This invoice document is unavailable.', 'invoice_documents.not_found');
  }
  return { fileName: `invoice-${invoice.number}.pdf`, bytes };
}
