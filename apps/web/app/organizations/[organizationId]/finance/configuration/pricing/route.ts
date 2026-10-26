import { NextResponse, type NextRequest } from 'next/server';
import { requireOrganization } from '@/lib/route/organization';

/**
 * Compatibility only. Trading currency and payment collection live in Organization Settings →
 * General, their one owner; the price book is Finance's Catalog & Pricing. A plain HTTP redirect,
 * not a page, so the browser keeps an old link's `#getting-paid` anchor across it. Only a member
 * of the business is redirected; General then checks what they may change.
 */
export async function GET(request: NextRequest, { params }: RouteContext<'/organizations/[organizationId]/finance/configuration/pricing'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);
  return NextResponse.redirect(new URL(`/organizations/${organizationId}/settings/general${request.nextUrl.search}`, request.url), 307);
}
