import { getDb } from '@/lib/db/server';
import { previewInvitation, type InvitationPreview } from '@/lib/domain/tenancy/invitations';
import { readPendingInviteToken } from '@/lib/route/pending-invite';

/**
 * The invitation a person is in the middle of accepting, if any, so log in, sign up and email
 * verification can say what it is for and offer the address it was sent to. Read only: the
 * invitation is still carried, and consumed, exactly where it was before.
 */
export async function pendingInvitation(): Promise<Extract<InvitationPreview, { state: 'valid' }> | null> {
  const token = await readPendingInviteToken();
  if (!token) return null;
  const preview = await previewInvitation(await getDb(), token);
  return preview.state === 'valid' ? preview : null;
}
