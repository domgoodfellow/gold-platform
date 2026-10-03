import type { Db } from '@/lib/db/types';
import type { Json } from '@/lib/db/database.types';
import { DomainError } from '@/lib/domain/errors';

/**
 * Which external provider scope belongs to an organization, and what GOLD created there.
 *
 * **Two tables, two shapes of fact.** A binding is the scope itself — a Twilio subaccount, GOLD's
 * one Resend account with a business's own domain beneath it — and its lifecycle. A resource is
 * one externally created thing inside that scope: a subaccount id, an API key's public half, a
 * phone number, a sending domain. Neither ever carries a secret; `organization_provider_resources`
 * withholds `secret_id` from every grant, and nothing in this file selects it.
 *
 * **Every write goes through a narrow function** — `begin_provider_binding`,
 * `set_provider_binding_status`, `record_provider_resource`, `set_provider_resource_status`,
 * `store_provider_secret` — because platform staff hold no insert, update or delete grant on
 * either table (D40's rule, restated for this axis). This file's writers are thin wrappers over
 * those, exactly as `catalogue.ts` wraps `record_provider_rate`.
 */

export type ProviderBinding = {
  id: string;
  organizationId: string;
  providerKey: string;
  externalAccountId: string | null;
  status: 'provisioning' | 'active' | 'failed' | 'suspended';
  lastVerifiedAt: string | null;
  lastError: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ProviderResource = {
  id: string;
  organizationId: string;
  bindingId: string;
  /**
   * Opaque, exactly like `externalId` below (I15): the set of resource types a capability
   * records is that capability's own vocabulary, named once in its adapter — see
   * `TELEPHONY_RESOURCE_TYPES` — never spelled out again here.
   */
  resourceType: string;
  externalId: string;
  status: 'pending' | 'active' | 'failed' | 'disabled';
  config: Record<string, unknown>;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type BindingRow = {
  id: string | null;
  organization_id: string | null;
  provider_key: string | null;
  external_account_id: string | null;
  status: string | null;
  last_verified_at: string | null;
  last_error: string | null;
  metadata: unknown;
  created_at: string | null;
  updated_at: string | null;
};

function toBinding(row: BindingRow): ProviderBinding | null {
  if (!row.id || !row.organization_id || !row.provider_key || !row.status || !row.created_at || !row.updated_at) {
    return null;
  }
  return {
    id: row.id,
    organizationId: row.organization_id,
    providerKey: row.provider_key,
    externalAccountId: row.external_account_id,
    status: row.status as ProviderBinding['status'],
    lastVerifiedAt: row.last_verified_at,
    lastError: row.last_error,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type ResourceRow = {
  id: string | null;
  organization_id: string | null;
  binding_id: string | null;
  resource_type: string | null;
  external_id: string | null;
  status: string | null;
  config: unknown;
  last_verified_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function toResource(row: ResourceRow): ProviderResource | null {
  if (
    !row.id ||
    !row.organization_id ||
    !row.binding_id ||
    !row.resource_type ||
    !row.external_id ||
    !row.status ||
    !row.created_at ||
    !row.updated_at
  ) {
    return null;
  }
  return {
    id: row.id,
    organizationId: row.organization_id,
    bindingId: row.binding_id,
    resourceType: row.resource_type as ProviderResource['resourceType'],
    externalId: row.external_id,
    status: row.status as ProviderResource['status'],
    config: (row.config as Record<string, unknown>) ?? {},
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Every binding an organization has — a tenant reading its own, or staff reading any tenant's. */
export async function listProviderBindings(
  db: Db,
  input: { organizationId: string },
): Promise<ProviderBinding[]> {
  const { data, error } = await db
    .from('organization_provider_bindings')
    .select('id, organization_id, provider_key, external_account_id, status, last_verified_at, last_error, metadata, created_at, updated_at')
    .eq('organization_id', input.organizationId)
    .order('provider_key', { ascending: true });

  if (error) throw new DomainError(error.message, 'providers.bindings_failed');

  return (data ?? []).map(toBinding).filter((row): row is ProviderBinding => row !== null);
}

/** Global binding totals for the provider control plane. Returns counts only, never credentials. */
export async function listProviderBindingCounts(db: Db): Promise<Map<string, number>> {
  const { data, error } = await db
    .from('organization_provider_bindings')
    .select('provider_key');
  if (error) throw new DomainError(error.message, 'providers.binding_counts_failed');
  const counts = new Map<string, number>();
  for (const row of data ?? []) counts.set(row.provider_key, (counts.get(row.provider_key) ?? 0) + 1);
  return counts;
}

/** Per-provider binding totals and how many are failed — counts only, for the control plane. */
export async function listProviderBindingSummary(db: Db): Promise<Map<string, { total: number; failed: number }>> {
  const { data, error } = await db.from('organization_provider_bindings').select('provider_key, status');
  if (error) throw new DomainError(error.message, 'providers.binding_counts_failed');
  const summary = new Map<string, { total: number; failed: number }>();
  for (const row of data ?? []) {
    const entry = summary.get(row.provider_key) ?? { total: 0, failed: 0 };
    entry.total += 1;
    if (row.status === 'failed') entry.failed += 1;
    summary.set(row.provider_key, entry);
  }
  return summary;
}

/** One organization's binding to one provider, or null if it has never had one. */
export async function getProviderBinding(
  db: Db,
  input: { organizationId: string; providerKey: string },
): Promise<ProviderBinding | null> {
  const { data, error } = await db
    .from('organization_provider_bindings')
    .select('id, organization_id, provider_key, external_account_id, status, last_verified_at, last_error, metadata, created_at, updated_at')
    .eq('organization_id', input.organizationId)
    .eq('provider_key', input.providerKey)
    .maybeSingle();

  if (error) throw new DomainError(error.message, 'providers.binding_failed');

  return data ? toBinding(data) : null;
}

/** Every resource beneath an organization's bindings, optionally narrowed to one provider. */
export async function listProviderResources(
  db: Db,
  input: { organizationId: string; providerKey?: string },
): Promise<ProviderResource[]> {
  let query = db
    .from('organization_provider_resources')
    .select('id, organization_id, binding_id, resource_type, external_id, status, config, last_verified_at, created_at, updated_at')
    .eq('organization_id', input.organizationId);

  if (input.providerKey) {
    const binding = await getProviderBinding(db, { organizationId: input.organizationId, providerKey: input.providerKey });
    if (!binding) return [];
    query = query.eq('binding_id', binding.id);
  }

  const { data, error } = await query.order('created_at', { ascending: true });

  if (error) throw new DomainError(error.message, 'providers.resources_failed');

  return (data ?? []).map(toResource).filter((row): row is ProviderResource => row !== null);
}

function staffWriteError(error: { code?: string; message: string }, action: string): DomainError {
  return new DomainError(
    error.code === '42501' ? `Only platform staff may ${action}.` : error.message,
    'providers.write_failed',
  );
}

/** Starts, or resumes after a failure, one organization's binding to one provider. Staff-only. */
export async function beginProviderBinding(
  db: Db,
  input: { organizationId: string; providerKey: string; providerAccountId?: string },
): Promise<string> {
  const { data, error } = await db.rpc('begin_provider_binding', {
    p_organization_id: input.organizationId,
    p_provider_key: input.providerKey,
    p_provider_account_id: input.providerAccountId,
  });

  if (error) throw staffWriteError(error, 'begin a provider binding');
  return data as string;
}

export async function setProviderBindingStatus(
  db: Db,
  input: {
    organizationId: string;
    providerKey: string;
    status: 'provisioning' | 'active' | 'failed' | 'suspended';
    externalAccountId?: string | null;
    error?: string | null;
  },
): Promise<void> {
  const { error } = await db.rpc('set_provider_binding_status', {
    p_organization_id: input.organizationId,
    p_provider_key: input.providerKey,
    p_status: input.status,
    p_external_account_id: input.externalAccountId ?? undefined,
    p_error: input.error ?? undefined,
  });

  if (error) throw staffWriteError(error, 'change a provider binding');
}

export async function recordProviderResource(
  db: Db,
  input: {
    organizationId: string;
    providerKey: string;
    resourceType: ProviderResource['resourceType'];
    externalId: string;
    config?: Record<string, unknown>;
    status?: ProviderResource['status'];
  },
): Promise<string> {
  const { data, error } = await db.rpc('record_provider_resource', {
    p_organization_id: input.organizationId,
    p_provider_key: input.providerKey,
    p_resource_type: input.resourceType,
    p_external_id: input.externalId,
    p_config: (input.config ?? {}) as Json,
    p_status: input.status ?? 'active',
  });

  if (error) throw staffWriteError(error, 'record a provider resource');
  return data as string;
}

export async function setProviderResourceStatus(
  db: Db,
  input: { organizationId: string; resourceId: string; status: ProviderResource['status']; error?: string | null },
): Promise<void> {
  const { error } = await db.rpc('set_provider_resource_status', {
    p_organization_id: input.organizationId,
    p_resource_id: input.resourceId,
    p_status: input.status,
    p_error: input.error ?? undefined,
  });

  if (error) throw staffWriteError(error, 'change a provider resource');
}

/**
 * Stores or rotates a resource's generated secret. Returns only the resource id — never the
 * secret. Staff-only, and the only door onto Vault this repository has (D14's own boundary,
 * restated for a generated credential rather than a person's).
 */
export async function storeProviderSecret(
  db: Db,
  input: { organizationId: string; resourceId: string; secret: string },
): Promise<void> {
  const { error } = await db.rpc('store_provider_secret', {
    p_organization_id: input.organizationId,
    p_resource_id: input.resourceId,
    p_secret: input.secret,
  });

  if (error) throw staffWriteError(error, 'store a provider secret');
}
