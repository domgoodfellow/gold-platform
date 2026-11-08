import {
  sendingDomainProvider,
  SENDING_DOMAIN_RESOURCE_TYPE,
  type RequiredDnsRecord,
  type SendingDomainStanding,
  type SendingDomainState,
} from '@/lib/adapters/email-domains';
import { requireAccessToken } from '@/lib/api/client';
import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { PROVIDER_UNAVAILABLE_MESSAGE } from './presentation';

/**
 * A business's own sending domains: the names it has asked to send from, and where each stands.
 *
 * **Naming a domain and proving it are two halves, and this file sequences them.** Naming it is
 * the business's own act, checked by the database (`record_organization_email_domain`:
 * `organization.manage`, and a name this platform could verify). Creating it at the provider,
 * learning which DNS records it wants and asking whether they are published is the provider's
 * answer, which only `apps/api` can ask for and record. What a person sees afterwards is
 * read back from the row, so the answer survives the page being closed.
 *
 * **A verified domain is permission to send, not an address and not a mailbox.** Nothing here
 * creates `hello@`, and nothing here receives anything. Keeping that boundary in the words is the
 * point of calling this a sending domain throughout.
 */

export type { SendingDomainPresentation } from './presentation';
export {
  MANAGED_SENDING,
  PROVIDER_UNAVAILABLE_MESSAGE,
  SENDING_DOMAIN_BADGE,
  sendingDomainPresentation,
  sendingDomainSentence,
} from './presentation';
export type { DnsApplyOutcome, RequiredDnsRecord, SendingDomainStanding } from '@/lib/adapters/email-domains';

export type SendingDomain = {
  resourceId: string;
  domain: string;
  state: SendingDomainState;
  /** True once the provider has accepted the name and GildOps holds its own id for it. */
  providerDomainId: string | null;
  /** The provider's own status word, for a sentence a person reads. Never branched on. */
  providerStatus: string | null;
  records: RequiredDnsRecord[];
  outstandingRecords: number;
  errorCode: string | null;
  errorMessage: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
};

type Config = {
  provider_domain_id?: unknown;
  provider_status?: unknown;
  dns_records?: unknown;
  error_code?: unknown;
  last_error?: unknown;
};

const RECORD_TYPES = new Set(['MX', 'TXT', 'CNAME']);

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** The records the provider asked for, as stored. Anything unreadable is dropped rather than shown as a half record. */
function recordsFrom(config: Config): RequiredDnsRecord[] {
  if (!Array.isArray(config.dns_records)) return [];
  return config.dns_records.flatMap((raw): RequiredDnsRecord[] => {
    if (typeof raw !== 'object' || raw === null) return [];
    const record = raw as Record<string, unknown>;
    if (typeof record.type !== 'string' || !RECORD_TYPES.has(record.type)) return [];
    if (typeof record.name !== 'string' || typeof record.value !== 'string') return [];
    const status = record.status === 'verified' || record.status === 'failed' ? record.status : 'pending';
    return [
      {
        type: record.type as RequiredDnsRecord['type'],
        name: record.name,
        value: record.value,
        purpose: typeof record.purpose === 'string' ? record.purpose : '',
        status,
        ...(typeof record.priority === 'number' ? { priority: record.priority } : {}),
      },
    ];
  });
}

/** `active` is the resource lifecycle's word for it; this capability's is `ready`. */
function stateFrom(status: string): SendingDomainState {
  if (status === 'active') return 'ready';
  if (status === 'failed') return 'failed';
  return 'pending';
}

/** This business's sending domains, oldest first, with the records to publish. RLS scopes the read. */
export async function listSendingDomains(db: Db, organizationId: string): Promise<SendingDomain[]> {
  const { data, error } = await db
    .from('organization_provider_resources')
    .select('id, external_id, status, config, last_verified_at, created_at')
    .eq('organization_id', organizationId)
    .eq('resource_type', SENDING_DOMAIN_RESOURCE_TYPE)
    .order('created_at');
  if (error) throw fromDatabaseError(error, 'email.read_failed');

  return (data ?? []).map((row) => {
    const config = (row.config ?? {}) as Config;
    const records = recordsFrom(config);
    return {
      resourceId: row.id,
      domain: row.external_id,
      state: stateFrom(row.status),
      providerDomainId: text(config.provider_domain_id),
      providerStatus: text(config.provider_status),
      records,
      outstandingRecords: records.filter((record) => record.status !== 'verified').length,
      errorCode: text(config.error_code),
      errorMessage: text(config.last_error),
      lastVerifiedAt: row.last_verified_at,
      createdAt: row.created_at,
    };
  });
}

/** What an attempt came to, for the page's next step. */
export type SendingDomainOutcome =
  | { kind: 'ok'; resourceId: string; standing: SendingDomainStanding }
  | { kind: 'provider_unavailable'; resourceId: string; message: string }
  | { kind: 'provider_error'; resourceId: string; message: string }
  | { kind: 'rejected'; resourceId: string | null; message: string };

/** A refusal from `apps/api`, or its absence, turned into the outcome a person can act on. */
function failureOutcome(resourceId: string, error: unknown): SendingDomainOutcome {
  if (!(error instanceof DomainError)) throw error;
  switch (error.code) {
    case 'api.unconfigured':
    case 'api.unreachable':
    case 'api.provider_unavailable':
      return { kind: 'provider_unavailable', resourceId, message: PROVIDER_UNAVAILABLE_MESSAGE };
    case 'api.domain_rejected':
      return { kind: 'rejected', resourceId, message: error.message };
    case 'api.provider_refused':
    case 'api.validation':
      return { kind: 'provider_error', resourceId, message: error.message };
    default:
      throw error;
  }
}

function refusal(error: { code?: string; message: string }): DomainError {
  if (error.code === '42501') return new DomainError('Your role cannot change this business’s sending domains.', 'email.forbidden');
  if (error.code === '22023') return fromDatabaseError(error, 'email.invalid');
  return fromDatabaseError(error, 'email.write_failed');
}

/**
 * Name a sending domain and ask the provider for it. Pressing this twice with the same name is
 * one domain: the database upsert keys on the name, and the provider call resumes rather than
 * creating a second domain upstream.
 */
export async function requestSendingDomain(
  db: Db,
  input: { organizationId: string; domain: string },
): Promise<SendingDomainOutcome> {
  const domain = input.domain.trim().toLowerCase().replace(/\.$/, '');
  if (domain === '') throw new DomainError('A sending domain is required.', 'email.invalid');

  const { data: resourceId, error } = await db.rpc('record_organization_email_domain', {
    p_organization_id: input.organizationId,
    p_domain: domain,
  });
  if (error) throw refusal(error);
  if (!resourceId) throw new DomainError('The sending domain was not recorded.', 'email.write_failed');

  const provider = sendingDomainProvider({ token: await requireAccessToken(db) });
  try {
    return { kind: 'ok', resourceId, standing: await provider.provision({ organizationId: input.organizationId, resourceId }) };
  } catch (failure) {
    return failureOutcome(resourceId, failure);
  }
}

/** Ask the provider again — the button a person presses once they have published DNS. */
export async function checkSendingDomain(
  db: Db,
  input: { organizationId: string; resourceId: string },
): Promise<SendingDomainOutcome> {
  const provider = sendingDomainProvider({ token: await requireAccessToken(db) });
  try {
    return { kind: 'ok', resourceId: input.resourceId, standing: await provider.check(input) };
  } catch (failure) {
    return failureOutcome(input.resourceId, failure);
  }
}

/**
 * The one consequential DNS mutation: publishes the outstanding records through this business's
 * own connected zone, then asks the provider again. Reached only from the review step a person
 * has already seen.
 */
export async function applySendingDomainDns(
  db: Db,
  input: { organizationId: string; resourceId: string },
): Promise<SendingDomainOutcome> {
  const provider = sendingDomainProvider({ token: await requireAccessToken(db) });
  try {
    return { kind: 'ok', resourceId: input.resourceId, standing: await provider.applyDns(input) };
  } catch (failure) {
    return failureOutcome(input.resourceId, failure);
  }
}

/**
 * Let go of a sending domain. One the provider accepted is deleted there first, by `apps/api`,
 * which releases the row as the person asking; one it never accepted has nothing upstream and is
 * released through the same database door.
 */
export async function releaseSendingDomain(db: Db, input: { organizationId: string; resourceId: string }): Promise<void> {
  try {
    await sendingDomainProvider({ token: await requireAccessToken(db) }).release(input);
  } catch (failure) {
    if (failure instanceof DomainError && failure.code.startsWith('api.')) {
      const outcome = failureOutcome(input.resourceId, failure);
      throw new DomainError('message' in outcome ? outcome.message : failure.message, `email.${outcome.kind}`);
    }
    throw failure;
  }
}
