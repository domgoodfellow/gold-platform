import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { ButtonLink } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { getDb } from '@/lib/db/server';
import { connectorLogoUrl, connectorOperationalState, connectorUsage, listConnectors } from '@/lib/domain/integrations/connectors';
import { loadConnectorReadinessDetail } from '@/lib/domain/integrations/readiness';
import { ConnectorIcon } from '@/features/integrations/catalogue/connector-icon';
import { OperationalBadge } from '@/features/platform/integrations/connector-readiness';

export const dynamic = 'force-dynamic';

export default async function PlatformIntegrationsPage({ params }: PageProps<'/platform/integrations'>) {
  const { organizationId: goldId } = await platformParams(params);
  await requirePlatformArea(goldId, 'platform.catalogue');
  const db = await getDb();
  const [connectors, usage] = await Promise.all([listConnectors(db), connectorUsage(db)]);
  // Planned connectors are upcoming whatever the deployment holds, so only the rest are asked about.
  const detail = await loadConnectorReadinessDetail(
    db,
    connectors.filter((connector) => connector.status !== 'planned').map((connector) => connector.key),
  );

  return (
    <AppPage>
      <PageHeader
        title="Connectors"
        crumbs={platformAncestry(goldId, 'connectors')}
        actions={<ButtonLink href={platformHref(goldId, 'integrations/new')} size="small">New connector</ButtonLink>}
      />
      <Hint className="mb-4 block">Who GildOps buys infrastructure from is under Providers.</Hint>
      {detail === null ? (
        <Hint className="mb-4 block" role="status">
          The API did not answer, so adapter and registration state cannot be shown. Nothing below is guessed.
        </Hint>
      ) : null}
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
          {
            key: 'status',
            header: 'Status',
            cell: (connector) => (
              <Badge tone={connector.status === 'live' ? 'success' : connector.status === 'beta' ? 'accent' : 'neutral'}>
                {connector.status}
              </Badge>
            ),
          },
          { key: 'adapter', header: 'Adapter', cell: (connector) => adapterCell(connector.status, detail?.byKey.get(connector.key)) },
          { key: 'client', header: 'OAuth client', cell: (connector) => clientCell(connector.status, detail?.byKey.get(connector.key)) },
          { key: 'organizations', header: 'Businesses', cell: (connector) => usage.get(connector.key)?.organizations ?? 0 },
          {
            key: 'operational',
            header: 'Operation',
            cell: (connector) => <OperationalBadge state={connectorOperationalState(connector, detail?.byKey.get(connector.key))} />,
          },
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

function adapterCell(status: string, readiness: { implemented: boolean } | undefined) {
  if (status === 'planned') return '—';
  if (!readiness) return 'Unknown';
  return readiness.implemented ? 'Ready' : 'Missing';
}

function clientCell(status: string, readiness: { implemented: boolean; configured: boolean } | undefined) {
  if (status === 'planned' || (readiness && !readiness.implemented)) return '—';
  if (!readiness) return 'Unknown';
  return readiness.configured ? 'Configured' : 'Missing';
}
