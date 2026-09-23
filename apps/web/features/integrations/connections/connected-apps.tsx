import Link from 'next/link';
import { ButtonLink } from '@/components/controls/button';
import { DividedList, EmptyState, Section, SectionHeading } from '@/components/containers/section';
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
  resourceCount,
  importCount,
  needsAttentionCount,
  mayManage,
  browseHref,
}: {
  organizationId: string;
  active: IntegrationConnection[];
  connectorByKey: Map<string, Connector>;
  logoUrlByKey: Map<string, string | null>;
  resourceCount: number;
  importCount: number;
  needsAttentionCount: number;
  mayManage: boolean;
  browseHref: string;
}) {
  const connectedCsv = active.some((connection) => connection.connectorKey === 'csv');

  return (
    <>
      <WidgetGrid className="mt-6">
        <Widget title="Connected apps" value={active.length} />
        <Widget title="Data sources" value={resourceCount} href={`/organizations/${organizationId}/integrations/sources`} />
        <Widget title="Imports" value={importCount} href={`/organizations/${organizationId}/integrations/imports`} />
        <Widget
          title="Needs attention"
          value={needsAttentionCount}
          note={needsAttentionCount > 0 ? 'A connection has stopped working.' : undefined}
        />
      </WidgetGrid>

      <Section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeading>Connected</SectionHeading>
          {mayManage && connectedCsv ? (
            <ButtonLink href={`/organizations/${organizationId}/integrations/imports/new`} tone="primary" size="small">
              Import file
            </ButtonLink>
          ) : null}
        </div>
        {active.length === 0 ? (
          <EmptyState className="mt-2">
            Nothing connected yet. <Link href={browseHref} className="underline underline-offset-4">Browse apps</Link>
          </EmptyState>
        ) : (
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
                        href={`/organizations/${organizationId}/integrations/${connection.id}`}
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
        )}
      </Section>
    </>
  );
}
