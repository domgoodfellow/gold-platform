import { notFound } from 'next/navigation';
import { ButtonLink } from '@/components/controls/button';
import { Badge } from '@/components/display/data';
import { PageHeader } from '@/components/headers/page-header';
import { ConnectionDetail } from '@/features/integrations/connections/connection-detail';
import { CheckConnectionForm, DisconnectForm } from '@/features/integrations/connections/connection-controls';
import { getConnection } from '@/lib/domain/integrations/connections';
import { connectorLogoUrl, getConnector, isConnectable, usesSignIn } from '@/lib/domain/integrations/connectors';
import { listResources } from '@/lib/domain/integrations/resources';
import { requireOrganization } from '@/lib/route/organization';
import { settingsScopeHref } from '@/lib/route/settings';
import { loadConnectorReadiness } from '@/lib/domain/integrations/readiness';
import { sourceControlReader, type SourceRepository } from '@/lib/adapters/source-control';
import { listGrantedResourceIds } from '@/lib/domain/integrations/assistant-grants';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { ConnectionCapabilities } from '@/features/integrations/connections/connection-capabilities';
import { listActiveGrants, listGrantableAgents, listNativeCapabilities } from '@/lib/domain/integrations/tool-access';

export const dynamic = 'force-dynamic';

export default async function ConnectionDetailPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/settings/connections/[connectionId]'>) {
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
  // Reconnect is offered only where this deployment could honour it.
  const readiness = connector ? await loadConnectorReadiness(db, [connector.key]) : new Map();
  // A source-control connection is shown as the repositories it reaches, never as generic resources.
  const reader = sourceControlReader(connection.connectorKey);
  const repositories: SourceRepository[] | null = reader
    ? resources
        .filter((resource) => resource.connectionId !== null && reader.resourceTypes.includes(resource.resourceType) && resource.status === 'active')
        .map((resource) =>
          reader.toRepository({
            id: resource.id,
            connectionId: connectionId,
            displayName: resource.displayName,
            metadata: resource.metadata,
          }),
        )
        .filter((repository): repository is SourceRepository => repository !== null)
    : null;
  const connectable = connector !== null && isConnectable(connector, readiness.get(connector.key));
  // What an agent could be given on this connection. Only an active sign-in connection that someone may
  // manage; the API is the authority on what a connector declares, and an unreachable one offers nothing.
  const offersCapabilities = mayManage && connection.status === 'active' && connector !== null && connector.connectionMethod === 'native';
  const [capabilities, agents, grants] = offersCapabilities
    ? await Promise.all([
        listNativeCapabilities(db, { connectorKey: connection.connectorKey }),
        listGrantableAgents(db, { organizationId }),
        listActiveGrants(db, { organizationId }),
      ])
    : [[], [], []];
  const needsReconnect = connector !== null && connector.authMethod !== 'none' && connectable && connection.status !== 'active';

  return (
    <SettingsPageFrame width="fluid">
      <PageHeader
        title={name}
        crumbs={[{ label: 'Connections', href: settingsScopeHref('connections', organizationId) }]}
        meta={
          <Badge tone={connection.status === 'active' || connection.status === 'connecting' ? 'success' : 'neutral'}>
            {connection.status.replace(/_/g, ' ')}
          </Badge>
        }
        actions={
          <>
            {mayManage && connection.status !== 'disconnected' && connector !== null && usesSignIn(connector) ? (
              <CheckConnectionForm
                organizationId={organizationId}
                connectionId={connectionId}
                label={repositories ? 'Refresh repositories' : 'Check connection'}
                pendingLabel={repositories ? 'Refreshing…' : 'Checking…'}
              />
            ) : null}
            {mayManage && repositories && connectable && connection.status === 'active' ? (
              <ButtonLink
                href={`/organizations/${organizationId}/settings/connections/connect/${connection.connectorKey}?connection=${connectionId}`}
                tone="secondary"
                size="small"
              >
                Change repository access
              </ButtonLink>
            ) : null}
            {mayManage && needsReconnect ? (
              <ButtonLink
                href={`/organizations/${organizationId}/settings/connections/connect/${connection.connectorKey}?connection=${connectionId}`}
                tone="primary"
                size="small"
              >
                Reconnect
              </ButtonLink>
            ) : null}
            {mayManage && connection.status !== 'disconnected' ? (
              <DisconnectForm organizationId={organizationId} connectionId={connectionId} />
            ) : null}
            {mayManage && connection.status !== 'disconnected' && !repositories ? (
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
        repositories={repositories}
        mayManage={mayManage}
        justConnected={justConnected}
      />
      {offersCapabilities ? (
        <ConnectionCapabilities
          organizationId={organizationId}
          connectionId={connectionId}
          capabilities={capabilities}
          grants={grants.filter((grant) => grant.connectionId === connectionId)}
          agents={agents}
          resources={resources}
        />
      ) : null}
    </SettingsPageFrame>
  );
}
