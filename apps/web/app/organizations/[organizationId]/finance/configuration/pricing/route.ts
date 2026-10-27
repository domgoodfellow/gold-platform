import type { NextRequest } from 'next/server';
import { requireOrganization } from '@/lib/route/organization';
import { configurationTargetOffered } from '@/lib/route/workspace-configuration';
import { legacyPaymentSettingsHref } from '@/lib/route/settings';

/**
 * Compatibility only. Payment collection lives in Organization Settings → Customer payments and
 * trading currency in General; the price book is Finance's Catalog & Pricing. A plain HTTP redirect,
 * not a page, so the browser keeps an old link's `#getting-paid` anchor across it. The Location is
 * relative, so the browser stays on the host it used (and its session) whatever host the server sees.
 * Only a member of the business is redirected; a member who cannot manage payments lands on General.
 */
export async function GET(request: NextRequest, { params }: RouteContext<'/organizations/[organizationId]/finance/configuration/pricing'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);
  const offered = await configurationTargetOffered(organizationId, 'payments');
  return new Response(null, { status: 307, headers: { Location: `${legacyPaymentSettingsHref(organizationId, offered)}${request.nextUrl.search}` } });
}
