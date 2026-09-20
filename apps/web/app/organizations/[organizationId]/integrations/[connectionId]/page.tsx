import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/containers/page-header';
import { areaLabel } from '@/lib/navigation';
import { ButtonLink } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/containers/section';
import { DataTable } from '@/components/display/table';
import { Badge, DefinitionList, Detail } from '@/components/display/data';
import { getConnection } from '@/lib/domain/integrations/connections';
import { connectorLogoUrl, getConnector, isConnectable } from '@/lib/domain/integrations/connectors';
import { listResources } from '@/lib/domain/integrations/resources';
import { requireOrganization } from '@/lib/route/organization';
import { usesSignIn } from '@/lib/adapters/integrations';
import { listGrantedResourceIds } from '@/lib/domain/integrations/assistant-grants';
import { AssistantAccessForm, CheckConnectionForm, DisconnectForm } from '../connection-actions';

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
  const name = connector?.name ?? connection.connectorKey;
  const needsReconnect =
    connector !== null && connector.authMethod !== 'none' && isConnectable(connector) && connection.status !== 'active';
  const mayManage = organization.capabilities.includes('integration.manage');

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
              <ButtonLink href={`/organizations/${organizationId}/integrations/connect/${connection.connectorKey}?connection=${connectionId}`} tone="primary" size="small">
                Reconnect
              </ButtonLink>
            ) : null}
            {mayManage && connection.status !== 'disconnected' ? (
              <DisconnectForm organizationId={organizationId} connectionId={connectionId} />
            ) : null}
            {connection.status !== 'disconnected' ? (
              <ButtonLink href={`/organizations/${organizationId}/integrations/imports/new`} tone="primary" size="small">
                Add data source
              </ButtonLink>
            ) : null}
          </>
        }
      />

      {justConnected ? <Hint className="block" role="status">Connected.</Hint> : null}
      {connection.lastError ? (
        <Hint className="block" role="alert">
          This connection stopped working: {connection.lastError}
        </Hint>
      ) : null}

      <Section>
        <SectionHeading>Overview</SectionHeading>
        <DefinitionList className="mt-3">
          <Detail label="App">
            {connector?.iconRef ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={connectorLogoUrl(db, connector.iconRef)} alt="" className="mr-2 inline h-5 w-5 object-contain" />
            ) : null}
            {name}
            {connector?.apps.length ? <span className="block text-sm text-muted">Reaches {connector.apps.map((app) => app.name).join(', ')}.</span> : null}
          </Detail>
          <Detail label="Account">{connection.accountLabel}</Detail>
          <Detail label="Scopes">{connection.scopes.length > 0 ? connection.scopes.join(', ') : null}</Detail>
          <Detail label="Last verified">
            {connection.lastVerifiedAt ? new Date(connection.lastVerifiedAt).toLocaleString('en-GB') : null}
          </Detail>
          <Detail label="Connected">{new Date(connection.createdAt).toLocaleString('en-GB')}</Detail>
        </DefinitionList>
      </Section>

      <Section className="mt-8">
        <SectionHeading>Resources</SectionHeading>
        <Hint className="mt-1">
          What GOLD can reach through this connection. Connecting does not let the assistant read any of it — turn that on for each resource.
        </Hint>
        <div className="mt-3">
          <DataTable
            rows={resources}
            rowKey={(resource) => resource.id}
            empty="Nothing selected from this connection yet."
            columns={[
              { key: 'name', header: 'Resource', emphasis: 'primary', cell: (r) => r.displayName },
              { key: 'type', header: 'Type', cell: (r) => r.resourceType.replace(/_/g, ' ') },
              {
                key: 'status',
                header: 'Status',
                cell: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status.replace(/_/g, ' ')}</Badge>,
              },
              {
                key: 'assistant',
                header: 'Assistant',
                cell: (r) =>
                  mayManage ? (
                    <AssistantAccessForm organizationId={organizationId} connectionId={connectionId} resourceId={r.id} allowed={granted.has(r.id)} />
                  ) : granted.has(r.id) ? (
                    'May read'
                  ) : (
                    'No access'
                  ),
              },
              {
                key: 'actions',
                header: 'Import',
                emphasis: 'secondary',
                cell: (r) => (
                  <ButtonLink
                    href={`/organizations/${organizationId}/integrations/imports/new?resourceId=${r.id}`}
                    tone="text"
                    size="small"
                  >
                    Import →
                  </ButtonLink>
                ),
              },
            ]}
          />
        </div>
      </Section>
    </>
  );
}
