import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/types';
import { changePassword, registerWithPassword, setNewPassword } from '@/lib/domain/identity/credentials';
import { requestEmailChange, requestEmailChangeProof, updatePersonalProfile } from '@/lib/domain/identity/profile';

const PASSWORD = 'a long new passphrase for this account';
function clients() {
  const user = { id: 'person-1', email: 'old@example.test' };
  const auth = {
    getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: user.id, amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] } }, error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    signUp: vi.fn().mockResolvedValue({ error: null }),
  };
  const verification = {
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user, session: {} }, error: null }),
    signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: { user, session: {} }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
  return { db: { auth } as unknown as Db, verifier: { auth: verification } as unknown as Db, auth, verification };
}
const passwordInput = { currentPassword: 'the current password', password: PASSWORD, passwordConfirmation: PASSWORD };
const emailInput = { email: 'new@example.test', code: '123456', redirectTo: 'http://localhost:3000/auth/email-change' };

describe('password change requires fresh proof of the acting identity', () => {
  it('refuses an empty current password before calling Auth', async () => {
    const { db, verifier, auth } = clients();
    await expect(changePassword(db, { ...passwordInput, currentPassword: '' }, verifier)).rejects.toMatchObject({ code: 'identity.current_password_required' });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it('refuses anonymous calls', async () => {
    const { db, verifier, auth } = clients();
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(changePassword(db, passwordInput, verifier)).rejects.toMatchObject({ code: 'auth.required' });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it.each(['wrong password', 'different identity'])('rejects %s without changing the password', async (reason) => {
    const { db, verifier, auth, verification } = clients();
    verification.signInWithPassword.mockResolvedValue(reason === 'wrong password'
      ? { data: { user: null, session: null }, error: { message: 'bad password' } }
      : { data: { user: { id: 'someone-else' }, session: {} }, error: null });
    await expect(changePassword(db, passwordInput, verifier)).rejects.toMatchObject({ code: 'identity.current_password_rejected' });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it('sends current_password and optional nonce to Auth, revoking only the temporary session', async () => {
    const { db, verifier, auth, verification } = clients();
    await changePassword(db, { ...passwordInput, nonce: '123456' }, verifier);
    expect(auth.updateUser).toHaveBeenCalledWith({ current_password: passwordInput.currentPassword, password: PASSWORD, nonce: '123456' });
    expect(verification.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('keeps the update failed and cleans up proof when Auth rejects the new password', async () => {
    const { db, verifier, auth, verification } = clients();
    auth.updateUser.mockResolvedValue({ error: { message: 'Password was leaked' } });
    await expect(changePassword(db, passwordInput, verifier)).rejects.toMatchObject({ code: 'identity.password_change_failed' });
    expect(verification.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('cannot bypass current-password checks through the recovery action', async () => {
    const { db, auth } = clients();
    await expect(setNewPassword(db, passwordInput)).rejects.toMatchObject({ code: 'identity.recovery_invalid' });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it('rejects expired recovery proof', async () => {
    const { db, auth } = clients();
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: 'person-1', amr: [{ method: 'recovery', timestamp: Math.floor(Date.now() / 1000) - 3601 }] } }, error: null });
    await expect(setNewPassword(db, passwordInput)).rejects.toMatchObject({ code: 'identity.recovery_invalid' });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it('requires 15 characters for password-only registration but accepts 64 and more', async () => {
    const { db, auth } = clients();
    await expect(registerWithPassword(db, { email: 'new@example.test', password: 'x'.repeat(14), passwordConfirmation: 'x'.repeat(14) })).rejects.toMatchObject({ code: 'identity.password_too_short' });
    expect(auth.signUp).not.toHaveBeenCalled();
    await registerWithPassword(db, { email: 'new@example.test', password: 'x'.repeat(100), passwordConfirmation: 'x'.repeat(100) });
    expect(auth.signUp.mock.calls[0][0].password).toHaveLength(100);
  });
});

describe('personal profile and verified email change', () => {
  it('updates only cosmetic metadata, never a membership or permission', async () => {
    const { db, auth } = clients();
    await updatePersonalProfile(db, { displayName: '  Pat  ' });
    expect(auth.updateUser).toHaveBeenCalledWith({ data: { display_name: 'Pat' } });
  });
  it('sends proof only to the authenticated existing address and never creates an account', async () => {
    const { db, verifier, verification } = clients();
    await requestEmailChangeProof(db, verifier);
    expect(verification.signInWithOtp).toHaveBeenCalledWith({ email: 'old@example.test', options: { shouldCreateUser: false } });
  });
  it('refuses missing proof before updating the email', async () => {
    const { db, verifier, auth } = clients();
    await expect(requestEmailChange(db, { ...emailInput, code: '' }, verifier)).rejects.toMatchObject({ code: 'identity.email_proof_required' });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it.each(['expired code', 'different identity'])('rejects %s before any update', async (reason) => {
    const { db, verifier, auth, verification } = clients();
    verification.verifyOtp.mockResolvedValue(reason === 'expired code'
      ? { data: { user: null, session: null }, error: { message: 'expired' } }
      : { data: { user: { id: 'someone-else' }, session: {} }, error: null });
    await expect(requestEmailChange(db, emailInput, verifier)).rejects.toMatchObject({ code: 'identity.email_proof_rejected' });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it('binds proof to the current address, then requests an Auth-managed confirmed change', async () => {
    const { db, verifier, auth, verification } = clients();
    await requestEmailChange(db, emailInput, verifier);
    expect(verification.verifyOtp).toHaveBeenCalledWith({ email: 'old@example.test', token: '123456', type: 'email' });
    expect(auth.updateUser).toHaveBeenCalledWith({ email: 'new@example.test' }, { emailRedirectTo: emailInput.redirectTo });
    expect(verification.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
