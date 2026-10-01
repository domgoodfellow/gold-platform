import { redirect } from 'next/navigation';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformHref } from '@/lib/platform-navigation';
import { getDb } from '@/lib/db/server';
import { loadOrganizationCommercial } from '@/lib/application/platform/organization-commercial';
import { OrganizationCommercialScreen } from '@/features/platform/organizations/organization-commercial-screen';

export const dynamic = 'force-dynamic';

export default async function Commercial({ params }: PageProps<'/organizations/[organizationId]/platform/organizations/[targetOrganizationId]/commercial'>) {
  const { organizationId: goldId, targetOrganizationId: organizationId } = await params;
  await requirePlatformArea(goldId, 'platform.organizations');
  const model = await loadOrganizationCommercial(await getDb(), organizationId);
  if (!model) redirect(platformHref(goldId, 'organizations'));
  return <OrganizationCommercialScreen goldId={goldId} organizationId={organizationId} model={model} />;
}
