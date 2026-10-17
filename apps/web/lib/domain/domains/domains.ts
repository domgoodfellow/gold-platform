import {
  domainProvider,
  type DnsRecord,
  type DomainCertificateState,
  type DomainConfigurationState,
  type DomainStanding,
  type DomainVerificationState,
} from '@/lib/adapters/domains';
import { requireAccessToken } from '@/lib/api/client';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { checkHostname, HOSTNAME_PROBLEM } from './hostname';
import { CONFLICT_MESSAGE, PROVIDER_UNAVAILABLE_MESSAGE, type DomainSurface } from './presentation';

/**
 * A business's hostnames: the GildOps address its public name produces, and the domains it owns.
 *
 * **The GildOps address is computed, never stored.** It is the business's slug under the
 * deployment's managed zone; until the business chooses a public name it has none, and the platform
 * does not invent one (`organizations.slug` is null until a person sets it).
 *
 * **A custom domain has two halves and this file sequences them.** Naming it is the business's
 * own act, checked by the database (`begin_custom_domain_connection`: `organization.manage`, a
 * well-formed name, not claimed anywhere). Registering and verifying it is the hosting provider's
 * answer, which only `apps/api` can ask for and record. What a person sees afterwards is read
 * back from the row, so the answer survives the dialog closing.
 */

export type { DomainPresentation, DomainSurface } from './presentation';
export { CONFLICT_MESSAGE, DOMAIN_SURFACES, domainPresentation, PROVIDER_UNAVAILABLE_MESSAGE } from './presentation';

export type CustomDomain = {
  id: string;
  hostname: string;
  surface: DomainSurface;
  isPrimary: boolean;
  verificationState: DomainVerificationState;
  configurationState: DomainConfigurationState;
  certificateState: DomainCertificateState;
  /** True once the hosting provider has accepted the name. */
  registered: boolean;
  lastCheckedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  dnsRecords: DnsRecord[];
  createdAt: string;
};

export type ManagedAddress =
  | { state: 'no_slug' }
  | { state: 'not_offered' }
  | { state: 'ready'; hostname: string };

/** The GildOps address a business's public name produces, or why it has none. */
export async function getManagedHostname(db: Db, input: { slug: string | null }): Promise<ManagedAddress> {
  if (!input.slug) return { state: 'no_slug' };
  const zone = await platformPublicDomain(db);
  if (!zone) return { state: 'not_offered' };
  return { state: 'ready', hostname: `${input.slug}.${zone}` };
}

/** The deployment's managed zone, or null when it offers none. Not a secret: it is in every managed address. */
export async function platformPublicDomain(db: Db): Promise<string | null> {
  const { data, error } = await db.rpc('platform_public_domain');
  if (error) throw new DomainError(error.message, 'domains.read_failed');
  return data ?? null;
}

type RecordConfig = { dns_records?: unknown } | null;

function recordsFrom(config: unknown): DnsRecord[] {
  const records = (config as RecordConfig)?.dns_records;
  if (!Array.isArray(records)) return [];
  return records.filter(
    (record): record is DnsRecord =>
      typeof record === 'object' && record !== null &&
      typeof (record as DnsRecord).type === 'string' &&
      typeof (record as DnsRecord).name === 'string' &&
      typeof (record as DnsRecord).value === 'string',
  );
}

/** This business's unreleased custom domains, newest last, with the DNS records to publish. RLS scopes the read. */
export async function listDomains(db: Db, organizationId: string): Promise<CustomDomain[]> {
  const { data, error } = await db
    .from('organization_domains')
    .select('id, hostname, surface, is_primary, verification_state, configuration_state, ssl_state, provider_resource_id, last_checked_at, error_code, error_message, created_at')
    .eq('organization_id', organizationId)
    .is('released_at', null)
    .order('created_at');
  if (error) throw new DomainError(error.message, 'domains.read_failed');

  const resourceIds = (data ?? []).map((row) => row.provider_resource_id).filter((id): id is string => Boolean(id));
  const configs = new Map<string, unknown>();
  if (resourceIds.length > 0) {
    const resources = await db
      .from('organization_provider_resources')
      .select('id, config')
      .eq('organization_id', organizationId)
      .in('id', resourceIds);
    if (resources.error) throw new DomainError(resources.error.message, 'domains.read_failed');
    for (const resource of resources.data ?? []) configs.set(resource.id, resource.config);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    hostname: row.hostname,
    surface: row.surface as DomainSurface,
    isPrimary: row.is_primary,
    verificationState: row.verification_state as DomainVerificationState,
    configurationState: row.configuration_state as DomainConfigurationState,
    certificateState: row.ssl_state as DomainCertificateState,
    registered: Boolean(row.provider_resource_id),
    lastCheckedAt: row.last_checked_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    dnsRecords: row.provider_resource_id ? recordsFrom(configs.get(row.provider_resource_id)) : [],
    createdAt: row.created_at,
  }));
}

/** What an attempt to connect or check came to, for the dialog's next step. */
export type DomainOutcome =
  | { kind: 'active'; domainId: string; standing: DomainStanding }
  | { kind: 'pending_dns'; domainId: string; standing: DomainStanding }
  | { kind: 'provider_unavailable'; domainId: string; message: string }
  | { kind: 'provider_error'; domainId: string; message: string }
  | { kind: 'conflict'; domainId: string | null; message: string };

function outcomeFrom(domainId: string, standing: DomainStanding): DomainOutcome {
  return standing.verificationState === 'verified'
    ? { kind: 'active', domainId, standing }
    : { kind: 'pending_dns', domainId, standing };
}

/** A refusal from `apps/api`, or its absence, turned into the outcome a person can act on. */
function failureOutcome(domainId: string, error: unknown): DomainOutcome {
  if (!(error instanceof DomainError)) throw error;
  switch (error.code) {
    case 'api.unconfigured':
    case 'api.unreachable':
    case 'api.provider_unavailable':
      return { kind: 'provider_unavailable', domainId, message: PROVIDER_UNAVAILABLE_MESSAGE };
    case 'api.hostname_unavailable':
      return { kind: 'conflict', domainId, message: CONFLICT_MESSAGE };
    case 'api.provider_refused':
      return { kind: 'provider_error', domainId, message: error.message };
    default:
      throw error;
  }
}

function refusal(error: { code?: string; message: string }): DomainError {
  if (error.code === '23505') return new DomainError(CONFLICT_MESSAGE, 'domains.conflict');
  if (error.code === '42501') return new DomainError('You cannot manage this business’s domains.', 'domains.forbidden');
  if (error.code === '22023') return new DomainError(error.message, 'domains.invalid');
  return new DomainError(error.message, 'domains.write_failed');
}

/**
 * Name a hostname for a surface, then ask the hosting provider to attach it. A hostname already
 * claimed anywhere is a `conflict` outcome that names nobody; the row is not created.
 */
export async function connectDomain(
  db: Db,
  input: { organizationId: string; hostname: string; surface: DomainSurface },
): Promise<DomainOutcome> {
  const checked = checkHostname(input.hostname, await platformPublicDomain(db));
  if (!checked.ok) throw new DomainError(HOSTNAME_PROBLEM[checked.problem], 'domains.invalid');

  const { data: domainId, error } = await db.rpc('begin_custom_domain_connection', {
    p_organization_id: input.organizationId,
    p_hostname: checked.hostname,
    p_surface: input.surface,
  });
  if (error) {
    const refused = refusal(error);
    if (refused.code === 'domains.conflict') return { kind: 'conflict', domainId: null, message: CONFLICT_MESSAGE };
    throw refused;
  }
  if (!domainId) throw new DomainError('The domain was not recorded.', 'domains.write_failed');

  const provider = domainProvider({ token: await requireAccessToken(db) });
  try {
    return outcomeFrom(domainId, await provider.connect({ organizationId: input.organizationId, domainId }));
  } catch (failure) {
    return failureOutcome(domainId, failure);
  }
}

/** Ask the hosting provider again — the button a person presses once they have published DNS. */
export async function checkDomain(db: Db, input: { organizationId: string; domainId: string }): Promise<DomainOutcome> {
  const provider = domainProvider({ token: await requireAccessToken(db) });
  try {
    return outcomeFrom(input.domainId, await provider.check(input));
  } catch (failure) {
    return failureOutcome(input.domainId, failure);
  }
}

/**
 * The one consequential DNS mutation: ensures the required records through this business's own
 * connected zone, then rechecks the hosting provider. Reached only from the review step a person
 * has already seen — `dnsAutomation.available` on an earlier `connectDomain`/`checkDomain` answer
 * (work order 1 closeout, section 3).
 */
export async function applyDnsAutomation(db: Db, input: { organizationId: string; domainId: string }): Promise<DomainOutcome> {
  const provider = domainProvider({ token: await requireAccessToken(db) });
  try {
    return outcomeFrom(input.domainId, await provider.applyAutomation(input));
  } catch (failure) {
    return failureOutcome(input.domainId, failure);
  }
}

/**
 * Let go of a hostname. One the provider accepted is detached there first, by `apps/api`, which
 * releases the row as the person asking; one it never accepted has nothing upstream and is
 * released here through the same database door.
 */
export async function removeDomain(db: Db, input: { organizationId: string; domainId: string }): Promise<void> {
  const { data, error } = await db
    .from('organization_domains')
    .select('provider_resource_id')
    .eq('id', input.domainId)
    .eq('organization_id', input.organizationId)
    .is('released_at', null)
    .maybeSingle();
  if (error) throw new DomainError(error.message, 'domains.read_failed');
  if (!data) throw new DomainError('No such domain.', 'domains.missing');

  if (!data.provider_resource_id) {
    const released = await db.rpc('release_custom_domain', {
      p_organization_id: input.organizationId,
      p_domain_id: input.domainId,
    });
    if (released.error) throw refusal(released.error);
    return;
  }

  try {
    await domainProvider({ token: await requireAccessToken(db) }).remove(input);
  } catch (failure) {
    if (failure instanceof DomainError && failure.code.startsWith('api.')) {
      const outcome = failureOutcome(input.domainId, failure);
      throw new DomainError('message' in outcome ? outcome.message : failure.message, `domains.${outcome.kind}`);
    }
    throw failure;
  }
}

/** Make a verified domain the one this surface is known by. */
export async function setPrimaryDomain(db: Db, input: { organizationId: string; domainId: string }): Promise<void> {
  const { error } = await db.rpc('set_primary_custom_domain', {
    p_organization_id: input.organizationId,
    p_domain_id: input.domainId,
  });
  if (error) throw refusal(error);
}
