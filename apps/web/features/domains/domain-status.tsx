import { Badge } from '@/components/display/data';
import type { DomainCertificateState } from '@/lib/adapters/domains';
import { CONFLICT_MESSAGE, PROVIDER_UNAVAILABLE_MESSAGE, type DomainPresentation } from '@/lib/domain/domains/presentation';

/**
 * How a domain's standing reads, in one place for the list and the dialog. These are GildOps' own
 * facts about a hostname — never a business's status vocabulary — so each carries its own tone.
 * A hosting account nobody has configured reads as *unavailable*, and never as a DNS problem.
 */
const BADGE: Record<DomainPresentation, { label: string; tone: 'neutral' | 'success' | 'danger' }> = {
  active: { label: 'Active', tone: 'success' },
  pending_dns: { label: 'DNS required', tone: 'neutral' },
  not_registered: { label: 'Not registered', tone: 'neutral' },
  provider_unavailable: { label: 'Unavailable', tone: 'neutral' },
  provider_error: { label: 'Check failed', tone: 'danger' },
  conflict: { label: 'Not available', tone: 'danger' },
};

export function DomainStateBadge({ presentation }: { presentation: DomainPresentation }) {
  const badge = BADGE[presentation];
  return <Badge tone={badge.tone}>{badge.label}</Badge>;
}

/** One sentence of application state for a domain, or null when the badge says enough. */
export function domainStateSentence(
  presentation: DomainPresentation,
  domain: { errorMessage: string | null; certificateState: DomainCertificateState },
): string | null {
  switch (presentation) {
    case 'active':
      return domain.certificateState === 'issued' ? 'Verified and serving, with a certificate.' : 'Verified and serving.';
    case 'pending_dns':
      return 'Publish the records below at your DNS host, then check again. Changes can take a while to spread.';
    case 'not_registered':
      return 'This domain isn’t accepted yet. Check again to retry.';
    case 'provider_unavailable':
      return PROVIDER_UNAVAILABLE_MESSAGE;
    case 'provider_error':
      return domain.errorMessage ?? 'The last check did not get an answer.';
    case 'conflict':
      return CONFLICT_MESSAGE;
  }
}
