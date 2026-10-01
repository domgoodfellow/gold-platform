import { redirect } from 'next/navigation';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformHref } from '@/lib/platform-navigation';
import { getDb } from '@/lib/db/server';
import { loadOrganizationCommercial } from '@/lib/application/platform/organization-commercial';
import { OrganizationCommercialScreen } from '@/features/platform/organizations/organization-commercial-screen';

export const dynamic = 'force-dynamic';

export default async function Commercial({ params }: PageProps<'/organizations/[organizationId]/platform/organizations/[targetOrganizationId]/commercial'>) {
  const { organizationId: goldId, targetOrganizationId: organizationId } = await params;
  // This page is reached by drilling into one organization from the Organizations list, so it
  // stays gated the way the registry (`platformRouteRequires`) and every sibling page under this
  // tree already are — `platform.organizations`. The commercial *write* controls below are a
  // narrower question: whether this caller also holds `platform.commercial`, checked separately so
  // staff who can see an organization cannot assign a Plan or record an agreement without it. Note
  // for the record: the underlying RPCs (`record_plan_assignment`, `record_organization_plan_agreement`,
  // `record_plan_quota_override`) check only `app.require_platform_staff()` today — any platform
  // staff row, not this granular permission — so hiding these controls is courtesy, not yet the boundary.
  const permissions = await requirePlatformArea(goldId, 'platform.organizations');
  const model = await loadOrganizationCommercial(await getDb(), organizationId);
  if (!model) redirect(platformHref(goldId, 'organizations'));
  return (
    <OrganizationCommercialScreen
      goldId={goldId}
      organizationId={organizationId}
      model={model}
      canManageCommercial={permissions.has('platform.commercial')}
    />
  );
}
