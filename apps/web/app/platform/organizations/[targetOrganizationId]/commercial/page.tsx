import { platformParams } from '@/lib/route/platform';
import { redirect } from 'next/navigation';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformHref } from '@/lib/platform-navigation';
import { getDb } from '@/lib/db/server';
import { loadOrganizationCommercial } from '@/lib/application/platform/organization-commercial';
import { loadOrganizationEconomics } from '@/lib/application/platform/economics-overview';
import { OrganizationCommercialScreen } from '@/features/platform/organizations/organization-commercial-screen';

export const dynamic = 'force-dynamic';

export default async function Commercial({ params }: PageProps<'/platform/organizations/[targetOrganizationId]/commercial'>) {
  const { organizationId: goldId, targetOrganizationId: organizationId } = await platformParams(params);
  // This page is reached by drilling into one organization from the Organizations list, so it
  // stays gated the way the registry (`platformRouteRequires`) and every sibling page under this
  // tree already are — `platform.organizations`. The commercial *write* controls below are a
  // narrower question: whether this caller also holds `platform.commercial`, checked separately so
  // staff who can see an organization cannot assign a Plan or record an agreement without it. That
  // check is the real boundary on both sides now, not just a reason to hide a control: the server
  // actions behind these controls (`requirePlatformCapability`) and the RPCs underneath them
  // (`record_plan_assignment`, `record_organization_plan_agreement`, `record_plan_quota_override`,
  // `record_commercial_term` — `app.require_platform_capability('platform.commercial')`) both
  // refuse a staff row that names only `platform.organizations` (Work Order A0).
  const permissions = await requirePlatformArea(goldId, 'platform.organizations');
  const db = await getDb();
  const canManageCommercial = permissions.has('platform.commercial');
  const [model, economics] = await Promise.all([
    loadOrganizationCommercial(db, organizationId),
    // Loaded only for a caller who could reach the Economics tab at all — the same gate the
    // screen itself re-checks by only rendering the tab when this is non-null.
    canManageCommercial ? loadOrganizationEconomics(db, { organizationId }) : Promise.resolve(null),
  ]);
  if (!model) redirect(platformHref(goldId, 'organizations'));
  return (
    <OrganizationCommercialScreen
      goldId={goldId}
      organizationId={organizationId}
      model={model}
      canManageCommercial={canManageCommercial}
      economics={economics}
    />
  );
}
