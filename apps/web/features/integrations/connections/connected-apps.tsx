import Link from 'next/link';
import { ButtonLink } from '@/components/controls/button';
import { CardSection } from '@/components/surfaces/card';
import { DividedList } from '@/components/surfaces/section';
import { Badge } from '@/components/display/data';
import { Widget, WidgetGrid } from '@/components/display/widget';
import type { IntegrationConnection } from '@/lib/domain/integrations/connections';
import type { Connector } from '@/lib/domain/integrations/connectors';
import { ConnectorIcon } from '../catalogue/connector-icon';
import { DisconnectForm } from './connection-controls';

const STATUS_LABEL: Record<string, string> = {
  connecting: 'Connecting',
  active: 'Connected',
  needs_attention: 'Needs attention',
  disconnected: 'Disconnected',
};

/**
 * Integrations → Connected: which apps this business has actually authorized, with recognizable
 * identity, plus the three overview facts (data sources, imports, needs attention) that stayed
 * useful once the list grew real brand identity. Connection status (`connecting`/`active`/
 * `needs_attention`/`disconnected`) comes from the Connection record and is never confused with
 * the Connector catalogue's own `planned`/`beta`/`live` — a business only ever sees this screen
 * for something it has actually connected, which is already `beta` or `live` by construction.
 */
export function ConnectedApps({
  organizationId,
  active,
  connectorByKey,
  logoUrlByKey,
  needsAttentionCount,
  mayManage,
  catalogOpen,
  catalogHref,
  connectable,
  organizationName,
  mcpServerCount,
}: {
  organizationId: string;
  active: IntegrationConnection[];
  connectorByKey: Map<string, Connector>;
  logoUrlByKey: Map<string, string | null>;
  needsAttentionCount: number;
  mayManage: boolean;
  catalogOpen: boolean;
  catalogHref: string;
  /** Only what this deployment can connect right now — never the roadmap. */
  connectable: Connector[];
  organizationName: string;
  mcpServerCount: number;
}) {
  const connectedKeys = new Set(active.map((connection) => connection.connectorKey));
  const offered = connectable.filter((connector) => !connectedKeys.has(connector.key)).slice(0, 6);
  const addConnections = (
    <CardSection headingId="add-connections-heading" title={active.length === 0 ? `Connect systems to ${organizationName}` : 'Add connections'} className="mt-6">
      {offered.length > 0 ? (
        <DividedList className="mt-2">
          {offered.map((connector) => (
            <li key={connector.key} className="flex items-center gap-3 py-3">
              <ConnectorIcon connector={connector} logoUrl={logoUrlByKey.get(connector.key) ?? null} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{connector.name}</p>
                <p className="text-sm text-muted">{connector.description}</p>
              </div>
              {mayManage ? (
                <ButtonLink href={`/organizations/${organizationId}/settings/connections/connect/${connector.key}`} tone="primary" size="small">
                  Connect
                </ButtonLink>
              ) : null}
            </li>
          ))}
        </DividedList>
      ) : (
        <p className="mt-1 max-w-2xl text-sm text-muted">Nothing else is available to connect right now.</p>
      )}
      <ButtonLink href={catalogHref} tone="secondary" className="mt-4" aria-expanded={catalogOpen} aria-controls="app-library">{catalogOpen ? 'Hide the App Library' : 'Browse the App Library'}</ButtonLink>
    </CardSection>
  );

  if (active.length === 0) return addConnections;

  return (
    <>
      <WidgetGrid className="mt-6">
        <Widget title="Connected apps" value={active.length} />
        <Widget title="MCP servers" value={mcpServerCount} href={`/organizations/${organizationId}/settings/connections/mcp`} />
        <Widget
          title="Needs attention"
          value={needsAttentionCount}
          note={needsAttentionCount > 0 ? 'A connection has stopped working.' : undefined}
        />
      </WidgetGrid>

      <CardSection title="Connected" className="mt-6">
          <DividedList className="mt-2">
            {active.map((connection) => {
              const connector = connectorByKey.get(connection.connectorKey);
              return (
                <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3">
                    {connector ? (
                      <ConnectorIcon connector={connector} logoUrl={logoUrlByKey.get(connection.connectorKey) ?? null} />
                    ) : null}
                    <div>
                      <Link
                        href={`/organizations/${organizationId}/settings/connections/${connection.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {connector?.name ?? connection.connectorKey}
                      </Link>
                      <p className="text-sm text-muted">{connection.accountLabel ?? connector?.category ?? ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={connection.status === 'active' || connection.status === 'connecting' ? 'success' : 'neutral'}>
                      {STATUS_LABEL[connection.status] ?? connection.status}
                    </Badge>
                    {mayManage ? <DisconnectForm organizationId={organizationId} connectionId={connection.id} /> : null}
                  </div>
                </li>
              );
            })}
          </DividedList>
      </CardSection>
      {addConnections}
    </>
  );
}
