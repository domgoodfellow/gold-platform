import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/containers/page-header';
import { areaLabel } from '@/lib/navigation';
import { ButtonLink } from '@/components/controls/button';
import { Badge } from '@/components/display/data';
import { ConnectionDetail } from '@/features/integrations/connections/connection-detail';
import { CheckConnectionForm, DisconnectForm } from '@/features/integrations/connections/connection-controls';
import { getConnection } from '@/lib/domain/integrations/connections';
import { connectorLogoUrl, getConnector, isConnectable } from '@/lib/domain/integrations/connectors';
import { listResources } from '@/lib/domain/integrations/resources';
import { requireOrganization } from '@/lib/route/organization';
import { usesSignIn } from '@/lib/adapters/integrations';
import { listGrantedResourceIds } from '@/lib/domain/integrations/assistant-grants';

export const dynamic = 'force-dynamic';

export default async function ConnectionDetailPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/integrations/[connectionId]'>) {
  const { organizationId, connectionId } = await params;
  const justConnected = (await searchParams).connected === '1';
  const { db, organization } = await requireOrganization(organizationId);

  const connection = await getConnection(db, { organizationId, connectionId });
  if (!connection) notFound();

  const [resources, connector] = await Promise.all([
    listResources(db, { organizationId, connectionId }),
    getConnector(db, connection.connectorKey),
  ]);
  const granted = await listGrantedResourceIds(db, { organizationId, resourceIds: resources.map((r) => r.id) });
  const mayManage = organization.capabilities.includes('integration.manage');
  const name = connector?.name ?? connection.connectorKey;
  const needsReconnect =
    connector !== null && connector.authMethod !== 'none' && isConnectable(connector) && connection.status !== 'active';

  return (
    <>
      <PageHeader
        title={name}
        crumbs={[{ label: areaLabel('integrations'), href: `/organizations/${organizationId}/integrations` }]}
        meta={
          <Badge tone={connection.status === 'active' || connection.status === 'connecting' ? 'success' : 'neutral'}>
            {connection.status.replace(/_/g, ' ')}
          </Badge>
        }
        actions={
          <>
            {mayManage && connection.status !== 'disconnected' && usesSignIn(connection.connectorKey) ? (
              <CheckConnectionForm organizationId={organizationId} connectionId={connectionId} />
            ) : null}
            {mayManage && needsReconnect ? (
              <ButtonLink
                href={`/organizations/${organizationId}/integrations/connect/${connection.connectorKey}?connection=${connectionId}`}
                tone="primary"
                size="small"
              >
                Reconnect
              </ButtonLink>
            ) : null}
            {mayManage && connection.status !== 'disconnected' ? (
              <DisconnectForm organizationId={organizationId} connectionId={connectionId} />
            ) : null}
            {mayManage && connection.status !== 'disconnected' ? (
              <ButtonLink href={`/organizations/${organizationId}/integrations/imports/new`} tone="primary" size="small">
                Add data source
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <ConnectionDetail
        organizationId={organizationId}
        connectionId={connectionId}
        connection={connection}
        connector={connector}
        logoUrl={connector?.iconRef ? connectorLogoUrl(db, connector.iconRef) : null}
        resources={resources}
        grantedResourceIds={granted}
        mayManage={mayManage}
        justConnected={justConnected}
      />
    </>
  );
}
