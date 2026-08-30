import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { resolveCustom, type CustomValues } from '@/lib/domain/fields/field-definitions';
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
  input: { organizationId: string },
): Promise<Location[]> {
  const { data, error } = await db
    .from('locations')
    .select('id, label, address, access_notes, custom, created_at')
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new DomainError(error.message, 'locations.list_failed');
  }

  const locations = data ?? [];
  if (locations.length === 0) {
    return [];
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

  return locations.map((row) => ({
    id: row.id,
    label: row.label,
    address: row.address,
    accessNotes: row.access_notes,
    custom: (row.custom ?? {}) as CustomValues,
    customers: (byLocation.get(row.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    createdAt: row.created_at,
  }));
}

function one<T>(value: T | T[] | null): T | undefined {
  if (value === null) return undefined;
  return Array.isArray(value) ? value[0] : value;
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
    custom?: Record<string, string>;
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
