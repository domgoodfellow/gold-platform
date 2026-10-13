import { SupportConfigurationPage } from '@/features/support/configuration';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';
export default async function Page({ params }: PageProps<'/organizations/[organizationId]/support/configuration/queues'>) {
 const { organizationId } = await params;
 await requireConfigurationTarget(organizationId, 'support-queues');
 return <SupportConfigurationPage organizationId={organizationId} kind="queue" />;
}
