import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { EmptyState } from '@/components/containers/section';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Messages, the domain-facing shell for SMS/MMS/RCS. The catalogue carries `inbound_sms` and
 * `outbound_sms` as `planned` — no send path, no thread and no delivery record exist yet — so
 * this page says that truthfully rather than drawing an empty inbox that implies one does.
 */
export default async function CommsMessagesPage({
  params,
}: PageProps<'/organizations/[organizationId]/comms/messages'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);

  return (
    <AppPage>
      <PageHeader
        title={areaLabel('comms-messages')}
        crumbs={workspaceAncestry(organizationId, 'comms-messages')}
        description="SMS, MMS and RCS conversations with customers."
      />
      <EmptyState>Text messaging is not available on this deployment yet.</EmptyState>
    </AppPage>
  );
}
