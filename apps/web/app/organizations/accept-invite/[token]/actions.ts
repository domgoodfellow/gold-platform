'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { acceptInvitation } from '@/lib/domain/tenancy/invitations';

export type AcceptInvitationState = { error: string | null };

export async function acceptInvitationAction(
  _previous: AcceptInvitationState,
  formData: FormData,
): Promise<AcceptInvitationState> {
  const db = await getDb();
  const token = String(formData.get('token') ?? '');
  const displayName = String(formData.get('displayName') ?? '');

  let organizationId: string;
  try {
    organizationId = await acceptInvitation(db, { token, displayName });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  redirect(`/organizations/${organizationId}`);
}
