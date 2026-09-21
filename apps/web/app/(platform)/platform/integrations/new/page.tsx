import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { ConnectorForm } from '@/features/platform/integrations/connector-form';

export default function NewConnectorPage() {
  return (
    <AppPage>
      <PageHeader title="New connector" crumbs={[{ label: 'Integrations', href: '/platform/integrations' }]} />
      <ConnectorForm connector={null} />
    </AppPage>
  );
}
