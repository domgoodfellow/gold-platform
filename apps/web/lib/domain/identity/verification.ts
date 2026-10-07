import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

export async function verifySignupEmail(db: Db, input: { email: string; code: string }): Promise<void> {
  const code = input.code.trim();
  if (!/^\d{6,10}$/.test(code)) throw new DomainError('Enter the code from your email.', 'identity.code_invalid');
  const { data, error } = await db.auth.verifyOtp({ email: input.email, token: code, type: 'signup' });
  if (error || !data.session || !data.user?.email_confirmed_at) {
    throw new DomainError('That code is invalid, expired, or already used. Request a new code.', 'identity.code_expired');
  }
}
export async function requestSignupVerification(db: Db, input: { email: string }): Promise<void> {
  const { error } = await db.auth.resend({ type: 'signup', email: input.email });
  if (error) throw new DomainError('Unable to send a code. Wait a minute and try again.', 'identity.code_delivery_failed');
}
