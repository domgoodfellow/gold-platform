import { SupportConfigurationPage } from '@/features/support/configuration';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';
export default async function Page({ params }: PageProps<'/organizations/[organizationId]/support/configuration/service-levels'>) {
 const { organizationId } = await params;
 await requireConfigurationTarget(organizationId, 'support-service-levels');
 return <SupportConfigurationPage organizationId={organizationId} kind="policy" />;
}
