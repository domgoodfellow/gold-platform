import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/** Identity is global; membership binds a user to an organization — kept separate so one person can belong to several businesses. */

/** A backstop, not the rule — checked here so every caller (form, API, future tool) gets the same message. */
const PASSWORD_MIN = 8;

function normaliseEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  // Not a full validator — the address is proven by whether the account can be reached.
  if (email.length === 0 || !email.includes('@')) {
    throw new DomainError('Enter an email address.', 'identity.email_invalid');
  }
  return email;
}

function checkPassword(password: string, confirmation: string): void {
  if (password.length < PASSWORD_MIN) {
    throw new DomainError(
      `Use at least ${PASSWORD_MIN} characters.`,
      'identity.password_too_short',
    );
  }

  if (password !== confirmation) {
    throw new DomainError('Those passwords do not match.', 'identity.password_mismatch');
  }
}

export async function signInWithPassword(
  db: Db,
  input: { email: string; password: string },
): Promise<void> {
  const email = normaliseEmail(input.email);

  if (input.password.length === 0) {
    throw new DomainError('Enter your password.', 'identity.password_required');
  }

  const { error } = await db.auth.signInWithPassword({ email, password: input.password });

  if (error) {
    // One message for "no such account" and "wrong password" — distinguishing them tells an attacker which addresses are registered.
    throw new DomainError('That email and password do not match.', 'identity.rejected');
  }
}

export async function registerWithPassword(
  db: Db,
  input: {
    email: string;
    password: string;
    passwordConfirmation: string;
    emailRedirectTo?: string;
  },
): Promise<void> {
  const email = normaliseEmail(input.email);
  checkPassword(input.password, input.passwordConfirmation);

  const { error } = await db.auth.signUp({
    email,
    password: input.password,
    options: input.emailRedirectTo ? { emailRedirectTo: input.emailRedirectTo } : undefined,
  });

  if (error) {
    throw new DomainError(error.message, 'identity.registration_failed');
  }
}

/**
 * Ask for a link that lets somebody set a new password.
 *
 * **It reports success whatever happened, and that is the point.** `signInWithPassword` above
 * already refuses to distinguish *no such account* from *wrong password*, because telling the two
 * apart tells an attacker which addresses are registered. A reset form is the easier place to
 * make that mistake, since there is no password to be wrong — so this returns nothing either way
 * and the screen says the same sentence to everybody. A provider error is swallowed for the same
 * reason rather than out of carelessness.
 *
 * `redirectTo` is decided by the caller and never by the person filling the form. It is a fixed
 * literal at the one call site, for the reason `proxy.ts` refuses a `?next=` parameter: a
 * destination that travels with a request has to be checked against a closed set on the way in
 * and on the way out, and nothing here needs one.
 */
export async function requestPasswordReset(
  db: Db,
  input: { email: string; redirectTo: string },
): Promise<void> {
  const email = normaliseEmail(input.email);

  await db.auth.resetPasswordForEmail(email, { redirectTo: input.redirectTo });
}

/**
 * Set a new password, for somebody who arrived holding a recovery link.
 *
 * **Nothing here decides whether they may.** The recovery link is what proves who they are, and
 * Supabase turned it into a session before this runs; with no session the update is refused by
 * the auth server, which is the boundary. This applies the same length and confirmation rules
 * registration does, from the same function, so the two cannot drift apart.
 */
export async function setNewPassword(
  db: Db,
  input: { password: string; passwordConfirmation: string },
): Promise<void> {
  checkPassword(input.password, input.passwordConfirmation);

  const { error } = await db.auth.updateUser({ password: input.password });

  if (error) {
    throw new DomainError(
      // The one case worth its own sentence: an expired or already-used link is the ordinary
      // failure here, and "something went wrong" would send somebody back to the same dead link.
      'That link has expired or has already been used. Ask for a new one.',
      'identity.recovery_invalid',
    );
  }
}

/**
 * Start Google sign-in. Supabase brokers the whole OAuth exchange — this repository holds no
 * Google client secret, only the URL to send the browser to and the address it wants back
 * (docs/environment-setup.md, Google OAuth: the client id and secret live in Supabase's own
 * provider configuration, never in this codebase or in Vercel).
 *
 * Returns a URL rather than redirecting itself, because there is no browser Supabase client in
 * this codebase (every other flow here is a server action) — the caller redirects to it.
 * `redirectTo` is a fixed literal built by the caller from its own request, for the same reason
 * `requestPasswordReset` above takes one: a destination that travelled with the request would
 * have to be checked against a closed set on the way in and on the way out.
 */
export async function signInWithGoogle(db: Db, input: { redirectTo: string }): Promise<string> {
  const { data, error } = await db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: input.redirectTo, skipBrowserRedirect: true },
  });

  if (error || !data.url) {
    throw new DomainError('Google sign-in is not available right now.', 'identity.oauth_unavailable');
  }

  return data.url;
}

export async function signOut(db: Db): Promise<void> {
  const { error } = await db.auth.signOut();

  if (error) {
    throw new DomainError(error.message, 'identity.sign_out_failed');
  }
}
