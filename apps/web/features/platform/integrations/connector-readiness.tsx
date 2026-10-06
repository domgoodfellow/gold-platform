import { Badge } from '@/components/display/data';
import { Hint } from '@/components/controls/inputs';
import { DividedList, Section, SectionHeading } from '@/components/surfaces/section';
import type { Connector, ConnectorOperationalState } from '@/lib/domain/integrations/connectors';
import { connectorOperationalState } from '@/lib/domain/integrations/connectors';
import type { ConnectorReadinessDetail } from '@/lib/domain/integrations/readiness';

const LABEL: Record<ConnectorOperationalState, string> = {
  upcoming: 'Upcoming',
  adapter_missing: 'No adapter',
  needs_setup: 'Needs setup',
  operational: 'Operational',
  unknown: 'Unknown',
};

const TONE: Record<ConnectorOperationalState, 'neutral' | 'danger' | 'accent' | 'success'> = {
  upcoming: 'neutral',
  adapter_missing: 'danger',
  needs_setup: 'danger',
  operational: 'success',
  unknown: 'neutral',
};

export function OperationalBadge({ state }: { state: ConnectorOperationalState }) {
  return <Badge tone={TONE[state]}>{LABEL[state]}</Badge>;
}

/**
 * Platform → Connectors → one connector: why a business is or is not offered it. The product status
 * is the catalogue's; the rest is this deployment's, asked of the API. Names the inputs a missing
 * registration needs and never a value — the inputs are deployment configuration until the platform
 * secret path holds them.
 */
export function ConnectorRuntime({
  connector,
  readiness,
  redirectUri,
}: {
  connector: Connector;
  /** `undefined` when the API did not answer, or when planned connectors were not asked about. */
  readiness: ConnectorReadinessDetail | undefined;
  redirectUri: string | null;
}) {
  const state = connectorOperationalState(connector, readiness);
  const oauth = connector.authMethod === 'oauth2';

  return (
    <Section className="mt-6">
      <SectionHeading>Runtime</SectionHeading>
      <DividedList className="mt-2">
        <Row label="Product status">
          <Badge tone={connector.status === 'live' ? 'success' : connector.status === 'beta' ? 'accent' : 'neutral'}>{connector.status}</Badge>
        </Row>
        <Row label="Adapter">{connector.status === 'planned' ? 'Not asked — planned' : !readiness ? 'Unknown' : readiness.implemented ? 'Implemented' : 'Not implemented'}</Row>
        {oauth ? (
          <>
            <Row label="Authorization">OAuth 2</Row>
            <Row label="Client registration">
              {connector.status === 'planned' || !readiness?.implemented ? '—' : readiness.configured ? 'Configured' : 'Missing'}
            </Row>
            {redirectUri ? <Row label="Redirect URI"><span className="break-all">{redirectUri}</span></Row> : null}
          </>
        ) : null}
        <Row label="Offered to businesses">
          <OperationalBadge state={state} />
        </Row>
      </DividedList>
      {readiness && readiness.reason === 'oauth_client_missing' ? (
        <Hint className="mt-3 block" role="status">
          Not offered to businesses until this deployment holds the vendor&apos;s registration. Required configuration:{' '}
          {readiness.requiredConfiguration.join(', ')}.
        </Hint>
      ) : null}
      {readiness && readiness.reason === 'adapter_missing' ? (
        <Hint className="mt-3 block" role="status">
          The catalogue says this is {connector.status}, but no adapter exists for it, so businesses are not offered it.
        </Hint>
      ) : null}
    </Section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{children}</span>
    </li>
  );
}
