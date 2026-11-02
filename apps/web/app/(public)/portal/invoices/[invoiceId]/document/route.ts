import { NextResponse } from 'next/server';
import { getPortalDb } from '@/lib/db/portal-server';
import { readInvoiceDocument } from '@/lib/domain/billing/invoice-documents';
import { DomainError } from '@/lib/domain/errors';
import { requirePortalRequestContext } from '@/lib/domain/portal/request-context';
import { pdfDownload } from '@/lib/route/pdf-download';

/**
 * A customer's own invoice PDF: the same stored file the business downloads. The business comes from
 * the live portal session, never from the address; the invoice and the file are read under that
 * session, so only this customer's invoices answer. Every way of not being allowed is the same 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const db = await getPortalDb();
  try {
    const { organizationId } = await requirePortalRequestContext(db);
    return pdfDownload(await readInvoiceDocument(db, { organizationId, invoiceId }));
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    throw error;
  }
}
