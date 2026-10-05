import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { getCallRecording } from '@/lib/domain/reception/calls';
import { requireOrganization } from '@/lib/route/organization';

/**
 * The audio of one call, streamed to somebody who has been checked.
 *
 * **The only way a recording reaches a browser.** The carrier's own address is never sent to a
 * person: it is not authorization, and a stranger holding it should get nothing. The caller must be
 * signed in to this business and hold the capability that plays recordings; the reference is read
 * through a database door that checks both, and fetched with this platform's own credentials.
 * Another business's call id gets the same answer as one that does not exist.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string; callId: string }> },
) {
  const { organizationId, callId } = await params;
  await requireOrganization(organizationId);
  const db = await getDb();

  try {
    const recording = await getCallRecording(db, { organizationId, callId });
    if (!recording) return new Response('No recording', { status: 404 });
    return new Response(recording.body, {
      headers: { 'content-type': recording.contentType, 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return new Response(error.message, { status: error.code === 'calls.recording_refused' ? 403 : 502 });
    }
    throw error;
  }
}
