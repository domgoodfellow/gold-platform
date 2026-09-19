import { Hint } from '@/components/controls/inputs';
import { areaLabel } from '@/lib/navigation';
import { PageHeader } from '@/components/containers/page-header';
import { Button, ButtonLink } from '@/components/controls/button';
import { Card } from '@/components/containers/card';
import { DividedList, EmptyState, Section, SectionHeading } from '@/components/containers/section';
import { Badge } from '@/components/display/data';
import { Widget, WidgetGrid } from '@/components/display/widget';
import { listConnections } from '@/lib/domain/integrations/connections';
import { listResources } from '@/lib/domain/integrations/resources';
import { listImportRuns } from '@/lib/domain/integrations/import-runs';
import { requireOrganization } from '@/lib/route/organization';
import { ConnectCsvForm } from './connect-csv-form';
import { DisconnectForm } from './connection-actions';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  connecting: 'Connecting',
  active: 'Connected',
  needs_attention: 'Needs attention',
  disconnected: 'Disconnected',
};

/** Nothing here is wired to a real vendor yet — see `integrations/[connectorKey]` doors for what would replace "Coming soon" with a real Connect action. */
const CATALOG = [
  {
    key: 'csv',
    name: 'CSV / spreadsheet file',
    description: 'Upload an exported file — no account to connect.',
    category: 'Files',
    available: true,
  },
  {
    key: 'google_workspace',
    name: 'Google Workspace',
    description: 'Sheets, Drive and Calendar.',
    category: 'Productivity',
    available: false,
  },
  {
    key: 'hubspot',
    name: 'HubSpot',
    description: 'Customers, companies and sales pipelines.',
    category: 'CRM',
    available: false,
  },
  {
    key: 'shopify',
    name: 'Shopify',
    description: 'Customers, orders and products.',
    category: 'Commerce',
    available: false,
  },
];

export default async function IntegrationsPage({
  params,
}: PageProps<'/organizations/[organizationId]/integrations'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [connections, resources, runs] = await Promise.all([
    listConnections(db, { organizationId }),
    listResources(db, { organizationId }),
    listImportRuns(db, { organizationId }),
  ]);

  const mayManage = organization.capabilities.includes('integration.manage');
  const active = connections.filter((connection) => connection.status !== 'disconnected');
  const needsAttention = connections.filter((connection) => connection.status === 'needs_attention');
  const hasCsvConnection = connections.some(
    (connection) => connection.connectorKey === 'csv' && connection.status !== 'disconnected',
  );

  return (
    <>
      <PageHeader title={areaLabel('integrations')} description="Connect GOLD to the tools and data your organization already uses." />
      <WidgetGrid>
        <Widget title="Connected apps" value={active.length} />
        <Widget title="Data sources" value={resources.length} href={`/organizations/${organizationId}/integrations/sources`} />
        <Widget title="Imports" value={runs.length} href={`/organizations/${organizationId}/integrations/imports`} />
        <Widget
          title="Needs attention"
          value={needsAttention.length}
          note={needsAttention.length > 0 ? 'A connection has stopped working.' : undefined}
        />
      </WidgetGrid>

      <Section className="mt-8">
        <SectionHeading>Connected</SectionHeading>
        {active.length === 0 ? (
          <EmptyState className="mt-2">Nothing connected yet.</EmptyState>
        ) : (
          <DividedList className="mt-2">
            {active.map((connection) => (
              <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <a
                    href={`/organizations/${organizationId}/integrations/${connection.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {connection.accountLabel ?? connection.connectorKey}
                  </a>
                  <p className="text-sm text-muted">{connection.connectorKey}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={connection.status === 'active' || connection.status === 'connecting' ? 'success' : 'neutral'}>
                    {STATUS_LABEL[connection.status] ?? connection.status}
                  </Badge>
                  {mayManage ? (
                    <DisconnectForm organizationId={organizationId} connectionId={connection.id} />
                  ) : null}
                </div>
              </li>
            ))}
          </DividedList>
        )}
      </Section>

      <Section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeading>Available</SectionHeading>
          {hasCsvConnection ? (
            <ButtonLink href={`/organizations/${organizationId}/integrations/imports/new`} tone="primary" size="small">
              Import file
            </ButtonLink>
          ) : null}
        </div>
        <Hint className="mt-1">
          Google Workspace and the others below are not wired to a real account on this
          deployment yet — CSV works today and uses the same mapping and review workflow every
          future connector will.
        </Hint>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {CATALOG.map((connector) => (
            <Card key={connector.key} className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{connector.name}</p>
                <p className="text-sm text-muted">{connector.description}</p>
                <p className="mt-1 text-xs text-subtle">{connector.category}</p>
              </div>
              {connector.key === 'csv' ? (
                mayManage ? (
                  <ConnectCsvForm organizationId={organizationId} alreadyConnected={hasCsvConnection} />
                ) : null
              ) : (
                <Button type="button" tone="secondary" size="small" disabled>
                  Coming soon
                </Button>
              )}
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}
