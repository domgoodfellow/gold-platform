'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { signInWithGoogle } from '@/lib/domain/identity/credentials';
import { requestOrigin } from '@/lib/route/origin';

/**
 * Shared by both the log-in and sign-up screens: Supabase treats a Google sign-in as create-or-
 * log-in, so there is exactly one action rather than one per screen.
 */
export async function signInWithGoogleAction(): Promise<void> {
  const db = await getDb();
  const origin = await requestOrigin();

  const url = await signInWithGoogle(db, { redirectTo: `${origin}/auth/callback` });

  redirect(url);
}
