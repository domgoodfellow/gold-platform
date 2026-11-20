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
  'Sending from your own domain isn’t available yet. Nothing is wrong with your domain or your DNS.';

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
  checking: { label: 'Pending', tone: 'neutral' },
  not_created: { label: 'Not started', tone: 'neutral' },
  provider_unavailable: { label: 'Unavailable', tone: 'neutral' },
  provider_error: { label: 'Check failed', tone: 'danger' },
  failed: { label: 'Rejected', tone: 'danger' },
};

/** One sentence of state for a sending domain. Never the provider's raw payload. */
export function sendingDomainSentence(
  presentation: SendingDomainPresentation,
  domain: { errorMessage: string | null; outstandingRecords: number; zoneName: string | null; totalRecords: number; missingRecords: number },
): string {
  switch (presentation) {
    case 'ready':
      return 'Verified. Addresses at this domain can send.';
    case 'automatic_dns':
      return domain.zoneName
        ? `${domain.outstandingRecords} of ${domain.totalRecords} DNS record${domain.totalRecords === 1 ? '' : 's'} still to publish. GildOps can publish them in your connected ${domain.zoneName} zone.`
        : `${domain.outstandingRecords} of ${domain.totalRecords} DNS record${domain.totalRecords === 1 ? '' : 's'} still to publish.`;
    case 'manual_dns':
      return domain.missingRecords
        ? `${domain.missingRecords} of ${domain.totalRecords} DNS record${domain.totalRecords === 1 ? '' : 's'} not found yet.`
        : `${domain.outstandingRecords} of ${domain.totalRecords} DNS record${domain.totalRecords === 1 ? '' : 's'} not verified yet.`;
    case 'checking':
      return 'Every record is published; the domain is still being confirmed. Check again in a few minutes.';
    case 'not_created':
      return 'Not set up yet. Start setup to find out which records to publish.';
    case 'provider_unavailable':
      return PROVIDER_UNAVAILABLE_MESSAGE;
    case 'provider_error':
      return domain.errorMessage ?? 'The last attempt did not get an answer.';
    case 'failed':
      return domain.errorMessage ?? 'This domain can’t be used for sending.';
  }
}

/**
 * What one press of Check verification found. The request
 * succeeding is not the domain verifying: only the provider's own `ready` is "verified", and a
 * pending answer says how many records are still outstanding, never "Checked".
 */
export type DomainCheckKind = 'verified' | 'pending' | 'records_missing' | 'provider_unavailable' | 'provider_error' | 'rejected';
export type DomainCheckResult = { kind: DomainCheckKind; message: string; checkedAt: string };

type CheckedRecord = { status: 'pending' | 'verified' | 'failed' };

export function domainCheckResult(
  standing: { state: 'pending' | 'ready' | 'failed'; records: readonly CheckedRecord[] },
  checkedAt: string,
): DomainCheckResult {
  const total = standing.records.length;
  const missing = standing.records.filter((record) => record.status === 'failed').length;
  const outstanding = standing.records.filter((record) => record.status !== 'verified').length;
  const records = (count: number) => `${count} of ${total} DNS record${total === 1 ? '' : 's'}`;
  if (standing.state === 'ready') return { kind: 'verified', message: 'Verified. You can add sender addresses at this domain.', checkedAt };
  if (standing.state === 'failed') return { kind: 'rejected', message: 'This domain was rejected. It can’t be used for sending.', checkedAt };
  if (missing > 0) return { kind: 'records_missing', message: `${records(missing)} not found. Publish them at your DNS host, then check again.`, checkedAt };
  if (outstanding > 0) return { kind: 'pending', message: `Verification requested. ${records(outstanding)} not verified yet; DNS changes can take a while to spread.`, checkedAt };
  return { kind: 'pending', message: 'Verification requested. Every record is published; the domain is still being confirmed.', checkedAt };
}

/** A refused check, in the same shape, so the domain row can say why rather than only a toast. */
export function domainCheckFailure(kind: 'provider_unavailable' | 'provider_error' | 'rejected', message: string, checkedAt: string): DomainCheckResult {
  return { kind, message, checkedAt };
}

/**
 * Where a business stands in setting up email, in the order it must happen: a domain registered,
 * its DNS published and verified, a sender address at it, that address made the default, and a
 * test sent. Each step names only what to do next.
 */
export type EmailSetupStep = 'add_domain' | 'verify_domain' | 'add_sender' | 'choose_default' | 'default_not_ready' | 'unavailable' | 'send_test' | 'ready';

export function emailSetupStep(input: {
  sendingState: 'ready' | 'not_ready' | 'unavailable' | 'missing';
  domains: readonly { state: 'pending' | 'ready' | 'failed' }[];
  readySenders: number;
  testsSent: number;
}): EmailSetupStep {
  if (input.sendingState === 'unavailable') return 'unavailable';
  if (input.sendingState === 'ready') return input.testsSent > 0 ? 'ready' : 'send_test';
  if (input.sendingState === 'not_ready') return 'default_not_ready';
  if (input.domains.length === 0) return 'add_domain';
  if (!input.domains.some((domain) => domain.state === 'ready')) return 'verify_domain';
  if (input.readySenders === 0) return 'add_sender';
  return 'choose_default';
}
