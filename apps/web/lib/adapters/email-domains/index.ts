/**
 * Proving a business's own sending domain, named as a capability rather than a provider (I15).
 *
 * **A sending domain is not a sender identity and not a mailbox.** Proven here means the provider
 * will authorize mail sent *from* addresses under this domain. It does not mean any particular
 * address exists, and it does not mean mail sent *to* one arrives anywhere GildOps can read.
 * Those are two later slices, and keeping the words apart here is what stops a screen promising
 * either of them.
 *
 * **No credential is here and none can be.** The provider account lives in
 * `platform_provider_accounts` (D54/D62) and is read only by `apps/api`'s `provider_operator`
 * (D14): every method is a request carrying the person's own token, and what comes back is
 * GildOps' vocabulary — never a provider's JSON, and never its own word for anything but the one
 * opaque `providerStatus` string a screen may show a person verbatim.
 */

/** Where a sending domain stands, in GildOps' own words. `ready` is the provider's answer, never a form's. */
export type SendingDomainState = 'pending' | 'ready' | 'failed';

/** One record the provider wants published, and whether it has seen it yet. */
export type RequiredDnsRecord = {
  type: 'MX' | 'TXT' | 'CNAME';
  /** Absolute: the whole name a DNS host is given, never a fragment relative to the domain. */
  name: string;
  value: string;
  /** What the record is for, in the provider's own short word. Shown, never branched on. */
  purpose: string;
  status: 'pending' | 'verified' | 'failed';
  /** MX alone carries one. */
  priority?: number;
};

/**
 * Whether this business's own connected DNS *could* publish the outstanding records — read-only,
 * computed fresh on every answer. Never implies anything has been written: that is `applyDns`
 * alone, pressed explicitly after a person reviews exactly what would change.
 */
export type DnsAutomation = {
  available: boolean;
  connectionId: string | null;
  zoneName: string | null;
};

/** What one record came to when GildOps published it through the business's own connected zone. */
export type DnsRecordOutcome = {
  type: string;
  name: string;
  value: string;
  /** created | updated | unchanged | conflict | failed — the last two are what the manual path still has to finish. */
  outcome: string;
  message: string | null;
};

export type DnsApplyOutcome = {
  applied: boolean;
  zoneName: string | null;
  records: DnsRecordOutcome[];
};

export type SendingDomainStanding = {
  resourceId: string;
  domain: string;
  state: SendingDomainState;
  /** The provider's own word for the same thing, for a sentence a person reads. Opaque here. */
  providerStatus: string;
  records: RequiredDnsRecord[];
  recordsVerified: number;
  dnsAutomation: DnsAutomation;
  /** Present only on the answer to `applyDns`. */
  dnsOutcome: DnsApplyOutcome | null;
};

export type SendingDomainProvider = {
  /** Create the domain at the provider, or resume one a previous attempt created. Retry-safe. */
  provision(input: { organizationId: string; resourceId: string }): Promise<SendingDomainStanding>;
  /** Ask the provider again — what a person presses once they have published DNS. */
  check(input: { organizationId: string; resourceId: string }): Promise<SendingDomainStanding>;
  /**
   * The one consequential DNS mutation: publishes the outstanding records through this business's
   * own connected zone, then asks the provider again. Only reachable once `dnsAutomation.available`
   * was already true on an earlier answer — the review step, pressed.
   */
  applyDns(input: { organizationId: string; resourceId: string }): Promise<SendingDomainStanding>;
  /** Delete it at the provider, and release the row as the person asking. */
  release(input: { organizationId: string; resourceId: string }): Promise<void>;
};

/** Re-exported so only ./registry names an implementation (adapters.test.ts). */
export { sendingDomainProvider, SENDING_DOMAIN_RESOURCE_TYPE } from './registry';
