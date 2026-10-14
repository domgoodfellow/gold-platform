import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import { workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { portalEditorState, portalModuleAvailability } from '@/lib/domain/portal/definitions';
import { getBrand, logoUrl } from '@/lib/domain/branding/brand';
import { publicProfile } from '@/lib/domain/tenancy/profile';
import { PortalWorkbench } from '@/features/studio/portal/portal-workbench';
import { listEnabledModules } from '@/lib/domain/tenancy/modules';

export const dynamic = 'force-dynamic';
export default async function StudioPortalPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/studio/portal'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const allowed = organization.capabilities.includes('organization.manage');
  const state = allowed ? await portalEditorState(db, organizationId) : null;
  const enabled = (await listEnabledModules(db, { organizationId })).has('portal');
  const [brand, profile, availability, query] = await Promise.all([getBrand(db,{organizationId}),publicProfile(db,{organizationId,fallbackName:organization.name}),allowed ? portalModuleAvailability(db,organizationId) : Promise.resolve(null),searchParams]);
  return <AppPage><PageHeader title="Customer portal" crumbs={workspaceAncestry(organizationId, 'studio-portal')}/>
    {state && availability ? <PortalWorkbench organizationId={organizationId} timezone={organization.timezone} enabled={enabled} {...state} brand={brand} profile={profile} logo={brand.logoPath ? logoUrl(db,brand.logoPath) : null} availability={availability} initialTemplate={typeof query.template === 'string' ? query.template : undefined}/> : <Hint>Your role cannot compose or preview the customer portal.</Hint>}
  </AppPage>;
}
