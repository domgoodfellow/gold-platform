/**
 * Putting a business's own hostname in front of GildOps, named as a capability rather than a host
 * (I15). The hosting provider's credential lives in the other runtime and never here (D14, D54):
 * every method is a request to `apps/api` carrying the person's own token, and what comes back is
 * GildOps' vocabulary — never a provider's JSON.
 */

/** Whether DNS for the hostname points where it must. */
export type DomainConfigurationState = 'dns_required' | 'satisfied';

/** Whether GildOps serves the hostname: proven and pointed (`verified`), on its way (`verifying`), not started, or refused. */
export type DomainVerificationState = 'pending' | 'verifying' | 'verified' | 'failed';

/** Inferred from verification by the runtime that asked; see `apps/api/app/providers`. */
export type DomainCertificateState = 'pending' | 'issued' | 'failed';

/** One record a person publishes at their DNS host. */
export type DnsRecord = {
  type: 'A' | 'AAAA' | 'CNAME' | 'TXT';
  name: string;
  value: string;
};

export type DomainStanding = {
  domainId: string;
  hostname: string;
  configurationState: DomainConfigurationState;
  verificationState: DomainVerificationState;
  certificateState: DomainCertificateState;
  dnsRecords: DnsRecord[];
};

export type DomainProvider = {
  /** Attach a pending domain and read where it stands. */
  connect(input: { organizationId: string; domainId: string }): Promise<DomainStanding>;
  /** Ask again — after DNS was published, say. Registers a domain that never was. */
  check(input: { organizationId: string; domainId: string }): Promise<DomainStanding>;
  /** Detach it, and release the row as the person asking. */
  remove(input: { organizationId: string; domainId: string }): Promise<void>;
};

/** Re-exported so only ./registry names an implementation (adapters.test.ts). */
export { domainHostingProviderKey, domainProvider } from './registry';
