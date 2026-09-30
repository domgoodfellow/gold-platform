import { ButtonLink } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { DataTable } from '@/components/display/table';
import { Badge, DefinitionList, Detail } from '@/components/display/data';
import type { IntegrationConnection } from '@/lib/domain/integrations/connections';
import type { Connector } from '@/lib/domain/integrations/connectors';
import type { IntegrationResource } from '@/lib/domain/integrations/resources';
import { ConnectorAppStrip } from '../catalogue/connector-app-strip';
import { ConnectorIcon } from '../catalogue/connector-icon';
import { AssistantAccessForm } from './connection-controls';

/**
 * One connection's content: account/scope facts, its child apps and its Resources table — the
 * same "route loads, feature presents" split Locations and Assets already use. The route keeps
 * `PageHeader` itself (`workspace-shell.test.ts`'s one-page-identity rule); this owns only the
 * body below it. Authorizing a connection never grants the assistant access to a Resource by
 * itself; that stays a per-Resource switch (`AssistantAccessForm`), on here as it always was.
 */
export function ConnectionDetail({
  organizationId,
  connectionId,
  connection,
  connector,
  logoUrl,
  resources,
  grantedResourceIds,
  mayManage,
  justConnected,
}: {
  organizationId: string;
  connectionId: string;
  connection: IntegrationConnection;
  connector: Connector | null;
  logoUrl: string | null;
  resources: IntegrationResource[];
  grantedResourceIds: Set<string>;
  mayManage: boolean;
  justConnected: boolean;
}) {
  const name = connector?.name ?? connection.connectorKey;

  return (
    <>
      {justConnected ? (
        <Hint className="block" role="status">
          Connected.
        </Hint>
      ) : null}
      {connection.lastError ? (
        <Hint className="block" role="alert">
          This connection stopped working: {connection.lastError}
        </Hint>
      ) : null}

      <Section>
        <SectionHeading>Overview</SectionHeading>
        <DefinitionList className="mt-3">
          <Detail label="App">
            <div className="flex items-center gap-2">
              {connector ? <ConnectorIcon connector={connector} logoUrl={logoUrl} size="small" /> : null}
              <span>{name}</span>
            </div>
            {connector?.apps.length ? (
              <div className="mt-1 flex items-center gap-2">
                <span className="text-sm text-muted">Reaches:</span>
                <ConnectorAppStrip apps={connector.apps} connectorKey={connector.key} />
              </div>
            ) : null}
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
          What GildOps can reach through this connection. Connecting does not let the assistant read any of it — turn that on for each resource.
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
                    <AssistantAccessForm
                      organizationId={organizationId}
                      connectionId={connectionId}
                      resourceId={r.id}
                      allowed={grantedResourceIds.has(r.id)}
                    />
                  ) : grantedResourceIds.has(r.id) ? (
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
                  <ButtonLink href={`/organizations/${organizationId}/integrations/imports/new?resourceId=${r.id}`} tone="text" size="small">
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
