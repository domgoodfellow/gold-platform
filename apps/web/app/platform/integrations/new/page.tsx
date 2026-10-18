import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { ConnectorForm } from '@/features/platform/integrations/connector-form';

export default async function NewConnectorPage({
  params,
}: PageProps<'/platform/integrations/new'>) {
  const { organizationId: goldId } = await platformParams(params);
  await requirePlatformArea(goldId, 'platform.catalogue');
  return (
    <AppPage>
      <PageHeader title="New connector" crumbs={[...platformAncestry(goldId, 'connectors'), { label: 'Connectors', href: platformHref(goldId, 'integrations') }]} />
      <ConnectorForm connector={null} />
    </AppPage>
  );
}
