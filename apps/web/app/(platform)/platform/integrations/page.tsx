import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { ButtonLink } from '@/components/controls/button';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { getDb } from '@/lib/db/server';
import { listConnectors } from '@/lib/domain/integrations/connectors';

export const dynamic = 'force-dynamic';

export default async function PlatformIntegrationsPage() {
  const connectors = await listConnectors(await getDb());

  return (
    <AppPage width="full">
      <PageHeader
        title="Integrations"
        description="The outside apps a business may connect. This is the catalogue — who GOLD buys infrastructure from is under Providers."
        actions={<ButtonLink href="/platform/integrations/new" size="small">New connector</ButtonLink>}
      />
      <DataTable
        rows={connectors}
        rowKey={(connector) => connector.key}
        empty="No connectors yet."
        columns={[
          {
            key: 'name',
            header: 'Connector',
            emphasis: 'primary',
            cell: (connector) => (
              <Link href={`/platform/integrations/${connector.key}`} className="font-medium underline-offset-4 hover:underline">
                {connector.name}
              </Link>
            ),
          },
          { key: 'category', header: 'Category', cell: (connector) => connector.category },
          { key: 'suite', header: 'Suite', cell: (connector) => connector.suite ?? '—' },
          {
            key: 'status',
            header: 'Status',
            cell: (connector) => (
              <Badge tone={connector.status === 'live' ? 'success' : connector.status === 'beta' ? 'accent' : 'neutral'}>
                {connector.status}
              </Badge>
            ),
          },
          { key: 'visibility', header: 'Visibility', cell: (connector) => (connector.isPublic ? 'Public' : 'Private') },
          { key: 'method', header: 'Connects by', cell: (connector) => connector.connectionMethod },
          { key: 'capabilities', header: 'Capabilities', cell: (connector) => connector.capabilities.length },
        ]}
      />
    </AppPage>
  );
}
