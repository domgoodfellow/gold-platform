import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/server';
import { getDocumentUrl } from '@/lib/domain/documents/documents';
import { DomainError } from '@/lib/domain/errors';

/**
 * Redirect to a freshly signed URL for one document.
 *
 * This exists as a route rather than a link straight to storage because the URL has to be
 * minted at click time: constraints.md forbids serving a private file from a durable public
 * URL, and a link rendered into a page an hour ago would be exactly that. The signature is
 * created here, lives sixty seconds, and is never stored.
 *
 * The route decides nothing. `getDocumentUrl` reads the row under the caller's own RLS, and
 * that read is the permission check — a document in another tenant is not found, so there is
 * nothing to sign.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string; documentId: string }> },
) {
  const { documentId } = await params;
  const db = await getDb();

  try {
    const { url } = await getDocumentUrl(db, { documentId });
    return NextResponse.redirect(url);
  } catch (error) {
    if (error instanceof DomainError) {
      // 404 for "not yours" as well as "no such document". Distinguishing them would tell a
      // caller that a document they cannot see exists, which is the leak RLS just prevented.
      const status = error.code === 'auth.required' ? 401 : 404;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }
}
