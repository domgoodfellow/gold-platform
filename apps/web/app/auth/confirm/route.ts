import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/server';
import { resolvePostAuthDestination } from '@/lib/route/landing';

/** Email links terminate on the product host. No user-supplied redirect destinations. */
export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type');
  const token_hash = request.nextUrl.searchParams.get('token_hash');
  const to = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path, 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' } });
  if (!token_hash || (type !== 'recovery' && type !== 'invite' && type !== 'email_change')) return to('/login');
  const db = await getDb();
  const { error } = await db.auth.verifyOtp({ token_hash, type });
  if (error) return to(type === 'email_change' ? '/settings/account?emailChange=failed' : '/forgot-password');
  if (type === 'recovery') return to('/reset-password');
  if (type === 'email_change') return to('/settings/account?emailChange=confirmed');
  return to(await resolvePostAuthDestination(db));
}
