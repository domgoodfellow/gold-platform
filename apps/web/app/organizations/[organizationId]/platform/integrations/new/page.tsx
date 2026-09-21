import { requirePlatformArea } from '@/lib/route/platform';
import { platformHref } from '@/lib/platform-navigation';
import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { ConnectorForm } from '@/features/platform/integrations/connector-form';

export default async function NewConnectorPage({
  params,
}: PageProps<'/organizations/[organizationId]/platform/integrations/new'>) {
  const { organizationId: goldId } = await params;
  await requirePlatformArea(goldId, 'platform.catalogue');
  return (
    <AppPage>
      <PageHeader title="New connector" crumbs={[{ label: 'Integrations', href: platformHref(goldId, 'integrations') }]} />
      <ConnectorForm connector={null} />
    </AppPage>
  );
}
