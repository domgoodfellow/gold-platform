import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPersonalProfile, requestEmailChange, updatePersonalProfile } from '@/lib/domain/identity/profile';
import { verifySignupEmail, requestSignupVerification } from '@/lib/domain/identity/verification';
import { DomainError } from '@/lib/domain/errors';
import {
  changePassword,
  setNewPassword,
  registerWithPassword as beginRegistration,
  signInWithPassword,
  signOut,
} from '@/lib/domain/identity/credentials';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const MAIL_URL = process.env.SUPABASE_MAIL_URL ?? 'http://127.0.0.1:54324';

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signupCode(address: string, previousCode?: string): Promise<string> {
  if (!['localhost', '127.0.0.1'].includes(new URL(SUPABASE_URL).hostname)) throw new Error('Mail capture fixtures are local-only.');
  if (!['localhost', '127.0.0.1'].includes(new URL(MAIL_URL).hostname)) throw new Error('Mail capture fixtures require a loopback mail service.');
  for (let attempt = 0; attempt < 30; attempt++) {
    const inbox = await (await fetch(`${MAIL_URL}/api/v1/messages`)).json();
    const message = inbox.messages?.find((entry: { To: { Address: string }[]; Subject: string }) =>
      entry.To.some((recipient) => recipient.Address === address) && entry.Subject === 'Verify your GildOps email');
    if (message) {
      const content = await (await fetch(`${MAIL_URL}/api/v1/message/${message.ID}`)).json();
      const code = content.HTML?.match(/>([0-9]{6})<\/p>/)?.[1];
      if (code && code !== previousCode) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Signup verification email was not captured.');
}

async function registerWithPassword(client: SupabaseClient, input: Parameters<typeof beginRegistration>[1]) {
  const result = await beginRegistration(client, input);
  if (result.verificationRequired) await verifySignupEmail(client, { email: input.email.trim().toLowerCase(), code: await signupCode(input.email.trim().toLowerCase()) });
  return result;
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
  it('saves the canonical personal profile under the acting account', async () => {
    const session = anonClient();
    const address = `profile-${randomUUID().slice(0, 8)}@example.test`;
    await registerWithPassword(session, { email: address, password: PASSWORD, passwordConfirmation: PASSWORD });
    await updatePersonalProfile(session, { given_name: 'Pat', family_name: 'Lee', preferred_name: 'Personal display name', avatar: null, locale: 'en', timezone: 'UTC' });
    expect((await getPersonalProfile(session)).preferred_name).toBe('Personal display name');
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
    // Auth and the test runner can straddle a clock-second boundary. Wait for the signed
    // proof's timestamp; retain the production rejection of future or stale recovery proof.
    await vi.waitFor(async () => {
      const { data: claims, error: claimsError } = await recovered.auth.getClaims();
      expect(claimsError).toBeNull();
      expect(claims?.claims.amr?.some(method => typeof method === 'object' && method !== null && ['recovery','otp'].includes(method.method) && method.timestamp <= Math.floor(Date.now()/1000))).toBe(true);
    }, { timeout: 5_000, interval: 50 });
    await setNewPassword(recovered, { password: 'a fresh recovered password', passwordConfirmation: 'a fresh recovered password' });
    await signInWithPassword(anonClient(), { email: address, password: 'a fresh recovered password' });
  });
});


describe('signup verification and profile privacy', () => {
  it('rejects an expired code and resends a new branded signup email', async () => {
    const session = anonClient();
    const address = `expired-${randomUUID().slice(0, 8)}@example.test`;
    await beginRegistration(session, { email: address, password: PASSWORD, passwordConfirmation: PASSWORD });
    const code = await signupCode(address);
    const pg = new Client(process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    await pg.connect();
    try { await pg.query("update auth.users set confirmation_sent_at = now() - interval '2 hours' where email = $1", [address]); }
    finally { await pg.end(); }
    await expect(verifySignupEmail(session, { email: address, code })).rejects.toMatchObject({ code: 'identity.code_expired' });
    await requestSignupVerification(session, { email: address });
    await verifySignupEmail(session, { email: address, code: await signupCode(address, code) });
    expect((await session.auth.getUser()).data.user?.email_confirmed_at).toBeTruthy();
  });

  it('requires email verification, rejects bad and reused codes, and creates the profile once', async () => {
    const session = anonClient();
    const address = `verify-${randomUUID().slice(0, 8)}@example.test`;
    const result = await beginRegistration(session, { email: address, password: PASSWORD, passwordConfirmation: PASSWORD, givenName: 'Pat', familyName: 'Lee' });
    expect(result.verificationRequired).toBe(true);
    expect((await session.auth.getUser()).data.user).toBeNull();
    await expect(signInWithPassword(session, { email: address, password: PASSWORD })).rejects.toMatchObject({ code: 'identity.email_unverified' });
    await expect(verifySignupEmail(session, { email: address, code: '000000' })).rejects.toMatchObject({ code: 'identity.code_expired' });
    const code = await signupCode(address);
    await verifySignupEmail(session, { email: address, code });
    expect((await getPersonalProfile(session)).given_name).toBe('Pat');
    await expect(verifySignupEmail(anonClient(), { email: address, code })).rejects.toMatchObject({ code: 'identity.code_expired' });
    const id = (await session.auth.getUser()).data.user!.id;
    const stranger = anonClient();
    await registerWithPassword(stranger, { email: `stranger-${randomUUID().slice(0, 8)}@example.test`, password: PASSWORD, passwordConfirmation: PASSWORD });
    expect((await stranger.from('account_profiles').select('*').eq('user_id', id)).data).toEqual([]);
    const forged = await stranger.from('account_profiles').update({ preferred_name: 'Forged' }).eq('user_id', id).select();
    expect(forged.data).toEqual([]);
    expect((await getPersonalProfile(session)).preferred_name).toBe('');
  });
});

describe('private account contact data under RLS', () => {
  it('persists optional contact data, keeps it private, and supports clearing it', async () => {
    const owner = anonClient();
    const stranger = anonClient();
    await registerWithPassword(owner, { email: `contact-${randomUUID().slice(0, 8)}@example.test`, password: PASSWORD, passwordConfirmation: PASSWORD });
    await registerWithPassword(stranger, { email: `outsider-${randomUUID().slice(0, 8)}@example.test`, password: PASSWORD, passwordConfirmation: PASSWORD });
    const id = (await owner.auth.getUser()).data.user!.id;
    const initial = await getPersonalProfile(owner);
    expect(initial.phone_e164).toBeNull();
    expect(initial.country_code).toBeNull();
    await updatePersonalProfile(owner, { ...initial, phone_e164: ' +819012345678 ', address_line_1: ' 10 Main Street ', address_line_2: ' Apt 2 ', city: ' Kyoto ', administrative_area: ' Kyoto ', postal_code: ' 600-8001 ', country_code: ' jp ' });
    expect(await getPersonalProfile(owner)).toMatchObject({ phone_e164: '+819012345678', address_line_1: '10 Main Street', address_line_2: 'Apt 2', city: 'Kyoto', administrative_area: 'Kyoto', postal_code: '600-8001', country_code: 'JP' });
    const hidden = await stranger.from('account_profiles').select('*').eq('user_id', id);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);
    const forged = await stranger.from('account_profiles').update({ city: 'Forged' }).eq('user_id', id).select();
    expect(forged.error).toBeNull();
    expect(forged.data).toEqual([]);
    expect((await getPersonalProfile(owner)).city).toBe('Kyoto');
    const invalid = await owner.from('account_profiles').update({ phone_e164: 'not-a-number' }).eq('user_id', id);
    expect(invalid.error?.code).toBe('23514');
    await updatePersonalProfile(owner, { ...initial, phone_e164: ' ', address_line_1: '', country_code: '' });
    expect(await getPersonalProfile(owner)).toMatchObject({ phone_e164: null, address_line_1: null, country_code: null });
  });
  it('excludes anonymous identities from profile creation, reads and updates', async () => {
    const pg = new Client(process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    const id = randomUUID();
    await pg.connect();
    try {
      await pg.query('begin');
      await pg.query("insert into auth.users (id, is_anonymous) values ($1, true)", [id]);
      expect((await pg.query('select * from public.account_profiles where user_id = $1', [id])).rows).toEqual([]);
      // Even a legacy row belonging to this anonymous identity must remain inaccessible.
      await pg.query('insert into public.account_profiles(user_id, city) values ($1, $2)', [id, 'Private city']);
      await pg.query('set local role authenticated');
      await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: 'authenticated', is_anonymous: true })]);
      expect((await pg.query('select * from public.account_profiles')).rows).toEqual([]);
      expect((await pg.query("update public.account_profiles set city = 'Forged' returning user_id")).rows).toEqual([]);
      await expect(pg.query('insert into public.account_profiles(user_id, city) values ($1, $2)', [id, 'Kyoto'])).rejects.toMatchObject({ code: '42501' });
    } finally {
      await pg.query('rollback');
      await pg.end();
    }
  });
});
