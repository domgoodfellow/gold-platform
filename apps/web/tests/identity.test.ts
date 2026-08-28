import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '@/lib/domain/errors';
import {
  registerWithPassword,
  signInWithPassword,
  signOut,
} from '@/lib/domain/identity/credentials';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

let db: SupabaseClient;
let email: string;
const PASSWORD = 'correct-horse-battery';

describe('password identity', () => {
  beforeEach(() => {
    db = anonClient();
    email = `user-${randomUUID().slice(0, 8)}@example.test`;
  });

  it('registers and then signs in', async () => {
    await registerWithPassword(db, { email, password: PASSWORD, passwordConfirmation: PASSWORD });
    await signOut(db);

    const fresh = anonClient();
    await signInWithPassword(fresh, { email, password: PASSWORD });

    const { data } = await fresh.auth.getUser();
    expect(data.user?.email).toBe(email);
  });

  it('normalises the email so case and spacing do not create a second account', async () => {
    await registerWithPassword(db, { email, password: PASSWORD, passwordConfirmation: PASSWORD });

    const fresh = anonClient();
    await signInWithPassword(fresh, { email: `  ${email.toUpperCase()}  `, password: PASSWORD });

    const { data } = await fresh.auth.getUser();
    expect(data.user?.email).toBe(email);
  });

  it('rejects a short password before it reaches the provider', async () => {
    await expect(registerWithPassword(db, { email, password: 'short', passwordConfirmation: 'short' })).rejects.toMatchObject({
      code: 'identity.password_too_short',
    });
  });

  it('refuses a mistyped confirmation, and says so from the domain', async () => {
    // The rule lives here rather than in the form, because `credentials-form.tsx` renders
    // whatever the domain returned and composes no sentence of its own. It guards a typo in
    // the one credential nobody can recover for you.
    await expect(
      registerWithPassword(db, {
        email,
        password: PASSWORD,
        passwordConfirmation: `${PASSWORD}-typo`,
      }),
    ).rejects.toMatchObject({ code: 'identity.password_mismatch' });
  });

  it('rejects an address that is not one', async () => {
    await expect(
      registerWithPassword(db, { email: 'not-an-address', password: PASSWORD, passwordConfirmation: PASSWORD }),
    ).rejects.toMatchObject({ code: 'identity.email_invalid' });
  });

  it('does not reveal whether an account exists', async () => {
    await registerWithPassword(db, { email, password: PASSWORD, passwordConfirmation: PASSWORD });

    const wrongPassword = await signInWithPassword(anonClient(), {
      email,
      password: 'wrong-password-entirely',
    }).catch((error: unknown) => error as DomainError);

    const noSuchAccount = await signInWithPassword(anonClient(), {
      email: `absent-${randomUUID().slice(0, 8)}@example.test`,
      password: PASSWORD,
    }).catch((error: unknown) => error as DomainError);

    expect((wrongPassword as DomainError).message).toBe(
      (noSuchAccount as DomainError).message,
    );
    expect((wrongPassword as DomainError).code).toBe('identity.rejected');
  });

  it('signs out', async () => {
    await registerWithPassword(db, { email, password: PASSWORD, passwordConfirmation: PASSWORD });
    expect((await db.auth.getUser()).data.user).not.toBeNull();

    await signOut(db);
    expect((await db.auth.getUser()).data.user).toBeNull();
  });
});
