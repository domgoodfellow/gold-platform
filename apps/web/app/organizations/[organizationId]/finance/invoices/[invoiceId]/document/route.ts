import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/server';
import { readInvoiceDocument } from '@/lib/domain/billing/invoice-documents';
import { DomainError } from '@/lib/domain/errors';
import { requireOrganization } from '@/lib/route/organization';
import { pdfDownload } from '@/lib/route/pdf-download';

/**
 * An issued invoice's canonical PDF, for a member of its business. The bytes are read under the
 * caller's own session, so the invoice and its stored file must both be readable to them; the same
 * stored file is served every time, never drawn again.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string; invoiceId: string }> },
) {
  const { organizationId, invoiceId } = await params;
  await requireOrganization(organizationId);
  const db = await getDb();
  try {
    return pdfDownload(await readInvoiceDocument(db, { organizationId, invoiceId }));
  } catch (error) {
    if (error instanceof DomainError) {
      // 404 for "not yours" as well as "not there": telling them apart would say an invoice exists.
      return NextResponse.json({ error: error.message }, { status: error.code === 'auth.required' ? 401 : 404 });
    }
    throw error;
  }
}
