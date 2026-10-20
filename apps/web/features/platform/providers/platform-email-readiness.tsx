import { Badge, Detail, DefinitionList } from '@/components/display/data';
import { Section, SectionHeading } from '@/components/surfaces/section';
import type { PlatformEmailReadiness } from '@/lib/route/provider-environment';

const STATE: Record<PlatformEmailReadiness['state'], { label: string; tone: 'neutral' | 'success' | 'danger' }> = {
  not_configured: { label: 'Not configured', tone: 'danger' },
  misconfigured: { label: 'Misconfigured', tone: 'danger' },
  provider_unavailable: { label: 'Provider unavailable', tone: 'danger' },
  configured_unverified: { label: 'Configured, not yet verified', tone: 'neutral' },
  ready_for_test: { label: 'Ready for an authorized test', tone: 'neutral' },
  live_verified: { label: 'Live delivery verified', tone: 'success' },
  api_unreachable: { label: 'API not reachable', tone: 'danger' },
};

const CHECK: Record<PlatformEmailReadiness['checks'][number]['state'], string> = { ok: 'OK', missing: 'Missing', problem: 'Problem', unknown: 'Not visible to GildOps' };

function when(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'None recorded';
}

/**
 * GildOps' own invitation email, as the API that sends it reports itself. Names settings, never
 * their values; a delivery counts as verified only once the provider reported it delivered.
 */
export function PlatformEmailReadinessSection({ readiness }: { readiness: PlatformEmailReadiness }) {
  const badge = STATE[readiness.state];
  return (
    <Section>
      <SectionHeading>Platform email (team invitations)</SectionHeading>
      <DefinitionList>
        <Detail label="Status"><Badge tone={badge.tone}>{badge.label}</Badge></Detail>
        <Detail label="What this means">{readiness.detail}</Detail>
        <Detail label="Sending domain">{readiness.fromDomain ? `${readiness.fromDomain}${readiness.domainStatus ? ` (Resend: ${readiness.domainStatus})` : ''}` : 'Not set'}</Detail>
        <Detail label="Credential used">{readiness.credentialSource === 'platform_account' ? 'Default Resend platform account' : readiness.credentialSource === 'environment' ? 'Bootstrap setting (RESEND_API_KEY)' : 'None'}</Detail>
        <Detail label="Last delivered invitation">{when(readiness.evidence.lastDeliveredAt)}</Detail>
        <Detail label="Last failed invitation">{readiness.evidence.lastFailedAt ? `${when(readiness.evidence.lastFailedAt)}${readiness.evidence.lastFailure ? ` — ${readiness.evidence.lastFailure}` : ''}` : 'None recorded'}</Detail>
      </DefinitionList>
      {readiness.checks.length ? (
        <ul className="mt-4 divide-y divide-border border-y border-border text-sm">
          {readiness.checks.map((check) => (
            <li key={check.key} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="font-medium">{check.label}</span>
              <span className={check.state === 'ok' ? '' : check.state === 'unknown' ? 'text-muted' : 'text-danger'}>{CHECK[check.state]}</span>
              <span className="w-full text-xs text-muted">{check.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-sm text-muted">
        Reported by the API that sends invitations, not read from this web project. A business&rsquo;s own customer email is set up in its Email sending settings.
      </p>
    </Section>
  );
}
