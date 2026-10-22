import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { WorkCreatePage } from '@/features/work/work-create-page';
import { workCreateOptions } from '@/lib/application/work/create-options';
import { requireOrganization } from '@/lib/route/organization';
import { areaAvailable } from '@/lib/navigation';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';

export const dynamic = 'force-dynamic';

export default async function NewWorkPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/work/new'>) {
  const { organizationId } = await params;
  const { type } = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('work_item.create')) notFound();
  const features = await organizationResolvedFeatureStates(db, { organizationId });
  const state = { enabled: activeModuleKeys(features), featureAvailability: availableFeatureKeys(features), capabilities: new Set(organization.capabilities) };
  if (!areaAvailable('work', state)) notFound();
  const options = await workCreateOptions(db, organizationId, areaAvailable('assets', state));
  return <AppPage>
    <PageHeader title="New work" crumbs={[{ label: 'Work Items', href: `/organizations/${organizationId}/work` }]} />
    <WorkCreatePage options={options} initialTypeId={typeof type === 'string' ? type : undefined} mayConfigure={organization.capabilities.includes('field.manage')} />
  </AppPage>;
}
