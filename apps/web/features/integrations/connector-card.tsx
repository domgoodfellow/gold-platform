import { Button, ButtonLink } from '@/components/controls/button';
import { Card } from '@/components/containers/card';
import { Badge } from '@/components/display/data';
import { ConnectCsvForm } from '@/app/organizations/[organizationId]/integrations/connect-csv-form';
import { isConnectable, type Connector } from '@/lib/domain/integrations/connectors';

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
    <Card className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-8 w-8 shrink-0 object-contain" />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="font-medium">{connector.name}</p>
          <p className="text-sm text-muted">{connector.description}</p>
          <p className="mt-1 text-xs text-subtle">
            {connector.suite ? `${connector.suite} · ` : ''}
            {connector.category}
          </p>
        </div>
        <Badge tone={connector.status === 'live' ? 'success' : connector.status === 'beta' ? 'accent' : 'neutral'}>
          {STATUS_LABEL[connector.status]}
        </Badge>
      </div>
      {connector.apps.length > 0 ? (
        <p className="text-xs text-muted">Includes {connector.apps.map((app) => app.name).join(', ')}.</p>
      ) : null}
      <div className="flex justify-end">
        {!connectable ? (
          <Button type="button" tone="secondary" size="small" disabled>
            {connector.status === 'planned' ? 'Coming soon' : 'Not available yet'}
          </Button>
        ) : !mayManage ? null : connector.key === 'csv' ? (
          <ConnectCsvForm organizationId={organizationId} alreadyConnected={connected} />
        ) : connected ? (
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
