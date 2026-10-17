import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { LIST_LIMIT, counted, type Counted } from '@/lib/domain/counted';
import {
  resolveCustom,
  type CustomInput,
  type CustomValues,
} from '@/lib/domain/fields/field-definitions';
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
  /** Tenant-defined fields, governed by this organization's registry. */
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
  input: { organizationId: string; locationId?: string; limit?: number },
): Promise<Counted<Asset>> {
  let query = db
    .from('assets')
    .select(ASSET_SELECT, { count: 'exact' })
    .eq('organization_id', input.organizationId);

  // Optional, for the same reason `listWorkItems`'s `typeId` and `assetId` filters are: the
  // assets list asks for everything, and a location's own record page asks what sits there.
  if (input.locationId) {
    query = query.eq('location_id', input.locationId);
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .limit(input.limit ?? LIST_LIMIT);

  if (error) {
    throw new DomainError(error.message, 'assets.list_failed');
  }

  return counted(
    (data ?? []).map((row) => {
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
    }),
    count,
  );
}

/**
 * One asset, or null.
 *
 * Null covers both "no such asset" and "not yours" without the caller being able to tell them
 * apart — RLS produces that indistinguishability for free, exactly as it does for `getCustomer`.
 */
export async function getAsset(
  db: Db,
  input: { organizationId: string; assetId: string },
): Promise<Asset | null> {
  const { data, error } = await db
    .from('assets')
    .select(ASSET_SELECT)
    .eq('organization_id', input.organizationId)
    .eq('id', input.assetId)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'assets.get_failed');
  }
  if (!data) return null;

  const customer = one(data.customer);
  const location = one(data.location);

  return {
    id: data.id,
    name: data.name,
    customer: customer ? { id: customer.id, label: customer.name } : null,
    location: location ? { id: location.id, label: location.label } : null,
    custom: (data.custom ?? {}) as CustomValues,
    createdAt: data.created_at,
  };
}

/**
 * Record something the business owns, services, rents, sells, or tracks.
 *
 * There is deliberately no check that the customer and location belong to this organization.
 * Both references are composite, so an asset naming another tenant's anything is impossible
 * to write down — stronger than any check here, and not skippable by a direct insert.
 */
export async function createAsset(
  db: Db,
  input: {
    organizationId: string;
    name: string;
    customerId?: string | null;
    locationId?: string | null;
    /** Raw form values keyed by field key. Coerced and checked against the registry here. */
    custom?: CustomInput;
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
