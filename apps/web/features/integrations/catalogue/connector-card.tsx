import { ButtonLink } from '@/components/controls/button';
import { Card } from '@/components/surfaces/card';
import { Badge } from '@/components/display/data';
import type { Connector } from '@/lib/domain/integrations/connectors';
import { ConnectorAppStrip } from './connector-app-strip';
import { ConnectorIcon } from './connector-icon';

const STATUS_LABEL = { planned: 'Planned', beta: 'Beta', live: 'Live' } as const;

/**
 * One connectable (or already connected) app. Only a connector the deployment can actually connect
 * reaches this card — the route filters on `connectorAvailability` — so it never draws a control
 * that would do nothing, and a planned one is a row in the Upcoming list, not a card.
 */
export function ConnectorCard({
  connector,
  logoUrl,
  organizationId,
  connected,
  mayManage,
}: {
  connector: Connector;
  logoUrl: string | null;
  organizationId: string;
  connected: boolean;
  mayManage: boolean;
}) {
  return (
    <Card className="flex flex-col gap-2.5">
      <div className="flex items-start gap-3">
        <ConnectorIcon connector={connector} logoUrl={logoUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">{connector.name}</p>
            <Badge tone={connector.status === 'live' ? 'success' : connector.status === 'beta' ? 'accent' : 'neutral'}>
              {STATUS_LABEL[connector.status]}
            </Badge>
          </div>
          <p className="line-clamp-2 text-sm text-muted">{connector.description}</p>
        </div>
      </div>
      {connector.apps.length > 0 ? <ConnectorAppStrip apps={connector.apps} connectorKey={connector.key} /> : null}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5">
        <p className="text-xs text-subtle">
          {connector.suite ? `${connector.suite} · ` : ''}
          {connector.category}
        </p>
        {connected ? (
          <Badge tone="success">Connected</Badge>
        ) : mayManage ? (
          <ButtonLink href={`/organizations/${organizationId}/settings/connections/connect/${connector.key}`} tone="primary" size="small">
            Connect
          </ButtonLink>
        ) : null}
      </div>
    </Card>
  );
}
