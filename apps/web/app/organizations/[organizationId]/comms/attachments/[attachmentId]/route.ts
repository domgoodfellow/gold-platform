import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/server';
import { readAttachment } from '@/lib/domain/email/messages';
import { DomainError } from '@/lib/domain/errors';
import { requireOrganization } from '@/lib/route/organization';

/**
 * One email attachment, served as a download and nothing else.
 *
 * The bytes are read under the caller's own session (`readAttachment`), so a file that is not this
 * business's does not open by id or by path. They are streamed from here rather than redirected to a
 * signed storage address because this is where the headers are decided: an attachment is a stranger's
 * file, never scanned, so it is always `attachment`, always an opaque content type, and never sniffed
 * into something a browser would render or run.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string; attachmentId: string }> },
) {
  const { organizationId, attachmentId } = await params;
  await requireOrganization(organizationId);
  const db = await getDb();

  try {
    const { filename, bytes } = await readAttachment(db, { organizationId, attachmentId });
    const safeName = filename.replace(/[^A-Za-z0-9._ -]/g, '_');
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: error.code === 'auth.required' ? 401 : 404 });
    }
    throw error;
  }
}
