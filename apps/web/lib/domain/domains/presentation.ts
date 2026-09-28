import type { DomainVerificationState } from '@/lib/adapters/domains';

/**
 * How a custom domain reads to a person — one classification and one set of sentences, so the
 * list, the dialog and the tests cannot disagree. Pure, and free of any database or network
 * import, so a client component can hold it.
 */

export type DomainSurface = 'website' | 'portal';

export const DOMAIN_SURFACES: readonly { key: DomainSurface; label: string; description: string }[] = [
  { key: 'website', label: 'Website', description: 'Opens your published home page.' },
  { key: 'portal', label: 'Customer portal', description: 'For customers who hold an access link from you.' },
];

export type DomainPresentation =
  | 'active'
  | 'pending_dns'
  | 'not_registered'
  | 'provider_unavailable'
  | 'provider_error'
  | 'conflict';

/** A hosting account nobody configured is its own state and never a DNS problem. */
export function domainPresentation(domain: {
  verificationState: DomainVerificationState;
  errorCode: string | null;
  registered: boolean;
}): DomainPresentation {
  if (domain.verificationState === 'verified') return 'active';
  if (domain.verificationState === 'failed') return 'conflict';
  if (domain.errorCode === 'provider_unavailable') return 'provider_unavailable';
  if (domain.errorCode) return 'provider_error';
  if (!domain.registered) return 'not_registered';
  return 'pending_dns';
}

/** Says nothing about who holds the name, whether it is another business or somebody outside GildOps. */
export const CONFLICT_MESSAGE =
  'That domain is already connected elsewhere. If it is yours, remove it where it is connected first.';

export const PROVIDER_UNAVAILABLE_MESSAGE =
  'Custom domains cannot be connected on this deployment yet. Nothing is wrong with your domain or your DNS.';
