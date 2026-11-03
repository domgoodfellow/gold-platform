/**
 * Drawing a business document as a PDF, as a capability.
 *
 * The caller hands over a finished, already-authorized document: every word and amount is decided
 * and formatted before it arrives here, so a renderer only lays out what it is given. It reads no
 * database, fetches nothing remote and runs nothing supplied by a business — a logo arrives as
 * bytes, and fonts are a fixed set. Server only.
 */

export type DocumentFont = 'sans' | 'serif' | 'mono';

export type InvoiceDocument = {
  /** A draft is stamped DRAFT on every page and is never stored. */
  status: 'draft' | 'issued';
  title: string;
  seller: {
    name: string;
    tradingName: string | null;
    addressLines: string[];
    contactLines: string[];
  };
  billTo: { name: string; detailLines: string[] };
  /** Number, dates, currency: label and value, in reading order. */
  facts: { label: string; value: string }[];
  lines: { description: string; quantity: string; unitAmount: string; amount: string }[];
  total: { label: string; value: string };
  notes: string[];
  brand: {
    /** Already checked to be readable on white; null uses the neutral ink. */
    accent: string | null;
    headingFont: DocumentFont;
    bodyFont: DocumentFont;
  };
  /** Only PNG or JPEG; anything else is left out and the seller's name stands in. */
  logo: { bytes: Uint8Array; format: 'png' | 'jpg' } | null;
};

export type DocumentRenderer = {
  /** Which layout drew a document, recorded beside it. Changes whenever the output would. */
  readonly version: string;
  renderInvoice(document: InvoiceDocument): Promise<Uint8Array>;
};

/** Re-exported so only ./registry names an implementation (adapters.test.ts). */
export { documentRenderer } from './registry';
