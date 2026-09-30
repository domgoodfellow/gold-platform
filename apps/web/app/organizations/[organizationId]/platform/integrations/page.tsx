import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { ButtonLink } from '@/components/controls/button';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { getDb } from '@/lib/db/server';
import { connectorLogoUrl, connectorUsage, listConnectors } from '@/lib/domain/integrations/connectors';
import { ConnectorIcon } from '@/features/integrations/catalogue/connector-icon';

export const dynamic = 'force-dynamic';

export default async function PlatformIntegrationsPage({ params }: PageProps<'/organizations/[organizationId]/platform/integrations'>) {
  const { organizationId: goldId } = await params;
  await requirePlatformArea(goldId, 'platform.catalogue');
  const db = await getDb();
  const [connectors, usage] = await Promise.all([listConnectors(db), connectorUsage(db)]);

  return (
    <AppPage>
      <PageHeader
        title="Connectors"
        crumbs={platformAncestry(goldId, 'connectors')}
        description="The kinds of outside app GildOps supports, which a business then connects. Who GildOps buys infrastructure from is under Providers."
        actions={<ButtonLink href={platformHref(goldId, 'integrations/new')} size="small">New connector</ButtonLink>}
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
              <Link
                href={platformHref(goldId, `integrations/${connector.key}`)}
                className="flex items-center gap-2 font-medium underline-offset-4 hover:underline"
              >
                <ConnectorIcon
                  connector={connector}
                  logoUrl={connector.iconRef ? connectorLogoUrl(db, connector.iconRef) : null}
                  size="small"
                />
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
          { key: 'organizations', header: 'Businesses connected', cell: (connector) => usage.get(connector.key)?.organizations ?? 0 },
          {
            key: 'attention',
            header: 'Needs attention',
            cell: (connector) => {
              const count = usage.get(connector.key)?.attentionConnections ?? 0;
              return count > 0 ? <Badge tone="danger">{count}</Badge> : '—';
            },
          },
        ]}
      />
    </AppPage>
  );
}
