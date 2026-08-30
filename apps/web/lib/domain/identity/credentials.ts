import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * Identity is global; membership binds a user to an organization. Nothing in this file
 * knows about tenants — that is `domain/tenancy`'s job, and keeping the two apart is what
 * lets one person belong to several businesses.
 *
 * These functions name a capability — *sign in with a password* — and not a provider. The
 * Supabase auth calls live behind `Db`; if identity ever moves, this file's signatures are
 * the contract that survives.
 */

/**
 * Minimum password length the platform accepts.
 *
 * The local Supabase config sets its own minimum, but a provider setting is a backstop,
 * not the rule: the rule is checked here so that every caller — form, API, future AI tool —
 * gets the same answer and the same message. Becomes per-tenant configuration the first
 * time a tenant asks for a stricter policy (constraints.md, "Never hardcode").
 */
const PASSWORD_MIN = 8;

function normaliseEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  // Deliberately not a full RFC 5322 validator. The address is proven by whether the
  // account can actually be reached, never by a regex.
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

  // The confirmation is checked here rather than in the form, because `credentials-form.tsx`
  // renders whatever message the domain returned and composes none of its own — a second
  // sentence written there would be a second rule. It guards a typo in the one credential
  // nobody can recover for you.
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
    // Deliberately one message for "no such account" and "wrong password". Distinguishing
    // them tells an attacker which addresses are registered.
    throw new DomainError('That email and password do not match.', 'identity.rejected');
  }
}

export async function registerWithPassword(
  db: Db,
  input: { email: string; password: string; passwordConfirmation: string },
): Promise<void> {
  const email = normaliseEmail(input.email);
  checkPassword(input.password, input.passwordConfirmation);

  const { error } = await db.auth.signUp({ email, password: input.password });

  if (error) {
    throw new DomainError(error.message, 'identity.registration_failed');
  }
}

export async function signOut(db: Db): Promise<void> {
  const { error } = await db.auth.signOut();

  if (error) {
    throw new DomainError(error.message, 'identity.sign_out_failed');
  }
}
