import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/server';
import { getDocumentUrl } from '@/lib/domain/documents/documents';
import { DomainError } from '@/lib/domain/errors';
import { requireOrganization } from '@/lib/route/organization';

/**
 * Redirect to a freshly signed URL for one document. Minted at click time rather than served
 * from a durable public URL — a link rendered an hour ago would be exactly what's forbidden.
 * `getDocumentUrl`'s RLS read is the permission check; nothing here decides anything.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string; documentId: string }> },
) {
  const { organizationId, documentId } = await params;
  // Service access, not permission: a locked business's documents stay stored and unread.
  await requireOrganization(organizationId);
  const db = await getDb();

  try {
    const { url } = await getDocumentUrl(db, { documentId });
    return NextResponse.redirect(url);
  } catch (error) {
    if (error instanceof DomainError) {
      // 404 for "not yours" as well as "no such document" — telling them apart would leak that a document exists.
      const status = error.code === 'auth.required' ? 401 : 404;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }
}
