/**
 * How a sending domain reads to a person — one classification and one set of sentences, so the
 * list, the records table and the tests cannot disagree. Pure, and free of any database or network
 * import, so a client component can hold it.
 */

export type SendingDomainPresentation =
  | 'ready'
  | 'automatic_dns'
  | 'manual_dns'
  | 'checking'
  | 'not_created'
  | 'provider_unavailable'
  | 'provider_error'
  | 'failed';

/**
 * Eight states, each a different thing to do next. The order is the order they are decided in,
 * and it matters: a provider account nobody configured is its own state and never a DNS problem,
 * and a domain the provider has never been asked about is not "waiting for DNS" — nothing has
 * asked for any DNS yet.
 */
export function sendingDomainPresentation(domain: {
  state: 'pending' | 'ready' | 'failed';
  errorCode: string | null;
  providerDomainId: string | null;
  outstandingRecords: number;
  /** Whether this business's own connected DNS could publish the outstanding records. */
  automated: boolean;
}): SendingDomainPresentation {
  if (domain.state === 'ready') return 'ready';
  if (domain.errorCode === 'provider_unavailable') return 'provider_unavailable';
  if (domain.state === 'failed') return 'failed';
  if (domain.errorCode) return 'provider_error';
  if (!domain.providerDomainId) return 'not_created';
  if (domain.outstandingRecords === 0) return 'checking';
  return domain.automated ? 'automatic_dns' : 'manual_dns';
}

export const PROVIDER_UNAVAILABLE_MESSAGE =
  'Custom sending domains cannot be set up on this deployment yet. Nothing is wrong with your domain or your DNS.';

/**
 * What GildOps' own managed sending offers a business today: nothing.
 *
 * This deployment sends its own transactional mail — an invitation — from one address it owns,
 * and that address is GildOps writing to a person about GildOps. A tenant-safe managed sender is
 * a different thing: an address a business's own messages may come from before it has proven a
 * domain, which needs an identity per business and a reply path that reaches them. None exists,
 * so this says so rather than implying the invitation sender doubles as one (work order 1,
 * section 22). A later slice that builds one changes this constant and the sentence beside it.
 */
export const MANAGED_SENDING = {
  available: false,
  heading: 'GildOps-managed sending',
  state: 'Not available yet',
  detail:
    'Until a domain of your own is verified, this business has no address GildOps can send its messages from. Verifying a domain below is what makes sending possible.',
} as const;

/** The badge each state reads as. GildOps' own facts about a domain, never a tenant's vocabulary. */
export const SENDING_DOMAIN_BADGE: Record<SendingDomainPresentation, { label: string; tone: 'neutral' | 'success' | 'danger' }> = {
  ready: { label: 'Verified', tone: 'success' },
  automatic_dns: { label: 'DNS required', tone: 'neutral' },
  manual_dns: { label: 'DNS required', tone: 'neutral' },
  checking: { label: 'Checking', tone: 'neutral' },
  not_created: { label: 'Not started', tone: 'neutral' },
  provider_unavailable: { label: 'Unavailable', tone: 'neutral' },
  provider_error: { label: 'Check failed', tone: 'danger' },
  failed: { label: 'Rejected', tone: 'danger' },
};

/** One sentence of state for a sending domain. Never the provider's raw payload. */
export function sendingDomainSentence(
  presentation: SendingDomainPresentation,
  domain: { errorMessage: string | null; outstandingRecords: number; zoneName: string | null },
): string {
  switch (presentation) {
    case 'ready':
      return 'Ready for sending. Mail from addresses at this domain is authorized.';
    case 'automatic_dns':
      return domain.zoneName
        ? `${domain.outstandingRecords} record${domain.outstandingRecords === 1 ? '' : 's'} still to publish. GildOps can publish them in your connected ${domain.zoneName} zone — review them first.`
        : `${domain.outstandingRecords} record${domain.outstandingRecords === 1 ? '' : 's'} still to publish.`;
    case 'manual_dns':
      return `Add the ${domain.outstandingRecords} record${domain.outstandingRecords === 1 ? '' : 's'} below at the company that manages DNS for this domain, then check verification. Changes can take a while to spread.`;
    case 'checking':
      return 'The provider is checking your DNS. This can take a few minutes — check again shortly.';
    case 'not_created':
      return 'Not set up with the email provider yet. Start setup to find out which records to publish.';
    case 'provider_unavailable':
      return PROVIDER_UNAVAILABLE_MESSAGE;
    case 'provider_error':
      return domain.errorMessage ?? 'The last attempt did not get an answer.';
    case 'failed':
      return domain.errorMessage ?? 'The email provider will not take this domain.';
  }
}
