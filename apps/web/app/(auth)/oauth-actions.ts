'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { signInWithGoogle } from '@/lib/domain/identity/credentials';

/**
 * Shared by both the log-in and sign-up screens: Supabase treats a Google sign-in as create-or-
 * log-in, so there is exactly one action rather than one per screen.
 */
export async function signInWithGoogleAction(): Promise<void> {
  const db = await getDb();
  const heading = await headers();
  const host = heading.get('host');
  const protocol = heading.get('x-forwarded-proto') ?? 'http';
  const origin = `${protocol}://${host}`;

  const url = await signInWithGoogle(db, { redirectTo: `${origin}/auth/callback` });

  redirect(url);
}
