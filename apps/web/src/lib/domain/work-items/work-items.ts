import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { resolveCustom, type CustomValues } from '@/lib/domain/fields/field-definitions';
import { requireActor } from '@/lib/domain/tenancy/actor';

/** A named reference on a work item — the customer, the place, or who is doing it. */
export type WorkItemRef = {
  id: string;
  label: string;
};

export type WorkItem = {
  id: string;
  title: string;
  status: WorkItemRef;
  customer: WorkItemRef | null;
  location: WorkItemRef | null;
  resource: WorkItemRef | null;
  /** What the work is about, as opposed to what it is done with. */
  asset: WorkItemRef | null;
  /** Tenant-defined fields, governed by this organization's registry (D7). */
  custom: CustomValues;
  createdAt: string;
};

const TITLE_MAX = 300;

// One string literal, not a concatenation: supabase-js parses the select at the type level
// and only sees a literal, so splitting it collapses the result type to GenericStringError[].
// Every embed is hinted with its constraint name because all four references are composite
// (organization_id, x_id) and the hint is what tells PostgREST which one to follow.
const WORK_ITEM_SELECT =
  'id, title, custom, created_at, status:work_item_statuses!work_items_status_same_org (id, name), customer:customers!work_items_customer_same_org (id, name), location:locations!work_items_location_same_org (id, label), resource:resources!work_items_resource_same_org (id, name), asset:assets!work_items_asset_same_org (id, name)';

function one<T>(value: T | T[] | null): T | undefined {
  if (value === null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The work items of one organization.
 *
 * The `organization_id` filter is an optimisation, not the boundary — RLS has already
 * restricted these rows, and every embedded row besides.
 */
export async function listWorkItems(
  db: Db,
  input: { organizationId: string },
): Promise<WorkItem[]> {
  const { data, error } = await db
    .from('work_items')
    .select(WORK_ITEM_SELECT)
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new DomainError(error.message, 'work_items.list_failed');
  }

  return (data ?? []).flatMap((row) => {
    const status = one(row.status);
    // A work item without a status cannot exist — status_id is NOT NULL behind a foreign
    // key — so this is unreachable rather than defensive. Dropping the row is still better
    // than rendering a board column with no name if it ever becomes reachable.
    if (!status) return [];

    const customer = one(row.customer);
    const location = one(row.location);
    const resource = one(row.resource);
    const asset = one(row.asset);

    return [
      {
        id: row.id,
        title: row.title,
        status: { id: status.id, label: status.name },
        customer: customer ? { id: customer.id, label: customer.name } : null,
        location: location ? { id: location.id, label: location.label } : null,
        resource: resource ? { id: resource.id, label: resource.name } : null,
        asset: asset ? { id: asset.id, label: asset.name } : null,
        custom: (row.custom ?? {}) as CustomValues,
        createdAt: row.created_at,
      },
    ];
  });
}

/**
 * Record a unit of work.
 *
 * There is deliberately no check here that the status, customer, location and resource
 * belong to this organization. All four references are composite, so a work item naming
 * another tenant's anything is impossible to write down — a stronger guarantee than this
 * function could make, and one a direct PostgREST insert cannot skip (I18).
 */
export async function createWorkItem(
  db: Db,
  input: {
    organizationId: string;
    title: string;
    statusId: string;
    customerId?: string | null;
    locationId?: string | null;
    resourceId?: string | null;
    assetId?: string | null;
    /** Raw form values keyed by field key. Coerced and checked against the registry here. */
    custom?: Record<string, string>;
  },
): Promise<string> {
  await requireActor(db);

  const title = input.title.trim();
  if (title.length === 0) {
    throw new DomainError('A work item needs a title.', 'work_items.title_required');
  }
  if (title.length > TITLE_MAX) {
    throw new DomainError(
      `That title is longer than ${TITLE_MAX} characters.`,
      'work_items.title_too_long',
    );
  }

  if (!input.statusId) {
    throw new DomainError('A work item needs a status.', 'work_items.status_required');
  }

  const custom = await resolveCustom(db, {
    organizationId: input.organizationId,
    entityType: 'work_item',
    custom: input.custom,
  });

  const { data, error } = await db.rpc('create_work_item', {
    p_organization_id: input.organizationId,
    p_title: title,
    p_status_id: input.statusId,
    // A select that submits "" means "not set". Empty string is not a uuid, so this must
    // become null before it reaches Postgres rather than after.
    p_customer_id: (input.customerId || null) as string,
    p_location_id: (input.locationId || null) as string,
    p_resource_id: (input.resourceId || null) as string,
    p_asset_id: (input.assetId || null) as string,
    p_custom: custom,
  });

  if (error) {
    // 23503 is a composite reference refusing something that is not in this organization.
    // From the caller's position that row does not exist, so the message says so rather than
    // hinting that it exists somewhere else.
    if (error.code === '23503') {
      throw new DomainError(
        'No such status, customer, location, resource or asset here.',
        'work_items.reference_not_found',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot add work items here.', 'work_items.forbidden');
    }
    if (error.code === '23514') {
      throw new DomainError(error.message, 'work_items.custom_invalid');
    }
    throw new DomainError(error.message, 'work_items.create_failed');
  }

  return data;
}
