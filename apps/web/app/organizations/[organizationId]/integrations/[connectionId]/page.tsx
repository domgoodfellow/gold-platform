import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/containers/page-header';
import { areaLabel } from '@/lib/navigation';
import { ButtonLink } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/containers/section';
import { DataTable } from '@/components/display/table';
import { Badge, DefinitionList, Detail } from '@/components/display/data';
import { getConnection } from '@/lib/domain/integrations/connections';
import { listResources } from '@/lib/domain/integrations/resources';
import { requireOrganization } from '@/lib/route/organization';
import { DisconnectForm } from '../connection-actions';

export const dynamic = 'force-dynamic';

export default async function ConnectionDetailPage({
  params,
}: PageProps<'/organizations/[organizationId]/integrations/[connectionId]'>) {
  const { organizationId, connectionId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const connection = await getConnection(db, { organizationId, connectionId });
  if (!connection) notFound();

  const resources = await listResources(db, { organizationId, connectionId });
  const mayManage = organization.capabilities.includes('integration.manage');

  return (
    <>
      <PageHeader
        title={connection.accountLabel ?? connection.connectorKey}
        crumbs={[{ label: areaLabel('integrations'), href: `/organizations/${organizationId}/integrations` }]}
        meta={
          <Badge tone={connection.status === 'active' || connection.status === 'connecting' ? 'success' : 'neutral'}>
            {connection.status.replace(/_/g, ' ')}
          </Badge>
        }
        actions={
          <>
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

      <Section>
        <SectionHeading>Overview</SectionHeading>
        <DefinitionList className="mt-3">
          <Detail label="Connector">{connection.connectorKey}</Detail>
          <Detail label="Scopes">{connection.scopes.length > 0 ? connection.scopes.join(', ') : null}</Detail>
          <Detail label="Last verified">
            {connection.lastVerifiedAt ? new Date(connection.lastVerifiedAt).toLocaleString('en-GB') : null}
          </Detail>
          <Detail label="Connected">{new Date(connection.createdAt).toLocaleString('en-GB')}</Detail>
        </DefinitionList>
      </Section>

      <Section className="mt-8">
        <SectionHeading>Resources</SectionHeading>
        <Hint className="mt-1">What GOLD reads from this connection.</Hint>
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
