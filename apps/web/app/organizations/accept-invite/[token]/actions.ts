'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { acceptInvitation } from '@/lib/domain/tenancy/invitations';
import { storePendingInvite } from '@/lib/route/pending-invite';
import { signOut } from '@/lib/domain/identity/credentials';

/**
 * Signed out, "Log in"/"Create an account" go through here rather than a plain link, so the
 * token survives the detour — set in a closed, `httpOnly` cookie, never a `?next=` URL
 * (`lib/route/pending-invite.ts`). Whichever of `logInAction`/`signUpAction`/the OAuth callback
 * actually finishes signing them in is what reads it back and sends them here again.
 */
export async function continueToLoginAction(formData: FormData): Promise<void> {
  await storePendingInvite(String(formData.get('token') ?? ''));
  redirect('/login');
}

export async function continueToSignUpAction(formData: FormData): Promise<void> {
  await storePendingInvite(String(formData.get('token') ?? ''));
  redirect('/sign-up');
}

/**
 * Signed in as somebody the invitation is not for: sign out, keep the invitation, and go to log in
 * as the right person. Nothing here signs anybody in; the person chooses the account.
 */
export async function switchAccountAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  await signOut(await getDb());
  await storePendingInvite(token);
  redirect('/login');
}

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
