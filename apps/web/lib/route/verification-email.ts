import { cookies } from 'next/headers';

const NAME = 'gildops.verification-email';
export async function storeVerificationEmail(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) return;
  (await cookies()).set(NAME, normalized, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 86400 });
}
export async function readVerificationEmail(): Promise<string | null> {
  return (await cookies()).get(NAME)?.value ?? null;
}
export async function clearVerificationEmail(): Promise<void> {
  (await cookies()).delete(NAME);
}
