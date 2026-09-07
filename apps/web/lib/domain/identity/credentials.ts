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
