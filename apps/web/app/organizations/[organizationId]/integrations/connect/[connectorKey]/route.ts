import { NextResponse } from 'next/server';
import { requireOrganization } from '@/lib/route/organization';

export async function GET(
  request: Request,
  { params }: RouteContext<'/organizations/[organizationId]/integrations/connect/[connectorKey]'>,
) {
  const { organizationId, connectorKey } = await params;
  await requireOrganization(organizationId);
  const target = new URL(
    `/organizations/${organizationId}/settings/connections/connect/${connectorKey}`,
    request.url,
  );
  target.search = new URL(request.url).search;
  return NextResponse.redirect(target);
}
