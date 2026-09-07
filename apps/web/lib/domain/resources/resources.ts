import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { LIST_LIMIT, counted, type Counted } from '@/lib/domain/counted';
import {
  resolveCustom,
  type CustomInput,
  type CustomValues,
} from '@/lib/domain/fields/field-definitions';
import { requireActor } from '@/lib/domain/tenancy/actor';

export type Resource = {
  id: string;
  name: string;
  /** Tenant-defined fields, governed by this organization's registry (D7). */
  custom: CustomValues;
  createdAt: string;
};

const NAME_MAX = 200;

/**
 * The resources one organization can schedule against.
 *
 * The `organization_id` filter is an optimisation, not the boundary — RLS has already
 * restricted the rows to organizations the caller belongs to.
 */
export async function listResources(
  db: Db,
  input: { organizationId: string; limit?: number },
): Promise<Counted<Resource>> {
  const { data, error, count } = await db
    .from('resources')
    .select('id, name, custom, created_at', { count: 'exact' })
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: false })
    .limit(input.limit ?? LIST_LIMIT);

  if (error) {
    throw new DomainError(error.message, 'resources.list_failed');
  }

  return counted(
    (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      custom: (row.custom ?? {}) as CustomValues,
      createdAt: row.created_at,
    })),
    count,
  );
}

/**
 * Record something the business can schedule work against.
 *
 * Whether the caller may is not decided here — `resources_insert` requires `resource.create`,
 * so a caller without it is refused by the database however it arrives.
 */
export async function createResource(
  db: Db,
  input: {
    organizationId: string;
    name: string;
    /** Raw form values keyed by field key. Coerced and checked against the registry here. */
    custom?: CustomInput;
  },
): Promise<string> {
  await requireActor(db);

  const name = input.name.trim();
  if (name.length === 0) {
    throw new DomainError('A resource needs a name.', 'resources.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'resources.name_too_long',
    );
  }

  const custom = await resolveCustom(db, {
    organizationId: input.organizationId,
    entityType: 'resource',
    custom: input.custom,
  });

  const { data, error } = await db.rpc('create_resource', {
    p_organization_id: input.organizationId,
    p_name: name,
    p_custom: custom,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot add resources here.', 'resources.forbidden');
    }
    if (error.code === '23514') {
      throw new DomainError(error.message, 'resources.custom_invalid');
    }
    throw new DomainError(error.message, 'resources.create_failed');
  }

  return data;
}
