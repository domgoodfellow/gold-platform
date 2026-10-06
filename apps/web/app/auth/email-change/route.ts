import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/server';

/** Fixed Account destination; never accept a redirect URL from the email link. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  // With dual confirmation, the first accepted link may have no auth code yet.
  // Account reads the actual pending address from Auth; a URL message is never proof.
  if (!code) return new NextResponse(null, {
    status: 303,
    headers: { Location: request.nextUrl.searchParams.has('error') ? '/settings/account?emailChange=failed' : '/settings/account' },
  });
  const { error } = await (await getDb()).auth.exchangeCodeForSession(code);
  return new NextResponse(null, {
    status: 303,
    headers: { Location: error ? '/settings/account?emailChange=failed' : '/settings/account?emailChange=confirmed' },
  });
}
