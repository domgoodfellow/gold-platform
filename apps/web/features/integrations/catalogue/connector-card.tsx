import { Button, ButtonLink } from '@/components/controls/button';
import { Card } from '@/components/containers/card';
import { Badge } from '@/components/display/data';
import { isConnectable, type Connector } from '@/lib/domain/integrations/connectors';
import { ConnectorAppStrip } from './connector-app-strip';
import { ConnectorIcon } from './connector-icon';

const STATUS_LABEL = { planned: 'Planned', beta: 'Beta', live: 'Live' } as const;

/**
 * One catalogue entry as a business sees it. The connector's own facts come from the catalogue;
 * whether it can be connected is `isConnectable` — catalogue status *and* a registered adapter —
 * so a Connect button is never shown for something that would do nothing.
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
  const connectable = isConnectable(connector);

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
        {!connectable ? (
          <Button type="button" tone="secondary" size="small" disabled>
            {connector.status === 'planned' ? 'Coming soon' : 'Not available yet'}
          </Button>
        ) : !mayManage ? null : connected ? (
          <Button type="button" tone="primary" size="small" disabled>
            Connected
          </Button>
        ) : (
          <ButtonLink href={`/organizations/${organizationId}/integrations/connect/${connector.key}`} tone="primary" size="small">
            Connect
          </ButtonLink>
        )}
      </div>
    </Card>
  );
}
