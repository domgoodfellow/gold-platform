import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { requestEmailChange, updatePersonalProfile } from '@/lib/domain/identity/profile';
import { DomainError } from '@/lib/domain/errors';
import {
  changePassword,
  setNewPassword,
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

describe('changing password from a signed-in session', () => {
  beforeEach(() => {
    db = anonClient();
    email = `user-${randomUUID().slice(0, 8)}@example.test`;
  });

  it('changes the password, which then signs in', async () => {
    await registerWithPassword(db, { email, password: PASSWORD, passwordConfirmation: PASSWORD });

    const NEW_PASSWORD = 'new-correct-horse-battery';
    await changePassword(db, { currentPassword: PASSWORD, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD }, anonClient());

    const fresh = anonClient();
    await signInWithPassword(fresh, { email, password: NEW_PASSWORD });
    expect((await fresh.auth.getUser()).data.user?.email).toBe(email);
  });

  it('rejects a wrong current password and keeps the old password working', async () => {
    await registerWithPassword(db, { email, password: PASSWORD, passwordConfirmation: PASSWORD });
    await expect(changePassword(db, {
      currentPassword: 'the wrong current password',
      password: 'a new password that must not be installed',
      passwordConfirmation: 'a new password that must not be installed',
    }, anonClient())).rejects.toMatchObject({ code: 'identity.current_password_rejected' });
    await signInWithPassword(anonClient(), { email, password: PASSWORD });
  });

  it('rejects a short password before it reaches the provider, same as registering', async () => {
    await registerWithPassword(db, { email, password: PASSWORD, passwordConfirmation: PASSWORD });

    await expect(
      changePassword(db, { currentPassword: PASSWORD, password: 'short', passwordConfirmation: 'short' }, anonClient()),
    ).rejects.toMatchObject({ code: 'identity.password_too_short' });
  });

  it('refuses a mistyped confirmation', async () => {
    await registerWithPassword(db, { email, password: PASSWORD, passwordConfirmation: PASSWORD });

    await expect(
      changePassword(db, { currentPassword: PASSWORD, password: 'a-new-password-long-enough', passwordConfirmation: 'a-typo' }, anonClient()),
    ).rejects.toMatchObject({ code: 'identity.password_mismatch' });
  });
});


describe('personal profile and email identity against local Auth', () => {
  it('saves a personal display name as Auth metadata only', async () => {
    const session = anonClient();
    const address = `profile-${randomUUID().slice(0, 8)}@example.test`;
    await registerWithPassword(session, { email: address, password: PASSWORD, passwordConfirmation: PASSWORD });
    await updatePersonalProfile(session, { displayName: 'Personal display name' });
    expect((await session.auth.getUser()).data.user?.user_metadata.display_name).toBe('Personal display name');
  });

  it('requires fresh proof, proposes a new address, and keeps the existing address until confirmation', async () => {
    if (!['localhost', '127.0.0.1'].includes(new URL(SUPABASE_URL).hostname)) throw new Error('Identity fixtures are local-only.');
    const session = anonClient();
    const address = `email-${randomUUID().slice(0, 8)}@example.test`;
    const nextAddress = `new-${address}`;
    await registerWithPassword(session, { email: address, password: PASSWORD, passwordConfirmation: PASSWORD });
    // Test-only fixture: mint the same single-use code Auth emails. No privileged client
    // participates in the application transaction, which runs under the user's own JWT.
    const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: address });
    expect(error).toBeNull();
    const code = data.properties?.email_otp ?? '';
    await requestEmailChange(session, { email: nextAddress, code, redirectTo: 'http://127.0.0.1:3000/auth/email-change' }, anonClient());
    const person = (await session.auth.getUser()).data.user;
    expect(person?.email).toBe(address);
    expect(person?.new_email).toBe(nextAddress);
    await expect(requestEmailChange(session, { email: nextAddress, code, redirectTo: 'http://127.0.0.1:3000/auth/email-change' }, anonClient())).rejects.toMatchObject({ code: 'identity.email_proof_rejected' });
  });
});


describe('recovery never accepts an ordinary active session', () => {
  it('rejects a password session even though it is authenticated', async () => {
    const session = anonClient();
    const address = `recovery-${randomUUID().slice(0, 8)}@example.test`;
    await registerWithPassword(session, { email: address, password: PASSWORD, passwordConfirmation: PASSWORD });
    await signInWithPassword(session, { email: address, password: PASSWORD });
    await expect(setNewPassword(session, { password: 'a candidate that must not be installed', passwordConfirmation: 'a candidate that must not be installed' })).rejects.toMatchObject({ code: 'identity.recovery_invalid' });
  });
  it('accepts fresh Auth-verified recovery email proof', async () => {
    if (!['localhost', '127.0.0.1'].includes(new URL(SUPABASE_URL).hostname)) throw new Error('Recovery fixtures are local-only.');
    const session = anonClient();
    const address = `recovery-${randomUUID().slice(0, 8)}@example.test`;
    await registerWithPassword(session, { email: address, password: PASSWORD, passwordConfirmation: PASSWORD });
    const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email: address });
    expect(error).toBeNull();
    const recovered = anonClient();
    const verified = await recovered.auth.verifyOtp({ token_hash: data.properties?.hashed_token ?? '', type: 'recovery' });
    expect(verified.error).toBeNull();
    await setNewPassword(recovered, { password: 'a fresh recovered password', passwordConfirmation: 'a fresh recovered password' });
    await signInWithPassword(anonClient(), { email: address, password: 'a fresh recovered password' });
  });
});
