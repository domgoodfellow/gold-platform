import { geocodingProvider, type Coordinates } from '@/lib/adapters/geocoding';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { LIST_LIMIT, counted, type Counted } from '@/lib/domain/counted';
import {
  resolveCustom,
  type CustomInput,
  type CustomValues,
} from '@/lib/domain/fields/field-definitions';
import { requireActor } from '@/lib/domain/tenancy/actor';

export type LinkedCustomer = {
  id: string;
  name: string;
};

export type Location = {
  id: string;
  label: string;
  address: string;
  accessNotes: string | null;
  /**
   * Where this place is, or null because nobody has said.
   *
   * Derived from `address`, which stays the truth. Null is an ordinary answer and carries no
   * implication that anything is unfinished — a business that never books work against weather
   * or travel has no reason to fill it in.
   */
  coordinates: Coordinates | null;
  /** Tenant-defined fields, governed by this organization's registry (D7). */
  custom: CustomValues;
  /** The customers served here. Many-to-many: a site can serve several. */
  customers: LinkedCustomer[];
  createdAt: string;
};

const LABEL_MAX = 200;
const ADDRESS_MAX = 500;
const ACCESS_NOTES_MAX = 2000;

/**
 * Locations belonging to one organization, each with the customers served there.
 *
 * The link is read in a second query rather than as a PostgREST embed. The foreign keys on
 * `customer_locations` are composite — `(organization_id, customer_id)` — which is what makes
 * a cross-tenant link unrepresentable, and it also means an embed would need a constraint
 * hint on every call. Two queries and a join here is the plainer thing, and the join is over
 * rows RLS has already restricted to this caller's tenants.
 */
export async function listLocations(
  db: Db,
  input: { organizationId: string; limit?: number },
): Promise<Counted<Location>> {
  const { data, error, count } = await db
    .from('locations')
    .select('id, label, address, access_notes, latitude, longitude, custom, created_at', {
      count: 'exact',
    })
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: false })
    .limit(input.limit ?? LIST_LIMIT);

  if (error) {
    throw new DomainError(error.message, 'locations.list_failed');
  }

  const locations = data ?? [];
  if (locations.length === 0) {
    return counted([], count);
  }

  const { data: links, error: linkError } = await db
    .from('customer_locations')
    .select('location_id, customers!customer_locations_customer_same_org (id, name)')
    .eq('organization_id', input.organizationId);

  if (linkError) {
    throw new DomainError(linkError.message, 'locations.links_failed');
  }

  const byLocation = new Map<string, LinkedCustomer[]>();
  for (const link of links ?? []) {
    // PostgREST returns an embedded to-one as an object, but the generated types allow an
    // array because the relationship is expressed as two columns. `one()` collapses both
    // shapes rather than the call site guessing which it got.
    const customer = one(link.customers);
    if (!customer) continue;
    const existing = byLocation.get(link.location_id) ?? [];
    existing.push({ id: customer.id, name: customer.name });
    byLocation.set(link.location_id, existing);
  }

  return counted(
    locations.map((row) => ({
      id: row.id,
      label: row.label,
      address: row.address,
      accessNotes: row.access_notes,
      // The database refuses half a point (`locations_coordinates_are_complete`), so one test
      // covers both columns rather than two that could disagree.
      coordinates:
        row.latitude !== null && row.longitude !== null
          ? { latitude: row.latitude, longitude: row.longitude }
          : null,
      custom: (row.custom ?? {}) as CustomValues,
      customers: (byLocation.get(row.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      createdAt: row.created_at,
    })),
    count,
  );
}

function one<T>(value: T | T[] | null): T | undefined {
  if (value === null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * One location, or null.
 *
 * Null covers both "no such location" and "not yours" indistinguishably, via RLS — the same
 * shape `getCustomer` and `getAsset` share. The linked-customers query is the same second query
 * `listLocations` runs, scoped to one row instead of a page of them.
 */
export async function getLocation(
  db: Db,
  input: { organizationId: string; locationId: string },
): Promise<Location | null> {
  const { data, error } = await db
    .from('locations')
    .select('id, label, address, access_notes, latitude, longitude, custom, created_at')
    .eq('organization_id', input.organizationId)
    .eq('id', input.locationId)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'locations.get_failed');
  }
  if (!data) return null;

  const { data: links, error: linkError } = await db
    .from('customer_locations')
    .select('customers!customer_locations_customer_same_org (id, name)')
    .eq('organization_id', input.organizationId)
    .eq('location_id', input.locationId);

  if (linkError) {
    throw new DomainError(linkError.message, 'locations.links_failed');
  }

  const customers = (links ?? [])
    .map((link) => one(link.customers))
    .filter((customer): customer is { id: string; name: string } => customer !== undefined)
    .map((customer) => ({ id: customer.id, name: customer.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    id: data.id,
    label: data.label,
    address: data.address,
    accessNotes: data.access_notes,
    coordinates:
      data.latitude !== null && data.longitude !== null
        ? { latitude: data.latitude, longitude: data.longitude }
        : null,
    custom: (data.custom ?? {}) as CustomValues,
    customers,
    createdAt: data.created_at,
  };
}

/**
 * Create a location.
 *
 * Whether the caller may is not decided here — `locations_insert` requires `location.create`,
 * so a caller without it is refused by the database however it arrives.
 */
export async function createLocation(
  db: Db,
  input: {
    organizationId: string;
    label: string;
    address: string;
    accessNotes?: string;
    /** Raw form values keyed by field key. Coerced and checked against the registry here. */
    custom?: CustomInput;
  },
): Promise<string> {
  await requireActor(db);

  const label = input.label.trim();
  if (label.length === 0) {
    throw new DomainError('A location needs a label.', 'locations.label_required');
  }
  if (label.length > LABEL_MAX) {
    throw new DomainError(
      `That label is longer than ${LABEL_MAX} characters.`,
      'locations.label_too_long',
    );
  }

  const address = input.address.trim();
  if (address.length === 0) {
    throw new DomainError('A location needs an address.', 'locations.address_required');
  }
  if (address.length > ADDRESS_MAX) {
    throw new DomainError(
      `That address is longer than ${ADDRESS_MAX} characters.`,
      'locations.address_too_long',
    );
  }

  const accessNotes = input.accessNotes?.trim() || null;
  if (accessNotes !== null && accessNotes.length > ACCESS_NOTES_MAX) {
    throw new DomainError(
      `Those access notes are longer than ${ACCESS_NOTES_MAX} characters.`,
      'locations.access_notes_too_long',
    );
  }

  const custom = await resolveCustom(db, {
    organizationId: input.organizationId,
    entityType: 'location',
    custom: input.custom,
  });

  const { data, error } = await db.rpc('create_location', {
    p_organization_id: input.organizationId,
    p_label: label,
    p_address: address,
    // Non-null in the generated types because Postgres records no nullability for function
    // parameters — the same gap `customers.ts` documents (constraints.md D15).
    p_access_notes: accessNotes as string,
    p_custom: custom,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot add locations here.', 'locations.forbidden');
    }
    if (error.code === '23514') {
      throw new DomainError(error.message, 'locations.custom_invalid');
    }
    throw new DomainError(error.message, 'locations.create_failed');
  }

  return data;
}

/**
 * Serve a customer from a location.
 *
 * There is deliberately no check here that the customer and the location belong to this
 * organization. The composite foreign keys on `customer_locations` make a row naming two
 * different tenants impossible to write down at all, which is a stronger guarantee than any
 * check this function could perform — and one a direct PostgREST insert cannot skip.
 */
export async function linkCustomerLocation(
  db: Db,
  input: { organizationId: string; customerId: string; locationId: string },
): Promise<void> {
  await requireActor(db);

  const { error } = await db.rpc('link_customer_location', {
    p_organization_id: input.organizationId,
    p_customer_id: input.customerId,
    p_location_id: input.locationId,
  });

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(
        'That customer is already served from this location.',
        'locations.already_linked',
      );
    }
    // 23503 is a composite foreign key refusing a customer or a location that is not in this
    // organization. From the caller's position the row simply does not exist, so the message
    // says that rather than hinting that it exists somewhere else.
    if (error.code === '23503') {
      throw new DomainError(
        'No such customer or location here.',
        'locations.link_not_found',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot add locations here.', 'locations.forbidden');
    }
    throw new DomainError(error.message, 'locations.link_failed');
  }
}

/**
 * Where an address is, according to whoever this deployment asks.
 *
 * **Separate from writing it down, and the split is the point.** A lookup produces a
 * suggestion; a person decides whether it is right. Folding the two together would make the
 * provider's best guess authoritative about a customer's site, which is the kind of quiet
 * confidence that puts a technician in the wrong street. So this returns a point and touches
 * nothing, and `setLocationCoordinates` is the write.
 *
 * Three answers rather than two, because they need three different sentences on screen: a
 * point, `null` for an address the provider does not recognise, and a `DomainError` for a
 * deployment that cannot ask at all.
 */
export async function locateAddress(input: { address: string }): Promise<Coordinates | null> {
  const address = input.address.trim();
  if (address.length === 0) {
    throw new DomainError('There is no address to look up.', 'locations.address_required');
  }

  const provider = await geocodingProvider();
  if (!provider) {
    throw new DomainError(
      'This deployment cannot look an address up, so coordinates are typed in by hand.',
      'locations.geocoding_unavailable',
    );
  }

  try {
    return await provider.locate({ address });
  } catch {
    // Whatever the provider was unhappy about is its own business and not something the person
    // reading this can act on. What they can do is type the numbers, which the message says.
    throw new DomainError(
      'That lookup did not come back. Try again, or type the coordinates in.',
      'locations.geocoding_failed',
    );
  }
}

/**
 * Say where a location is — or stop saying.
 *
 * **Both numbers or neither, checked here and enforced in the database.** The constraint is the
 * guarantee (`locations_coordinates_are_complete`); this produces the sentence, which is the
 * same division of labour `scheduleWorkItem` has with the exclusion constraint.
 *
 * Nothing else about a location is writable through this path and nothing else may become so
 * without its own argument: the column grant carries `latitude` and `longitude` only, so a
 * label or an address cannot be changed through here, through PostgREST, or through a mistake.
 * Moving a location to a different address would silently relocate every job ever done there.
 */
export async function setLocationCoordinates(
  db: Db,
  input: { id: string; latitude: number | null; longitude: number | null },
): Promise<void> {
  await requireActor(db);

  const clearing = input.latitude === null && input.longitude === null;

  if (!clearing) {
    if (input.latitude === null || input.longitude === null) {
      throw new DomainError(
        'A place needs both a latitude and a longitude, or neither.',
        'locations.coordinates_incomplete',
      );
    }
    if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
      throw new DomainError(
        'Those coordinates are not numbers.',
        'locations.coordinates_invalid',
      );
    }
    if (input.latitude < -90 || input.latitude > 90) {
      throw new DomainError(
        'A latitude runs from -90 to 90.',
        'locations.latitude_out_of_range',
      );
    }
    if (input.longitude < -180 || input.longitude > 180) {
      throw new DomainError(
        'A longitude runs from -180 to 180.',
        'locations.longitude_out_of_range',
      );
    }
  }

  const { data, error } = await db
    .from('locations')
    .update({ latitude: input.latitude, longitude: input.longitude })
    .eq('id', input.id)
    // **Returned rows, because a refused update is not an error.** An RLS `update` whose policy
    // excludes the row matches nothing and reports success — the same trap `setModuleEnabled`
    // documents, and the reason a role without `location.create` was going to be told it had
    // saved something it had not.
    .select('id');

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot change locations here.', 'locations.forbidden');
    }
    if (error.code === '23514') {
      throw new DomainError(
        'A place needs both a latitude and a longitude, or neither.',
        'locations.coordinates_incomplete',
      );
    }
    throw new DomainError(error.message, 'locations.update_failed');
  }

  if ((data ?? []).length === 0) {
    // No row matched: either it is not this caller's, or their role cannot change it. The two
    // are indistinguishable from here on purpose — the same reason `requireOrganization` turns
    // both into a 404.
    throw new DomainError(
      'No such location here, or your role cannot change it.',
      'locations.not_found',
    );
  }
}
