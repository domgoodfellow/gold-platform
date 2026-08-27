import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { resolveCustom, type CustomValues } from '@/lib/domain/fields/field-definitions';
import { requireActor } from '@/lib/domain/tenancy/actor';

/** A named reference on an asset — its owner, or where it sits. */
export type AssetRef = {
  id: string;
  label: string;
};

export type Asset = {
  id: string;
  name: string;
  /** The customer who owns it, when the asset is not the tenant's own. */
  customer: AssetRef | null;
  location: AssetRef | null;
  /** Tenant-defined fields, governed by this organization's registry (D7). */
  custom: CustomValues;
  createdAt: string;
};

const NAME_MAX = 200;

// One string literal, not a concatenation — supabase-js parses the select at the type level.
// Both embeds are hinted with their constraint names because the references are composite.
const ASSET_SELECT =
  'id, name, custom, created_at, customer:customers!assets_customer_same_org (id, name), location:locations!assets_location_same_org (id, label)';

function one<T>(value: T | T[] | null): T | undefined {
  if (value === null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export async function listAssets(
  db: Db,
  input: { organizationId: string },
): Promise<Asset[]> {
  const { data, error } = await db
    .from('assets')
    .select(ASSET_SELECT)
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new DomainError(error.message, 'assets.list_failed');
  }

  return (data ?? []).map((row) => {
    const customer = one(row.customer);
    const location = one(row.location);

    return {
      id: row.id,
      name: row.name,
      customer: customer ? { id: customer.id, label: customer.name } : null,
      location: location ? { id: location.id, label: location.label } : null,
      custom: (row.custom ?? {}) as CustomValues,
      createdAt: row.created_at,
    };
  });
}

/**
 * Record something the business owns, services, rents, sells, or tracks.
 *
 * There is deliberately no check that the customer and location belong to this organization.
 * Both references are composite, so an asset naming another tenant's anything is impossible
 * to write down — stronger than any check here, and not skippable by a direct insert (I18).
 */
export async function createAsset(
  db: Db,
  input: {
    organizationId: string;
    name: string;
    customerId?: string | null;
    locationId?: string | null;
    /** Raw form values keyed by field key. Coerced and checked against the registry here. */
    custom?: Record<string, string>;
  },
): Promise<string> {
  await requireActor(db);

  const name = input.name.trim();
  if (name.length === 0) {
    throw new DomainError('An asset needs a name.', 'assets.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'assets.name_too_long',
    );
  }

  const custom = await resolveCustom(db, {
    organizationId: input.organizationId,
    entityType: 'asset',
    custom: input.custom,
  });

  const { data, error } = await db.rpc('create_asset', {
    p_organization_id: input.organizationId,
    p_name: name,
    // A select that submits "" means "not set"; empty string is not a uuid, so it must
    // become null before it reaches Postgres.
    p_customer_id: (input.customerId || null) as string,
    p_location_id: (input.locationId || null) as string,
    p_custom: custom,
  });

  if (error) {
    if (error.code === '23503') {
      throw new DomainError(
        'No such customer or location here.',
        'assets.reference_not_found',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot add assets here.', 'assets.forbidden');
    }
    if (error.code === '23514') {
      throw new DomainError(error.message, 'assets.custom_invalid');
    }
    throw new DomainError(error.message, 'assets.create_failed');
  }

  return data;
}
