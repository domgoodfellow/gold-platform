import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { LIST_LIMIT, counted, type Counted } from '@/lib/domain/counted';
import {
  resolveCustom,
  type CustomInput,
  type CustomValues,
} from '@/lib/domain/fields/field-definitions';
import { parseWindow, type Window } from '@/lib/domain/scheduling/window';
import { requireActor } from '@/lib/domain/tenancy/actor';

/** A named reference on a work item — the customer, the place, or who is doing it. */
export type WorkItemRef = {
  id: string;
  label: string;
};

export type WorkItem = {
  id: string;
  title: string;
  /** What kind of work this is. Scopes the statuses; nothing branches on it. */
  type: WorkItemRef;
  status: WorkItemRef;
  customer: WorkItemRef | null;
  location: WorkItemRef | null;
  resource: WorkItemRef | null;
  /** What the work is about, as opposed to what it is done with. */
  asset: WorkItemRef | null;
  /** When this work occupies its resource, or null if it is not yet scheduled. */
  window: Window | null;
  /** Tenant-defined fields, governed by this organization's registry (D7). */
  custom: CustomValues;
  createdAt: string;
};

const TITLE_MAX = 300;

// One string literal, not a concatenation: supabase-js parses the select at the type level
// and only sees a literal, so splitting it collapses the result type to GenericStringError[].
// Every embed is hinted with its constraint name because every reference is composite
// (organization_id, x_id) and the hint is what tells PostgREST which one to follow. The
// status hint names the three-column constraint, which carries type_id as well — a work item
// cannot sit in another type's status, and that is a database fact rather than a convention.
const WORK_ITEM_SELECT =
  'id, title, custom, created_at, scheduled_during, type:work_item_types!work_items_type_same_org (id, name), status:work_item_statuses!work_items_status_same_org_and_type (id, name), customer:customers!work_items_customer_same_org (id, name), location:locations!work_items_location_same_org (id, label), resource:resources!work_items_resource_same_org (id, name), asset:assets!work_items_asset_same_org (id, name)';

function one<T>(value: T | T[] | null): T | undefined {
  if (value === null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The work items of one organization, optionally of one type.
 *
 * Both callers are real, which is why `typeId` is optional rather than required: a board
 * shows one type's work, and "everything this business has recorded" is the other question
 * anyone asks. Neither is a speculative generalisation of the other.
 *
 * The `organization_id` filter is an optimisation, not the boundary — RLS has already
 * restricted these rows, and every embedded row besides.
 */
export async function listWorkItems(
  db: Db,
  input: { organizationId: string; typeId?: string; limit?: number },
): Promise<Counted<WorkItem>> {
  let query = db
    .from('work_items')
    .select(WORK_ITEM_SELECT, { count: 'exact' })
    .eq('organization_id', input.organizationId);

  if (input.typeId) {
    query = query.eq('type_id', input.typeId);
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .limit(input.limit ?? LIST_LIMIT);

  if (error) {
    throw new DomainError(error.message, 'work_items.list_failed');
  }

  return counted(
    (data ?? []).flatMap((row) => {
      const type = one(row.type);
      const status = one(row.status);
      // Neither can be absent — both columns are NOT NULL behind a foreign key — so this is
      // unreachable rather than defensive. Dropping the row is still better than rendering a
      // board column with no name if it ever becomes reachable.
      if (!type || !status) return [];

      const customer = one(row.customer);
      const location = one(row.location);
      const resource = one(row.resource);
      const asset = one(row.asset);

      return [
        {
          id: row.id,
          title: row.title,
          type: { id: type.id, label: type.name },
          status: { id: status.id, label: status.name },
          customer: customer ? { id: customer.id, label: customer.name } : null,
          location: location ? { id: location.id, label: location.label } : null,
          resource: resource ? { id: resource.id, label: resource.name } : null,
          asset: asset ? { id: asset.id, label: asset.name } : null,
          // D15's boundary again: `supabase gen types` has no TypeScript for a Postgres range
          // and emits `unknown`. The cast is at the one place the value enters the domain, and
          // `parseWindow` treats anything it cannot read as "not scheduled" rather than trusting
          // the shape.
          window: parseWindow(row.scheduled_during as string | null),
          custom: (row.custom ?? {}) as CustomValues,
          createdAt: row.created_at,
        },
      ];
    }),
    count,
  );
}

/**
 * Record a unit of work.
 *
 * There is deliberately no check here that the status, customer, location and resource
 * belong to this organization. All four references are composite, so a work item naming
 * another tenant's anything is impossible to write down — a stronger guarantee than this
 * function could make, and one a direct PostgREST insert cannot skip (I18).
 *
 * The type is not an argument. It follows from the status, and `create_work_item` derives it
 * under the caller's own RLS — an argument that must agree with another argument is an
 * argument that can disagree with it.
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
    custom?: CustomInput;
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

/**
 * Correct a work item's details.
 *
 * **What this deliberately cannot touch is the whole design.** Not `status_id`, which is
 * `work_item.transition` and is validated against the tenant's configured transitions (I13).
 * Not `resource_id` or `scheduled_during`, which is `work_item.schedule` and lands on the
 * exclusion constraint (I7). Not `type_id` at any price: changing a type strands the status
 * the job is in, and I20's three-column reference exists so that mismatch cannot be written
 * down at all. `create_work_item` derives the type from the status precisely so nobody ever
 * holds both, and this keeps that true for the rest of the job's life.
 *
 * The column grant in the migration is what enforces that, not this comment — the same three
 * lanes are re-checked per column by `app.check_work_item_update_capability`, because a
 * policy sees the old row or the new one but never both.
 *
 * A null reference is a real edit rather than an omission: a job attached to the wrong
 * customer has to be detachable, so these are passed through rather than merged with what is
 * already stored.
 */
export async function updateWorkItem(
  db: Db,
  input: {
    organizationId: string;
    id: string;
    title: string;
    customerId?: string | null;
    locationId?: string | null;
    assetId?: string | null;
    /** Raw form values keyed by field key. Coerced and checked against the registry here. */
    custom?: CustomInput;
  },
): Promise<void> {
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

  // Re-checked here for the message rather than the guarantee: `app.check_custom_fields` is
  // the guarantee, and it fires on this update because `custom` is in the SET list.
  const custom = await resolveCustom(db, {
    organizationId: input.organizationId,
    entityType: 'work_item',
    custom: input.custom,
  });

  const { error } = await db.rpc('update_work_item', {
    p_id: input.id,
    p_title: title,
    p_customer_id: (input.customerId || null) as string,
    p_location_id: (input.locationId || null) as string,
    p_asset_id: (input.assetId || null) as string,
    p_custom: custom,
  });

  if (error) {
    if (error.code === '23503') {
      throw new DomainError(
        'No such customer, location or asset here.',
        'work_items.reference_not_found',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot edit work items here.', 'work_items.forbidden');
    }
    if (error.code === '23514') {
      throw new DomainError(error.message, 'work_items.custom_invalid');
    }
    throw new DomainError(error.message, 'work_items.update_failed');
  }
}
