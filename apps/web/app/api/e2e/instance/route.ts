import { NextResponse } from 'next/server';
import { E2E_INSTANCE_HEADER, e2eInstanceIdentity } from '@/lib/testing/e2e-instance';

export const dynamic = 'force-dynamic';

/** Browser-harness identity check (lib/testing/e2e-instance.ts). 404 unless this is the tokened test instance. */
export function GET(request: Request) {
  const identity = e2eInstanceIdentity(process.env, request.headers.get(E2E_INSTANCE_HEADER));
  if (!identity) return new NextResponse(null, { status: 404 });
  return NextResponse.json(identity, { headers: { 'cache-control': 'no-store' } });
}
